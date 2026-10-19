/**
 * @file Token-aware font shorthand minification.
 */

import { CSS_WIDE_KEYWORDS } from '../declarations/config.js';
import { tokenizeCssValue } from '../parser/tokenizer.js';

/**
 * Keywords that would change a quoted family into a generic family.
 *
 * @type {Set<string>}
 */
const GENERIC_FAMILY_NAMES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'math', 'emoji', 'fangsong', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded'
]);

/**
 * Removes family quotes only when their contents form ordinary identifiers.
 *
 * @param  {string} text  A family string token.
 * @return {string}       The shortest safe spelling.
 */
function shortenFamilyString (text) {
  const inner = text.slice(1, -1);
  if (inner.includes('\\') || inner.trim() !== inner) {
    return text;
  }
  const tokens = tokenizeCssValue(inner);
  const isIdentifierList = tokens.length && tokens.every((token) => {
    if (token.type === 'whitespace') {
      return true;
    }
    const keyword = token.text.toLowerCase();
    return token.type === 'ident' && !CSS_WIDE_KEYWORDS.has(keyword) && keyword !== 'default';
  });
  if (!isIdentifierList || GENERIC_FAMILY_NAMES.has(inner.toLowerCase())) {
    return text;
  }
  return inner;
}

/**
 * Locates a size before rewriting optional components. A substituted or
 * calculated prefix is left intact because its component boundaries may not
 * be knowable until the browser resolves it.
 *
 * @param  {Array}  tokens  The font tokens.
 * @return {number}         The size index, or -1 if the prefix is ambiguous.
 */
function findFontSizeIndex (tokens) {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'function') {
      return -1;
    }
    // An oblique font style may state an angle before the font size.
    const isAngle = token.type === 'dimension' && /(?:deg|grad|rad|turn)$/i.test(token.text);
    if (token.type === 'dimension' && !isAngle) {
      return index;
    }
    // Match absolute and relative size keywords, not family-name substrings.
    const isSizeKeyword = token.type === 'ident' &&
      /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i.test(token.text);
    if (isSizeKeyword || token.type === 'percentage' || (token.type === 'number' && Number(token.text) === 0)) {
      return index;
    }
  }
  return -1;
}

/**
 * Normalizes optional font components before the size, leaving the family and
 * line height in their respective grammar positions.
 *
 * @param  {string} value  The font shorthand.
 * @return {string}        The minified shorthand.
 */
function minifyFontShorthand (value) {
  const tokens = tokenizeCssValue(value);
  const sizeIndex = findFontSizeIndex(tokens);
  if (sizeIndex === -1) {
    return value;
  }
  return tokens.map((token, index) => {
    if (index < sizeIndex) {
      if (token.type === 'ident') {
        const keyword = token.text.toLowerCase();
        if (keyword === 'normal') {
          return '';
        }
        if (keyword === 'bold') {
          return '700';
        }
      } else if (token.type === 'number' && token.text === '400') {
        return '';
      }
    }
    if (index > sizeIndex && token.type === 'string') {
      const family = shortenFamilyString(token.text);
      if (family !== token.text && tokens[index - 1]?.type !== 'whitespace' && tokens[index - 1]?.text !== ',') {
        return ' ' + family;
      }
      return family;
    }
    return token.text;
  }).join('').trim();
}

export { minifyFontShorthand };
