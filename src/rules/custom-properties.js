/**
 * @file Custom property value whitespace and comment processing for CSS minification.
 */

import { tokenizeCssValue } from '../parser/tokenizer.js';
import { formatCompactNumber } from '../value/shared.js';

/**
 * Removes spaces after commas only inside parenthesized groups (function
 * calls like `var()`, `calc()`), leaving top-level comma spacing intact.
 *
 * @param  {string} value  The whitespace-collapsed custom property value.
 * @return {string}        The value with post-comma spaces removed inside function calls only.
 */
function removeSpacesAfterCommasInsideFunctions (value) {
  let result = '';
  let parenthesisDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '(') {
      parenthesisDepth++;
    }
    if (character === ')') {
      parenthesisDepth--;
    }
    if (character === ',' && parenthesisDepth > 0) {
      result += ',';
      // Skip whitespace after the comma inside function calls
      while (index + 1 < value.length && value[index + 1] === ' ') {
        index++;
      }
    } else {
      result += character;
    }
  }
  return result;
}

/**
 * The token types whose text begins with a number, and so may hold digits that
 * are written out longer than they need to be.
 *
 * @type {Set<string>}
 */
const NUMERIC_TOKEN_TYPES = new Set(['number', 'dimension', 'percentage']);

/**
 * Splits a numeric token into the decimal number it states and the unit
 * written on it. A number carrying a scientific exponent does not match, since
 * its digits cannot be restated without reading the exponent along with them,
 * and neither does a whole number, which has no zeros to shed.
 *
 * @type {RegExp}
 */
const DECIMAL_NUMBER_TOKEN = /^([+-]?(?:\d+\.\d+|\.\d+))([a-zA-Z%]*)$/;

/**
 * Restates a numeric token as the shortest way of writing the same number,
 * dropping the zeros that lead the decimal point and the ones that trail the
 * digits behind it (`-0.020em` becomes `-.02em`). A token that is not a plain
 * decimal, or whose number is only expressible in scientific notation, is left
 * exactly as it was written.
 *
 * @param  {string} tokenText  The text of a number, dimension, or percentage token.
 * @return {string}            The shortest way of writing that same token.
 */
function shortenNumericToken (tokenText) {
  const decimalNumber = tokenText.match(DECIMAL_NUMBER_TOKEN);
  if (!decimalNumber) {
    return tokenText;
  }
  const [, number, unit] = decimalNumber;
  const shortened = formatCompactNumber(number);
  // A number too small or too large to write out plainly comes back in
  // scientific notation, which reads as a different token once a unit follows
  if (shortened.includes('e')) {
    return tokenText;
  }
  return shortened + unit;
}

/**
 * Reports whether two token lists say the same thing, which is what tells a
 * rewritten value apart from one whose tokens have run together. Shortening
 * the numbers of `1.0.0` would leave `10`, a single number where two stood.
 *
 * @param  {Array}   tokens           The tokens the value was read as.
 * @param  {Array}   rewrittenTokens  The tokens the rewritten value reads as.
 * @return {boolean}                  Whether the rewrite left every token boundary in place.
 */
function hasSameTokenBoundaries (tokens, rewrittenTokens) {
  if (tokens.length !== rewrittenTokens.length) {
    return false;
  }
  return tokens.every((token, index) => {
    return token.type === rewrittenTokens[index].type;
  });
}

/**
 * Writes every number in a custom property value the shortest way it can be
 * written. A custom property holds an arbitrary token sequence, so the value
 * is walked token by token: only the tokens that state a number are rewritten,
 * leaving strings, urls, and hash tokens exactly as the author wrote them.
 *
 * @param  {string} value  The custom property value string.
 * @return {string}        The value with its numbers shortened.
 */
function shortenNumbers (value) {
  const tokens = tokenizeCssValue(value);
  const rewritten = tokens
    .map((token) => {
      if (!NUMERIC_TOKEN_TYPES.has(token.type)) {
        return token.text;
      }
      return shortenNumericToken(token.text);
    })
    .join('');
  if (!hasSameTokenBoundaries(tokens, tokenizeCssValue(rewritten))) {
    return value;
  }
  return rewritten;
}

/**
 * Processes CSS comments within a custom property value. If the value
 * consists entirely of a comment, the comment is removed (producing an
 * empty value). If comments appear between other tokens, their content
 * is stripped but empty comment delimiters are kept as zero-width
 * token separators to preserve the token sequence.
 *
 * @param  {string} value  The raw custom property value string.
 * @return {string}        The value with comments processed.
 */
function processCustomPropertyComments (value) {
  // Match values that are entirely a comment (with optional surrounding whitespace)
  const commentOnlyPattern = /^\s*\/\*.*?\*\/\s*$/s;
  if (commentOnlyPattern.test(value)) {
    return '';
  }
  // Strip comment content but keep empty markers as token separators
  return value.replace(/\/\*.*?\*\//g, '/**/');
}

/**
 * Collapses whitespace in a custom property value while preserving
 * token boundaries. Each whitespace sequence is reduced to a single
 * space, spaces after commas inside function calls are removed, and
 * every number is written the shortest way it can be.
 *
 * @param  {string} value  The raw custom property value string.
 * @return {string}        The minified custom property value.
 */
function collapseCustomPropertyWhitespace (value) {
  // Collapse all whitespace sequences (newlines, tabs, multiple spaces) to a single space
  let collapsed = value.replace(/\s+/g, ' ');
  // Remove spaces after commas only inside function calls (e.g. var(--bar, 1.5) → var(--bar,1.5))
  collapsed = removeSpacesAfterCommasInsideFunctions(collapsed);
  // Shorten decimals (e.g. 0.5 → .5, -0.020em → -.02em)
  collapsed = shortenNumbers(collapsed);
  return collapsed;
}
export {
  collapseCustomPropertyWhitespace,
  processCustomPropertyComments
};
