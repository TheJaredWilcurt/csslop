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
import { canMoveRuleAcrossRange } from './reordering.js';
import { createSiblingIndex } from './sibling-index.js';
import { findFirstPositionAtLeast } from './sorted-indexes.js';
import { selectorsShareSpecificity } from './specificity.js';

/**
 * Splits a selector into the part before its final top-level combinator and
 * the trailing compound that follows it, so selectors that only differ in
 * that leading part can share the trailing compound through nesting.
 *
 * @param  {string}      selector  The selector string to split.
 * @return {object|null}           The `head` and the `nestedSelector` the trailing compound is written as, or null when the selector has no top-level combinator.
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
    head,
    nestedSelector: combinator === ' ' ? tail : combinator + tail
  };
}

/**
 * Matches a type selector at the start of a selector that is directly followed
 * by a pseudo-class, class, ID, or attribute selector, such as `h1` in
 * `h1:hover .anchor`. The name itself is what the lookahead leaves unconsumed.
 *
 * @type {RegExp}
 */
const LEADING_TYPE_SELECTOR_PATTERN = /^[a-z][a-z0-9-]*(?=[:.#[])/i;

/**
 * Matches a whitespace or combinator character, which separates the compounds
 * of a selector.
 *
 * @type {RegExp}
 */
const COMPOUND_SEPARATOR_PATTERN = /[\s>+~]/;

/**
 * Splits a selector right after its leading type selector, so the rest of the
 * selector can be nested under that type selector with a leading `&`. Only a
 * rest that holds a combinator is split, since a bare compound such as
 * `:hover` is already as short as its nested form.
 *
 * @param  {string}      selector  The selector string to split.
 * @return {object|null}           The `head` and the `nestedSelector` written with a leading `&`, or null when the selector does not start with a type selector followed by a combinator-holding rest.
 */
function splitSelectorHead (selector) {
  const trimmed = selector.trim();
  const headMatch = trimmed.match(LEADING_TYPE_SELECTOR_PATTERN);
  if (!headMatch) {
    return null;
  }
  const rest = trimmed.slice(headMatch[0].length);
  if (!COMPOUND_SEPARATOR_PATTERN.test(rest)) {
    return null;
  }
  return {
    head: headMatch[0],
    nestedSelector: '&' + rest
  };
}

/**
 * Rewrites a multi-selector rule into a wrapper rule that nests the part of
 * every selector that they share, when splitting each selector the same way
 * leaves heads that can be grouped. The heads join a comma list, which
 * resolves like `:is()`, so they may only be grouped while they share one
 * specificity.
 *
 * @param  {object}                          rule           The AST rule node whose selector list may be factored.
 * @param  {function(string): (object|null)} splitSelector  Splits one selector into its `head` and `nestedSelector`.
 * @return {object|null}                                    The `factoredLength` and the rewritten `rule`, or null when this split cannot factor the rule into something shorter.
 */
function factorRuleBySplit (rule, splitSelector) {
  const splits = rule.selectors.map(splitSelector);
  if (splits.some((split) => {
    return split === null;
  })) {
    return null;
  }
  const nestedSelector = splits[0].nestedSelector;
  const allShareNestedSelector = splits.every((split) => {
    return split.nestedSelector === nestedSelector;
  });
  if (!allShareNestedSelector) {
    return null;
  }
  const heads = splits.map((split) => {
    return split.head;
  });
  if (!selectorsShareSpecificity(heads)) {
    return null;
  }
  const flatLength = rule.selectors.join(',').length;
  const factoredLength = heads.join(',').length + nestedSelector.length + 2;
  if (factoredLength >= flatLength) {
    return null;
  }
  return {
    factoredLength,
    rule: {
      ...rule,
      selectors: heads,
      declarations: [{
        type: 'rule',
        selectors: [nestedSelector],
        declarations: rule.declarations
      }]
    }
  };
}

/**
 * Rewrites a multi-selector rule whose selectors only differ before their
 * final combinator into a wrapper rule that nests the shared trailing
 * compound once, such as `&:hover .x,&:focus .x` becoming
 * `&:hover,&:focus{.x{...}}`. The shorter of the trailing-combinator split and
 * the leading type selector split is used.
 *
 * @param  {object} rule  The AST rule node whose selector list may be factored.
 * @return {object}       The rule, rewritten when factoring is valid and shorter.
 */
function factorCommonTrailingCompound (rule) {
  if (rule.type !== 'rule' || !rule.selectors || rule.selectors.length < 2) {
    return rule;
  }
  const factorings = [splitSelectorTail, splitSelectorHead].map((splitSelector) => {
    return factorRuleBySplit(rule, splitSelector);
  }).filter((factoring) => {
    return factoring !== null;
  });
  if (!factorings.length) {
    return rule;
  }
  return factorings.reduce((shortest, factoring) => {
    return factoring.factoredLength < shortest.factoredLength ? factoring : shortest;
  }).rule;
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
 * Reports whether a run entry is the parent selector itself, with each of its
 * selectors nesting as a bare `&`. Its body is written straight into the
 * wrapper instead of being kept as a nested rule of its own. Every selector
 * must be checked: a rule like `.a,.a` nests as `&,&`, which is still the
 * parent itself. Treating it otherwise would re-factor identical rules
 * forever, since `&` never gets shorter.
 *
 * @param  {object}  entry  A run entry pairing a sibling rule with its nested selectors.
 * @return {boolean}        True when every one of the entry's selectors is the parent itself.
 */
function isParentItselfEntry (entry) {
  return entry.nestedSelectors.every((nestedSelector) => {
    return nestedSelector === '&';
  });
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
  const declarations = run.flatMap((entry) => {
    if (isParentItselfEntry(entry)) {
      return entry.sibling.declarations;
    }
    return [createNestedChild(entry)];
  });
  return factorCommonParents(declarations, true);
}

/**
 * Collects the run of consecutive sibling rules, starting at a given index,
 * whose selectors can all nest under a candidate parent. Comments never affect
 * the cascade, so they are passed over instead of ending the run, while any
 * other entry that is not a rule, such as an at-rule, ends it. A rule that
 * cannot nest stays in place, and later rules may only join the run when they
 * can move across every rule left behind since the last rule that joined.
 * Only the rules whose first selector starts with the parent can nest under
 * it, so the others are never visited.
 *
 * @param  {Array}  rules           The sibling AST entries.
 * @param  {number} startIndex      The index the run starts at.
 * @param  {string} parentSelector  The candidate parent selector.
 * @param  {object} siblingIndex    The lookups built by `createSiblingIndex` for the siblings.
 * @return {object}                 The `run` of rules paired with their nested selectors, the `retainedEntries` left between them, and the `end` index just past the run's last rule.
 */
function collectSiblingRun (rules, startIndex, parentSelector, siblingIndex) {
  const { findRulesStartingWith, writeIndex } = siblingIndex;
  const matchNestedSelector = createNestedSelectorMatcher(parentSelector);
  const candidateIndexes = findRulesStartingWith(parentSelector.trim());
  const barrierPosition = findFirstPositionAtLeast(writeIndex.barrierIndexes, startIndex);
  const barrierIndex = writeIndex.barrierIndexes[barrierPosition] ?? rules.length;
  const run = [];
  const selectedIndexes = new Set();
  let lastSelectedIndex = startIndex - 1;

  for (
    let position = findFirstPositionAtLeast(candidateIndexes, startIndex);
    position < candidateIndexes.length && candidateIndexes[position] < barrierIndex;
    position++
  ) {
    const siblingPosition = candidateIndexes[position];
    const sibling = rules[siblingPosition];
    const nestedSelectors = nestSelectorsUnderParent(sibling, matchNestedSelector);
    if (nestedSelectors && canMoveRuleAcrossRange(sibling, writeIndex, lastSelectedIndex, siblingPosition)) {
      selectedIndexes.add(siblingPosition);
      lastSelectedIndex = siblingPosition;
      run.push({ sibling, nestedSelectors });
    }
  }

  const end = lastSelectedIndex + 1;
  const retainedEntries = rules.slice(startIndex, end).filter((entry, relativeIndex) => {
    return !selectedIndexes.has(startIndex + relativeIndex);
  });
  return { end, retainedEntries, run };
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
function factorCommonParentsPass (rules, allowTrailingCompound = false) {
  const result = [];
  const siblingIndex = createSiblingIndex(rules);
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
      if (!candidateParent || candidateParent === '&' || containsPseudoElement(candidateParent)) {
        continue;
      }
      const { end, retainedEntries, run } = collectSiblingRun(rules, index, candidateParent, siblingIndex);
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
          declarations,
          end,
          parent: candidateParent,
          retainedEntries,
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
    result.push({
      type: 'rule',
      selectors: [bestGrouping.parent],
      declarations: bestGrouping.declarations
    });
    result.push(...bestGrouping.retainedEntries);
    index = bestGrouping.end;
  }
  return result;
}

/**
 * Factors shared selector parents throughout a rule list and its nested rules,
 * repeating productive passes until the selector text stops shrinking.
 *
 * @param  {Array}   rules                  The AST entries to factor.
 * @param  {boolean} allowTrailingCompound  Whether nested trailing compounds may also be factored.
 * @return {Array}                          The rules with shared parents factored.
 */
function factorCommonParents (rules, allowTrailingCompound = false) {
  const rulesWithFactoredBodies = rules.map((rule) => {
    if (rule.type === 'rule' && rule.declarations) {
      return {
        ...rule,
        declarations: factorCommonParents(rule.declarations, true)
      };
    }
    return rule;
  });
  let currentRules = rulesWithFactoredBodies;
  let factorizedRules = factorCommonParentsPass(currentRules, allowTrailingCompound);
  let previousLength = measureRuleCharacters(currentRules);
  let currentLength = measureRuleCharacters(factorizedRules);

  while (currentLength < previousLength) {
    currentRules = factorizedRules;
    previousLength = currentLength;
    factorizedRules = factorCommonParentsPass(currentRules, allowTrailingCompound);
    currentLength = measureRuleCharacters(factorizedRules);
  }

  return factorizedRules;
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
