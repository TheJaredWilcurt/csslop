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
 * Counts the characters a list of rules takes up as selector text. Each rule
 * counts its selectors, its braces, and every rule nested within it, while
 * plain declarations count for nothing.
 *
 * @param  {Array}  rules  The AST entries to measure.
 * @return {number}        The number of characters the rules take up.
 */
function measureRuleCharacters (rules) {
  return rules.reduce((total, rule) => {
    if (rule.type !== 'rule') {
      return total;
    }
    const selectorText = (rule.selectors || []).map((selector) => {
      return selector.trim();
    }).join(',');
    const nestedRules = (rule.declarations || []).filter((declaration) => {
      return declaration.type === 'rule';
    });
    // The two braces wrap the rule's declarations
    return total + selectorText.length + 2 + measureRuleCharacters(nestedRules);
  }, 0);
}

/**
 * Counts how many characters wrapping a run behind a shared parent selector
 * saves: the run is measured as it is written, against the declarations the
 * wrapper would hold plus the parent written once with its braces.
 *
 * @param  {Array}  run           The rules of the run paired with their nested selectors.
 * @param  {Array}  declarations  The declarations the wrapper would hold, including any factoring of the nested rules.
 * @param  {string} parent        The shared parent selector string.
 * @return {number}               The character savings of the wrapper, or a non-positive number when it costs more than it saves.
 */
function measureWrapperSavings (run, declarations, parent) {
  const charactersBefore = measureRuleCharacters(run.map((entry) => {
    return entry.sibling;
  }));
  // The wrapper writes the shared selector once plus its surrounding braces.
  const charactersAfter = measureRuleCharacters(declarations) + parent.length + 2;
  return charactersBefore - charactersAfter;
}

/**
 * Expresses every selector of a sibling rule relative to a candidate parent.
 * A nested selector must be shorter than the selector it replaces, so each
 * factoring pass leaves the rules smaller and factoring them again terminates.
 *
 * @param  {object}                          rule                 The sibling rule whose selectors are nested.
 * @param  {function(string): (string|null)} matchNestedSelector  The matcher built for the candidate parent.
 * @return {Array|null}                                           The nested selectors, or null when any selector cannot nest under the parent.
 */
function nestSelectorsUnderParent (rule, matchNestedSelector) {
  const nestedSelectors = [];
  for (const selector of rule.selectors) {
    const trimmedSelector = selector.trim();
    const nestedSelector = matchNestedSelector(trimmedSelector);
    // A bare `&` is the parent itself, which is hoisted into the wrapper rather than kept as a nested selector
    if (nestedSelector === null || (nestedSelector !== '&' && nestedSelector.length >= trimmedSelector.length)) {
      return null;
    }
    nestedSelectors.push(nestedSelector);
  }
  return nestedSelectors;
}

/**
 * Re-expresses a run entry as a rule whose selectors are the nested selectors.
 *
 * @param  {object} entry  A run entry pairing a sibling rule with its nested selectors.
 * @return {object}        The rule, with its selectors replaced by the nested ones.
 */
function createNestedChild (entry) {
  return { ...entry.sibling, selectors: entry.nestedSelectors };
}

/**
 * Reports whether a run entry is the parent selector itself, which nests as a
 * bare `&`. Its body is written straight into the wrapper instead of being kept
 * as a nested rule of its own.
 *
 * @param  {object}  entry  A run entry pairing a sibling rule with its nested selectors.
 * @return {boolean}        True when the entry is the parent itself.
 */
function isParentItselfEntry (entry) {
  return entry.nestedSelectors.length === 1 && entry.nestedSelectors[0] === '&';
}

/**
 * Builds the declarations of a wrapper that holds a run of sibling rules nested
 * under their shared parent. A run entry that is the parent itself has its body
 * written in place, so the wrapper keeps the run's order. Moving a parent's
 * declarations ahead of an earlier nested rule could change which one wins a
 * conflict. Without a parent itself, the nested rules are factored again, so
 * the selectors they still share can be wrapped in turn.
 *
 * @param  {Array} run  The rules of the run paired with their nested selectors.
 * @return {Array}      The declarations of the wrapper rule.
 */
function createWrapperDeclarations (run) {
  if (!run.some(isParentItselfEntry)) {
    return factorCommonParents(run.map(createNestedChild), true);
  }
  return run.flatMap((entry) => {
    if (isParentItselfEntry(entry)) {
      return entry.sibling.declarations;
    }
    return [createNestedChild(entry)];
  });
}

/**
 * Collects the run of consecutive sibling rules, starting at a given index,
 * whose selectors can all nest under a candidate parent. Comments never affect
 * the cascade, so they are passed over instead of ending the run.
 *
 * @param  {Array}                           rules                The sibling AST entries.
 * @param  {number}                          startIndex           The index the run starts at.
 * @param  {function(string): (string|null)} matchNestedSelector  The matcher built for the candidate parent.
 * @return {object}                                               The `run` of rules paired with their nested selectors, and the `end` index just past the run's last rule.
 */
function collectSiblingRun (rules, startIndex, matchNestedSelector) {
  const run = [];
  let end = startIndex;
  let lookahead = startIndex;
  while (lookahead < rules.length) {
    const sibling = rules[lookahead];
    if (sibling.type === 'comment') {
      lookahead++;
      continue;
    }
    if (sibling.type !== 'rule' || !sibling.selectors?.length) {
      break;
    }
    const nestedSelectors = nestSelectorsUnderParent(sibling, matchNestedSelector);
    if (!nestedSelectors) {
      break;
    }
    run.push({ sibling, nestedSelectors });
    lookahead++;
    end = lookahead;
  }
  return { end, run };
}

/**
 * Groups consecutive sibling rules that share a common leading selector
 * portion (such as `.foo` in `.foo .a`, `.foo .b`, or `.menu .item` in
 * `.menu .item:hover .x`) into a synthesized parent rule with the shared
 * portion factored out. Every viable prefix of the first rule's selector is
 * tried as the parent, and the grouping that saves the most characters wins,
 * measured with the rules nested under it factored in turn, but only when it
 * saves more than the wrapper itself costs. Rules with a comma-separated
 * selector list can join a run when every one of their selectors nests under
 * the parent.
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
      const { end, run } = collectSiblingRun(rules, index, matchNestedSelector);
      const selectorCount = run.reduce((total, entry) => {
        return total + entry.nestedSelectors.length;
      }, 0);
      // A lone single-selector rule has nothing to share its parent with.
      if (run.length < 2 && selectorCount < 2) {
        continue;
      }
      const declarations = createWrapperDeclarations(run);
      const savings = measureWrapperSavings(run, declarations, candidateParent);
      if (savings > 0 && (!bestGrouping || savings > bestGrouping.savings)) {
        bestGrouping = {
          comments: rules.slice(index, end).filter((entry) => {
            return entry.type === 'comment';
          }),
          declarations,
          end,
          parent: candidateParent,
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
    result.push(...bestGrouping.comments, {
      type: 'rule',
      selectors: [bestGrouping.parent],
      declarations: bestGrouping.declarations
    });
    index = bestGrouping.end;
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
