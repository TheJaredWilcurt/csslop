/**
 * @file Nests flat rules under a preceding rule whose selector their own selector starts with, so CSS nesting writes the shared part once.
 */

import { findTopLevelDelimiter } from '../../parser/source-search.js';

/**
 * Matches the part of a child selector that follows its parent when that part
 * starts with an explicit combinator. Optional whitespace, then the combinator
 * (`>`, `+`, or `~`) is captured, then optional whitespace, then the rest of
 * the selector is captured.
 *
 * @type {RegExp}
 */
const LEADING_COMBINATOR_PATTERN = /^\s*([>+~])\s*(.+)$/;

/**
 * Expresses the part of a child selector that follows its parent as the
 * selector it would be once nested inside that parent.
 *
 * @param  {string}      remainder  The child selector with the parent prefix removed.
 * @return {string|null}            The nested selector, or null when the remainder cannot be nested.
 */
function nestSelectorRemainder (remainder) {
  if (!remainder) {
    return '&';
  }
  if (remainder.startsWith(':')) {
    return '&' + remainder;
  }
  if (remainder.startsWith(' ')) {
    return remainder.slice(1);
  }
  const combinatorMatch = remainder.match(LEADING_COMBINATOR_PATTERN);
  if (combinatorMatch) {
    return combinatorMatch[1] + combinatorMatch[2];
  }
  return null;
}

/**
 * Builds a reusable matcher that expresses child selectors as nested selectors
 * relative to one parent. Most children tested against a parent do not start
 * with it at all, so that cheap prefix check runs before anything else.
 *
 * @param  {string}                          parentSelector  The parent selector string.
 * @return {function(string): (string|null)}                 A matcher returning the nested selector, or null when the child cannot be nested.
 */
function createNestedSelectorMatcher (parentSelector) {
  const parent = parentSelector.trim();

  return (childSelector) => {
    const child = childSelector.trim();
    if (!child.startsWith(parent)) {
      return null;
    }
    return nestSelectorRemainder(child.slice(parent.length));
  };
}

/**
 * Attempts to express a child selector as a nested selector relative to a parent, returning the nested form or null if nesting is not possible.
 *
 * @param  {string}      parentSelector  The parent selector string.
 * @param  {string}      childSelector   The child selector string to try nesting.
 * @return {string|null}                 The nested selector using & syntax, or null if the child cannot be nested under the parent.
 */
function tryNestSelector (parentSelector, childSelector) {
  return createNestedSelectorMatcher(parentSelector)(childSelector);
}

/**
 * Determines whether a character is CSS whitespace.
 *
 * @param  {string}  character  A single character from a selector.
 * @return {boolean}            Whether the character is whitespace.
 */
function isSelectorWhitespace (character) {
  // Match a single whitespace character
  return (/\s/).test(character);
}

/**
 * The characters that can end a parent selector: the colon of a pseudo-class,
 * the whitespace of a descendant combinator, and the explicit combinators.
 *
 * @type {string}
 */
const PARENT_BOUNDARY_CHARACTERS = ':>+~ \t\n\r\f';

/**
 * Records the parent selector that a boundary character would end, when it
 * ends one. Boundaries are only found at the top level of the selector, so
 * whitespace inside an attribute selector or a pseudo-class argument, and
 * characters escaped with a backslash, never end a parent.
 *
 * @param {string} childSelector  The trimmed child selector.
 * @param {number} boundaryIndex  The index of the boundary character within the child selector.
 * @param {Set}    candidates     The set the candidate parent selector is added to.
 */
function addCandidateParentSelector (childSelector, boundaryIndex, candidates) {
  const character = childSelector[boundaryIndex];
  if (character === ':' || isSelectorWhitespace(character)) {
    // The second colon of a pseudo-element is part of its `::` introducer,
    // not a boundary between a potential parent and nested child.
    if (character === ':' && childSelector[boundaryIndex - 1] === ':') {
      return;
    }
    candidates.add(childSelector.slice(0, boundaryIndex));
    return;
  }
  // A combinator may be separated from its parent by whitespace, which
  // belongs to neither side, so the parent ends where that run begins.
  let boundary = boundaryIndex;
  while (boundary > 0 && isSelectorWhitespace(childSelector[boundary - 1])) {
    boundary--;
  }
  if (boundary > 0) {
    candidates.add(childSelector.slice(0, boundary));
  }
}

/**
 * Collects every prefix of a child selector that could act as its nesting
 * parent. A parent always ends immediately before a pseudo-class colon, a
 * descendant whitespace run, or the whitespace run leading into a combinator,
 * so only those few positions can start a nestable remainder. Enumerating them
 * turns "which earlier rule can host this one" into a set of key lookups
 * instead of a comparison against every preceding rule.
 *
 * @param  {string} childSelector  The trimmed child selector.
 * @return {Set}                   The candidate parent selector strings.
 */
function collectCandidateParentSelectors (childSelector) {
  const candidates = new Set();
  let boundaryIndex = findTopLevelDelimiter(childSelector, PARENT_BOUNDARY_CHARACTERS, 1);
  while (boundaryIndex !== -1) {
    addCandidateParentSelector(childSelector, boundaryIndex, candidates);
    boundaryIndex = findTopLevelDelimiter(childSelector, PARENT_BOUNDARY_CHARACTERS, boundaryIndex + 1);
  }
  return candidates;
}

/**
 * Finds the most recently emitted rule that can host a child selector as a
 * nested rule, matching the behaviour of scanning backwards through the emitted
 * rules but only visiting the handful of rules whose selector is a viable
 * parent prefix.
 *
 * @param  {Array}       emittedRules     The rules emitted so far.
 * @param  {Map}         indexBySelector  Map of each emitted single-selector rule's selector to its index.
 * @param  {string}      childSelector    The trimmed child selector to nest.
 * @return {object|null}                  The `parentIndex` and `nestedSelector`, or null when nothing can host the child.
 */
function findNestingParent (emittedRules, indexBySelector, childSelector) {
  const parentIndexes = [];
  for (const candidateParent of collectCandidateParentSelectors(childSelector)) {
    const parentIndex = indexBySelector.get(candidateParent);
    if (parentIndex !== undefined) {
      parentIndexes.push(parentIndex);
    }
  }
  // The nearest preceding parent wins, exactly as a backwards scan would.
  parentIndexes.sort((first, second) => {
    return second - first;
  });
  for (const parentIndex of parentIndexes) {
    const nestedSelector = tryNestSelector(emittedRules[parentIndex].selectors[0], childSelector);
    if (nestedSelector !== null) {
      return {
        nestedSelector,
        parentIndex
      };
    }
  }
  return null;
}

/**
 * Groups flat CSS rules into nested structures where a child selector can be expressed relative to a preceding parent, reducing output size through CSS nesting.
 *
 * @param  {Array} rules  The flat AST rule nodes to nest.
 * @return {Array}        A new array of rules with applicable children nested under their parents.
 */
function nestFlatRules (rules) {
  const result = [];
  const indexBySelector = new Map();
  for (const rule of rules) {
    if (rule.type !== 'rule') {
      result.push(rule);
      continue;
    }
    if (rule.selectors?.length === 1) {
      const childSelector = rule.selectors[0].trim();
      const nesting = findNestingParent(result, indexBySelector, childSelector);
      if (nesting) {
        const parentRule = result[nesting.parentIndex];
        parentRule.declarations = parentRule.declarations || [];
        parentRule.declarations.push({ ...rule, selectors: [nesting.nestedSelector] });
        continue;
      }
      indexBySelector.set(childSelector, result.length);
      result.push(rule);
      continue;
    }
    if (rule.selectors?.length > 1) {
      const nestedSelectors = [];
      let commonParentIndex = null;
      let canNestAll = true;

      for (const childSelector of rule.selectors) {
        const nesting = findNestingParent(result, indexBySelector, childSelector.trim());
        if (!nesting) {
          canNestAll = false;
          break;
        }
        if (commonParentIndex === null) {
          commonParentIndex = nesting.parentIndex;
        } else if (nesting.parentIndex !== commonParentIndex) {
          canNestAll = false;
          break;
        }
        nestedSelectors.push(nesting.nestedSelector);
      }

      if (canNestAll && commonParentIndex !== null) {
        const parentRule = result[commonParentIndex];
        parentRule.declarations = parentRule.declarations || [];
        parentRule.declarations.push({ ...rule, selectors: nestedSelectors });
        continue;
      }

      for (const selector of rule.selectors) {
        indexBySelector.set(selector.trim(), result.length);
      }
      result.push(rule);
      continue;
    }
    result.push(rule);
  }
  for (const rule of result) {
    if (rule.type === 'rule' && rule.declarations) {
      const innerRules = rule.declarations.filter((declaration) => {
        return declaration.type === 'rule';
      });
      if (innerRules.length > 0) {
        const nonRuleDeclarations = rule.declarations.filter((declaration) => {
          return declaration.type !== 'rule';
        });
        rule.declarations = [...nonRuleDeclarations, ...nestFlatRules(innerRules)];
      }
    }
  }
  return result;
}

export {
  collectCandidateParentSelectors,
  createNestedSelectorMatcher,
  isSelectorWhitespace,
  nestFlatRules
};
