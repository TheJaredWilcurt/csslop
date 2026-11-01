/**
 * @file Measures the specificity of selectors and selector lists, so rules can be regrouped and reordered without changing which declaration wins the cascade.
 */

import {
  findMatchingBracket,
  findMatchingParenthesis,
  splitTopLevelCommaList
} from '../../parser/source-search.js';

/**
 * Advances past a CSS identifier (name) starting at the given index.
 *
 * @param  {string} text   The selector text.
 * @param  {number} start  The index to start scanning from.
 * @return {number}        The index just after the identifier.
 */
function skipSelectorName (text, start) {
  let index = start;
  // Advance over identifier characters (letters, digits, hyphen, underscore)
  while (index < text.length && isSelectorNameCharacter(text.charCodeAt(index))) {
    index++;
  }
  return index;
}

/**
 * Reports whether a character code is an ASCII letter.
 *
 * @param  {number}  characterCode  The UTF-16 code unit of the character.
 * @return {boolean}                True for `a`-`z` and `A`-`Z`.
 */
function isAsciiLetter (characterCode) {
  return (
    (characterCode >= 97 && characterCode <= 122) ||
    (characterCode >= 65 && characterCode <= 90)
  );
}

/**
 * Reports whether a character code can appear in a selector name, which here
 * means an ASCII letter, digit, hyphen, or underscore. Comparing character
 * codes avoids running a regular expression once per character.
 *
 * @param  {number}  characterCode  The UTF-16 code unit of the character.
 * @return {boolean}                True when the character continues a name.
 */
function isSelectorNameCharacter (characterCode) {
  const isDigit = characterCode >= 48 && characterCode <= 57;
  const isHyphen = characterCode === 45;
  const isUnderscore = characterCode === 95;
  return isAsciiLetter(characterCode) || isDigit || isHyphen || isUnderscore;
}

/**
 * Compares two specificity tuples [ids, classes, types] lexicographically.
 *
 * @param  {Array}  first   The first specificity tuple.
 * @param  {Array}  second  The second specificity tuple.
 * @return {number}         Negative, zero, or positive per standard comparison.
 */
function compareSpecificity (first, second) {
  for (let index = 0; index < 3; index++) {
    if (first[index] !== second[index]) {
      return first[index] - second[index];
    }
  }
  return 0;
}

/**
 * Computes the CSS specificity of a single complex selector as an
 * [ids, classes, types] tuple. The nesting selector `&` is ignored because its
 * contribution comes from the shared parent when comparing sibling selectors.
 * Functional pseudo-classes `:is()`, `:not()`, `:has()`, and `:matches()` add
 * the maximum specificity of their arguments; `:where()` adds nothing.
 *
 * @param  {string} selector  A single complex selector string.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function computeSpecificity (selector) {
  const specificity = [0, 0, 0];
  const text = selector.trim();
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === '#') {
      specificity[0]++;
      index = skipSelectorName(text, index + 1);
    } else if (character === '.') {
      specificity[1]++;
      index = skipSelectorName(text, index + 1);
    } else if (character === '[') {
      specificity[1]++;
      // An attribute selector that never closes runs to the end of the selector
      const closeBracketIndex = findMatchingBracket(text, index);
      index = closeBracketIndex === -1 ? text.length : closeBracketIndex + 1;
    } else if (character === ':') {
      if (text[index + 1] === ':') {
        specificity[2]++;
        index = skipSelectorName(text, index + 2);
      } else {
        const nameStart = index + 1;
        const nameEnd = skipSelectorName(text, nameStart);
        const name = text.slice(nameStart, nameEnd).toLowerCase();
        if (text[nameEnd] === '(') {
          // An argument list that never closes runs to the end of the selector
          const closeIndex = findMatchingParenthesis(text, nameEnd);
          const argumentsEnd = closeIndex === -1 ? text.length : closeIndex;
          const inner = text.slice(nameEnd + 1, argumentsEnd);
          if (name === 'where') {
            // :where() contributes zero specificity
          } else if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
            const innerMax = maxSelectorSpecificity(inner);
            specificity[0] += innerMax[0];
            specificity[1] += innerMax[1];
            specificity[2] += innerMax[2];
          } else {
            specificity[1]++;
          }
          index = argumentsEnd + 1;
        } else {
          // Legacy single-colon pseudo-elements count as pseudo-elements
          if (name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') {
            specificity[2]++;
          } else {
            specificity[1]++;
          }
          index = nameEnd;
        }
      }
    } else if (character === '*' || character === '&') {
      // Universal selector and nesting selector add no counted specificity here
      index++;
    } else if (isAsciiLetter(text.charCodeAt(index))) {
      specificity[2]++;
      index = skipSelectorName(text, index);
    } else {
      // Combinators and whitespace do not affect specificity
      index++;
    }
  }
  return specificity;
}

/**
 * Memoizes the strongest and weakest specificity of each selector list seen
 * during the current stylesheet. The same rules are measured again on every
 * merge pass, and a selector list always has the same specificity, so each
 * distinct list is only split and scanned once per stylesheet.
 *
 * @type {Map<string, {strongest: Array, weakest: Array}>}
 */
const specificityRangeCache = new Map();

/**
 * Discards every memoized specificity range. The minifier calls this around
 * each stylesheet, so the cache does not outlive the pass that filled it.
 */
function clearSpecificityCache () {
  specificityRangeCache.clear();
}

/**
 * Scans every selector of a comma-separated list for the strongest and the
 * weakest specificity among them. The returned tuples are frozen because they
 * are shared by everything that asks about the same list.
 *
 * @param  {string} selectorList  The selector list string.
 * @return {object}               The `strongest` and `weakest` [ids, classes, types] tuples.
 */
function computeSpecificityRange (selectorList) {
  let strongest = [0, 0, 0];
  let weakest = null;
  for (const selector of splitTopLevelCommaList(selectorList)) {
    const specificity = computeSpecificity(selector);
    if (compareSpecificity(specificity, strongest) > 0) {
      strongest = specificity;
    }
    if (!weakest || compareSpecificity(specificity, weakest) < 0) {
      weakest = specificity;
    }
  }
  return {
    strongest: Object.freeze(strongest),
    weakest: Object.freeze(weakest || [0, 0, 0])
  };
}

/**
 * Returns the strongest and weakest specificity of a selector list, measuring
 * it the first time it is asked about.
 *
 * @param  {string} selectorList  The selector list string.
 * @return {object}               The `strongest` and `weakest` [ids, classes, types] tuples.
 */
function getSpecificityRange (selectorList) {
  let range = specificityRangeCache.get(selectorList);
  if (!range) {
    range = computeSpecificityRange(selectorList);
    specificityRangeCache.set(selectorList, range);
  }
  return range;
}

/**
 * Returns the maximum specificity tuple across a comma-separated selector list,
 * matching how a comma-separated group behaves as `:is()`.
 *
 * @param  {string} selectorList  The selector list string.
 * @return {Array}                The maximum [ids, classes, types] tuple.
 */
function maxSelectorSpecificity (selectorList) {
  return getSpecificityRange(selectorList).strongest;
}

/**
 * Returns the strongest specificity a rule can match with, which is the highest
 * of its individual selectors.
 *
 * @param  {Array} selectors  The rule's selector strings.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function maximumRuleSpecificity (selectors) {
  return maxSelectorSpecificity((selectors || []).join(','));
}

/**
 * Returns the weakest specificity a rule's declarations are applied with. Every
 * selector of a top-level rule applies the same declarations under its own
 * specificity, so the weakest selector decides whether another rule is able to
 * override the rule as a whole.
 *
 * @param  {Array} selectors  The rule's selector strings.
 * @return {Array}            The [ids, classes, types] specificity tuple.
 */
function minimumRuleSpecificity (selectors) {
  return getSpecificityRange((selectors || []).join(',')).weakest;
}

/**
 * Adds two specificity tuples together, which is how a nested selector combines
 * with the parent selector it only ever matches through.
 *
 * @param  {Array} first   The first [ids, classes, types] tuple.
 * @param  {Array} second  The second [ids, classes, types] tuple.
 * @return {Array}         The summed specificity tuple.
 */
function addSpecificity (first, second) {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2]
  ];
}

/**
 * Reports whether a rule that nests blocks may take on further selectors. A
 * nested selector resolves against its parent's whole selector list as `:is()`,
 * which matches with the specificity of the strongest selector in that list, so
 * the list may only grow while every selector in it weighs the same.
 *
 * @param  {Array}   selectors  The selector list the merged rule would carry.
 * @return {boolean}            Whether the nested blocks keep their current weight.
 */
function selectorsShareSpecificity (selectors) {
  const strongest = maximumRuleSpecificity(selectors);
  const weakest = minimumRuleSpecificity(selectors);
  return compareSpecificity(strongest, weakest) === 0;
}

export {
  addSpecificity,
  clearSpecificityCache,
  compareSpecificity,
  maximumRuleSpecificity,
  maxSelectorSpecificity,
  minimumRuleSpecificity,
  selectorsShareSpecificity
};
