/**
 * @file Factors the selector portions that consecutive rules share into a synthesized nesting wrapper, or into an `:is()` group when a wrapper would not pay for itself.
 */

import {
  containsPseudoElement,
  isUniversallyRecognizableSelector
} from '../selectors.js';

import {
  collectCandidateParentSelectors,
  createNestedSelectorMatcher,
  isSelectorWhitespace
} from './nest-rules.js';
import { selectorsShareSpecificity } from './specificity.js';

/**
 * Splits a selector into the part before its final top-level combinator and
 * the trailing compound that follows it, so selectors that only differ in
 * that leading part can share the trailing compound through nesting.
 *
 * @param  {string}      selector  The selector string to split.
 * @return {object|null}           The `head`, `combinator` (`' '` for descendant), and `tail`, or null when the selector has no top-level combinator.
 */
function splitSelectorTail (selector) {
  const trimmed = selector.trim();
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let combinatorStart = -1;
  let combinator = '';
  let tailStart = -1;
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (character === '(') {
      parenthesisDepth++;
    } else if (character === ')') {
      parenthesisDepth--;
    } else if (character === '[') {
      bracketDepth++;
    } else if (character === ']') {
      bracketDepth--;
    } else if (parenthesisDepth === 0 && bracketDepth === 0) {
      if (character === '>' || character === '+' || character === '~') {
        // Whitespace written after an explicit combinator belongs to it
        let end = index + 1;
        while (end < trimmed.length && isSelectorWhitespace(trimmed[end])) {
          end++;
        }
        combinator = character;
        combinatorStart = index;
        tailStart = end;
        index = end - 1;
      } else if (isSelectorWhitespace(character)) {
        // Whitespace adjacent to an explicit combinator belongs to that
        // combinator, so only a self-standing run is a descendant combinator
        const previous = trimmed[index - 1];
        let end = index;
        while (end < trimmed.length && isSelectorWhitespace(trimmed[end])) {
          end++;
        }
        const next = trimmed[end];
        if (
          next &&
          next !== '>' && next !== '+' && next !== '~' &&
          previous !== '>' && previous !== '+' && previous !== '~'
        ) {
          combinator = ' ';
          combinatorStart = index;
          tailStart = end;
        }
        index = end - 1;
      }
    }
  }
  if (!combinator || combinatorStart === 0) {
    return null;
  }
  const head = trimmed.slice(0, combinatorStart).trim();
  const tail = trimmed.slice(tailStart).trim();
  if (!head || !tail) {
    return null;
  }
  return {
    combinator,
    head,
    tail
  };
}

/**
 * Rewrites a multi-selector rule whose selectors only differ before their
 * final combinator into a wrapper rule that nests the shared trailing
 * compound once, such as `&:hover .x,&:focus .x` becoming
 * `&:hover,&:focus{.x{...}}`. The heads join a comma list, which resolves
 * like `:is()`, so they may only be grouped while they share one specificity.
 *
 * @param  {object} rule  The AST rule node whose selector list may be factored.
 * @return {object}       The rule, rewritten when factoring is valid and shorter.
 */
function factorCommonTrailingCompound (rule) {
  if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
    return rule;
  }
  const splitSelectors = rule.selectors.map(splitSelectorTail);
  if (splitSelectors.some((split) => {
    return split === null;
  })) {
    return rule;
  }
  const first = splitSelectors[0];
  const allShareTrailingCompound = splitSelectors.every((split) => {
    return split.tail === first.tail && split.combinator === first.combinator;
  });
  if (!allShareTrailingCompound) {
    return rule;
  }
  const heads = splitSelectors.map((split) => {
    return split.head;
  });
  if (!selectorsShareSpecificity(heads)) {
    return rule;
  }
  const nestedSelector = first.combinator === ' ' ? first.tail : first.combinator + first.tail;
  const flatLength = rule.selectors.join(',').length;
  const factoredLength = heads.join(',').length + nestedSelector.length + 2;
  if (factoredLength >= flatLength) {
    return rule;
  }
  return {
    ...rule,
    selectors: heads,
    declarations: [{
      type: 'rule',
      selectors: [nestedSelector],
      declarations: rule.declarations
    }]
  };
}

/**
 * Collects every selector prefix of a rule's first selector that could serve
 * as a shared nesting parent, including the full selector itself, which can
 * host sibling pseudo-class variants such as `.a` of `.a,.a:hover`.
 *
 * @param  {object} rule  The AST rule node whose candidates are collected.
 * @return {Set}          The candidate parent selector strings.
 */
function collectSharedParentCandidates (rule) {
  const firstSelector = rule.selectors[0].trim();
  const candidates = collectCandidateParentSelectors(firstSelector);
  if (firstSelector) {
    candidates.add(firstSelector);
  }
  return candidates;
}

/**
 * Counts how many characters wrapping a run behind a shared parent selector
 * saves: the parent is written once with its braces, and every wrapped
 * selector shrinks to its nested form.
 *
 * @param  {Array}  run     The rules of the run paired with their nested selectors.
 * @param  {string} parent  The shared parent selector string.
 * @return {number}         The character savings of the wrapper, or a non-positive number when it costs more than it saves.
 */
function measureWrapperSavings (run, parent) {
  const charactersSaved = run.reduce((total, entry) => {
    return total + entry.sibling.selectors.reduce((sum, selector, position) => {
      return sum + selector.trim().length - entry.nestedSelectors[position].length;
    }, 0);
  }, 0);
  // The wrapper writes the shared selector once plus its surrounding braces.
  return charactersSaved - (parent.length + 2);
}

/**
 * Restores the source order of rules that are being moved under their own
 * selector. Their relative order can affect the cascade when nested rules
 * overlap, so it must not depend on an earlier grouping optimization.
 *
 * @param  {Array} rules  The nested rules to order.
 * @return {Array}        A source-ordered copy of the rules.
 */
function orderRulesBySourcePosition (rules) {
  return [...rules].sort((firstRule, secondRule) => {
    return firstRule.position?.start?.offset - secondRule.position?.start?.offset;
  });
}

/**
 * Groups consecutive sibling rules that share a common leading selector
 * portion (such as `.foo` in `.foo .a`, `.foo .b`, or `.menu .item` in
 * `.menu .item:hover .x`) into a synthesized parent rule with the shared
 * portion factored out. Every viable prefix of the first rule's selector is
 * tried as the parent, and the grouping that saves the most characters wins,
 * but only when it saves more than the wrapper itself costs. Rules with a
 * comma-separated selector list can join a run when every one of their
 * selectors nests under the parent.
 *
 * @param  {Array}   rules                  The flat AST rule nodes to factor.
 * @param  {boolean} allowTrailingCompound  True when the rules are children of a factored wrapper, whose `&`-relative selectors may share a trailing compound that can be factored out in turn.
 * @return {Array}                          A new array of rules with shared parent selectors factored into nesting wrappers.
 */
function factorCommonParents (rules, allowTrailingCompound = false) {
  const result = [];
  let index = 0;
  while (index < rules.length) {
    const rule = rules[index];
    if (rule.type !== 'rule' || !rule.selectors?.length) {
      result.push(rule);
      index++;
      continue;
    }
    let bestGrouping = null;
    for (const candidateParent of collectSharedParentCandidates(rule)) {
      if (!candidateParent || containsPseudoElement(candidateParent)) {
        continue;
      }
      const matchNestedSelector = createNestedSelectorMatcher(candidateParent);
      // Collect the run of consecutive rules whose selectors can all nest under the candidate.
      const run = [];
      let lookahead = index;
      while (lookahead < rules.length) {
        const sibling = rules[lookahead];
        if (sibling.type !== 'rule' || !sibling.selectors?.length) {
          break;
        }
        const nestedSelectors = sibling.selectors.map((selector) => {
          return matchNestedSelector(selector.trim());
        });
        if (nestedSelectors.some((nestedSelector) => {
          return nestedSelector === null;
        })) {
          break;
        }
        run.push({ sibling, nestedSelectors });
        lookahead++;
      }
      const selectorCount = run.reduce((total, entry) => {
        return total + entry.nestedSelectors.length;
      }, 0);
      // A lone single-selector rule has nothing to share its parent with.
      if (run.length < 2 && selectorCount < 2) {
        continue;
      }
      const savings = measureWrapperSavings(run, candidateParent);
      if (savings > 0 && (!bestGrouping || savings > bestGrouping.savings)) {
        bestGrouping = {
          lookahead,
          parent: candidateParent,
          run,
          savings
        };
      }
    }
    if (!bestGrouping) {
      if (allowTrailingCompound) {
        result.push(factorCommonTrailingCompound(rule));
      } else {
        result.push(rule);
      }
      index++;
      continue;
    }
    const firstEntry = bestGrouping.run[0];
    const firstSelectorIsParent = (
      firstEntry.nestedSelectors.length === 1 &&
      firstEntry.nestedSelectors[0] === '&'
    );
    const directDeclarations = firstSelectorIsParent ?
      firstEntry.sibling.declarations :
      [];
    const entriesToNest = firstSelectorIsParent ?
      bestGrouping.run.slice(1) :
      bestGrouping.run;
    const children = entriesToNest.map((entry) => {
      return { ...entry.sibling, selectors: entry.nestedSelectors };
    });
    let declarations;
    if (firstSelectorIsParent) {
      const directNestedRules = directDeclarations.filter((declaration) => {
        return declaration.type === 'rule';
      });
      const directEntries = directDeclarations.filter((declaration) => {
        return declaration.type !== 'rule';
      });
      declarations = [
        ...directEntries,
        ...orderRulesBySourcePosition([...directNestedRules, ...children])
      ];
    } else {
      declarations = factorCommonParents(children, true);
    }
    result.push({
      type: 'rule',
      selectors: [bestGrouping.parent],
      declarations
    });
    index = bestGrouping.lookahead;
  }
  return result;
}

/**
 * Shares a descendant prefix through `:is()` when a nesting wrapper did not
 * save enough space to factor the parent out of the selector list.
 *
 * @param {object} rule  The style rule whose selector list may be shortened.
 */
function factorSelectorBranches (rule) {
  if (rule.type !== 'rule' || !rule.selectors?.length) {
    return;
  }
  for (const parent of [...rule.selectors]) {
    const prefix = parent + ' ';
    const branches = rule.selectors.filter((selector) => {
      return selector.startsWith(prefix);
    });
    const children = branches.map((selector) => {
      return selector.slice(prefix.length);
    });
    if (children.length < 2 || !children.every(isUniversallyRecognizableSelector) || !selectorsShareSpecificity(children)) {
      continue;
    }
    const grouped = prefix + ':is(' + children.sort().join(',') + ')';
    if (grouped.length >= branches.join(',').length) {
      continue;
    }
    const branchSet = new Set(branches);
    const firstIndex = rule.selectors.indexOf(branches[0]);
    rule.selectors = rule.selectors.flatMap((selector, index) => {
      if (index === firstIndex) {
        return [grouped];
      }
      return branchSet.has(selector) ? [] : [selector];
    });
  }
}

export {
  factorCommonParents,
  factorSelectorBranches
};
