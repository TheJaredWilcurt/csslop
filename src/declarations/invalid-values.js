/**
 * @file Detects declaration values that a browser ignores when it parses them, so the declaration can be dropped without changing how the page renders.
 */

import { tokenizeCssValue } from '../parser/tokenizer.js';
import { isCustomProperty } from '../utilities.js';
import { namedColors, systemColors } from '../value/color/named.js';

import { CSS_WIDE_KEYWORDS } from './config.js';

/**
 * Matches an `!important` flag at the end of a value, which is not part of the value itself.
 *
 * @type {RegExp}
 */
const IMPORTANT_FLAG_PATTERN = /\s*!\s*important\s*$/i;

/**
 * Matches a hash token body made only of hexadecimal digits.
 *
 * @type {RegExp}
 */
const HEX_DIGITS_PATTERN = /^[0-9a-f]+$/i;

/**
 * The digit counts a hex color may have: `#rgb`, `#rgba`, `#rrggbb`, and `#rrggbbaa`.
 *
 * @type {Set<number>}
 */
const VALID_HEX_COLOR_LENGTHS = new Set([3, 4, 6, 8]);

/**
 * Keywords a color property accepts beyond the named and system colors:
 * `auto` for `accent-color`, `caret-color`, and `scrollbar-color`, `invert`
 * for `outline-color`, and `currentcolor` as a color in its own right.
 *
 * @type {Set<string>}
 */
const EXTRA_COLOR_KEYWORDS = new Set(['auto', 'currentcolor', 'invert']);

/**
 * Checks whether a hash token is a hex color a browser can read.
 *
 * @param  {string}  hashText  The hash token's text, including its leading `#`.
 * @return {boolean}           Whether the token has a valid hex length and only hex digits.
 */
function isValidHexColor (hashText) {
  const digits = hashText.slice(1);
  return VALID_HEX_COLOR_LENGTHS.has(digits.length) && HEX_DIGITS_PATTERN.test(digits);
}

/**
 * Checks whether a keyword is one a color property accepts. Vendor-prefixed
 * keywords are accepted without judgment, since their list is not knowable here.
 *
 * @param  {string}  keyword  The identifier written as the whole value.
 * @return {boolean}          Whether the keyword is a valid color keyword.
 */
function isKnownColorKeyword (keyword) {
  const lowercaseKeyword = keyword.toLowerCase();
  return (
    Object.hasOwn(namedColors, lowercaseKeyword) ||
    systemColors.has(lowercaseKeyword) ||
    EXTRA_COLOR_KEYWORDS.has(lowercaseKeyword) ||
    CSS_WIDE_KEYWORDS.has(lowercaseKeyword) ||
    lowercaseKeyword.startsWith('-')
  );
}

/**
 * Checks whether a color property was given a lone keyword that is not a color.
 *
 * @param  {string}  property  The CSS property name.
 * @param  {Array}   tokens    The value's tokens, without whitespace.
 * @return {boolean}           Whether the value is an unknown color keyword.
 */
function isUnknownColorKeyword (property, tokens) {
  const isLoneIdentifier = tokens.length === 1 && tokens[0].type === 'ident';
  return property.endsWith('color') && isLoneIdentifier && !isKnownColorKeyword(tokens[0].text);
}

/**
 * Checks whether a browser discards a declaration because its value does not
 * parse. Such a declaration has no effect on the page, so it must not hide an
 * earlier valid declaration of the same property. A hash token that is not a
 * valid hex color is discarded wherever it appears, and a color property given
 * a keyword that is not a color is discarded as well.
 *
 * @param  {string}  property  The CSS property name.
 * @param  {string}  value     The raw CSS value, which may end in `!important`.
 * @return {boolean}           Whether the browser ignores the declaration.
 */
function isIgnoredByBrowser (property, value) {
  if (typeof value !== 'string' || isCustomProperty(property)) {
    return false;
  }
  // Only a hash token or a color property can be ignored, and every hash token
  // starts with a literal `#`, so any other value is accepted without tokenizing
  const mayBeIgnored = value.includes('#') || property.endsWith('color');
  if (!mayBeIgnored) {
    return false;
  }
  const tokens = tokenizeCssValue(value.replace(IMPORTANT_FLAG_PATTERN, '')).filter((token) => {
    return token.type !== 'whitespace';
  });
  const hasInvalidHexColor = tokens.some((token) => {
    return token.type === 'hash' && !isValidHexColor(token.text);
  });
  return hasInvalidHexColor || isUnknownColorKeyword(property, tokens);
}

/**
 * Removes IE6 star-hack declarations such as `*zoom` from every rule and nested
 * rule. No browser applies them, so they only add bytes to the output.
 *
 * @param  {Array} rules  Stylesheet or nested body entries.
 * @return {Array}        The entries without any star-hack declarations.
 */
function removeStarHackDeclarations (rules) {
  return rules.filter((entry) => {
    return !entry.property?.startsWith('*');
  }).map((rule) => {
    if (rule.rules) {
      rule.rules = removeStarHackDeclarations(rule.rules);
    }
    if (rule.declarations) {
      rule.declarations = removeStarHackDeclarations(rule.declarations);
    }
    return rule;
  });
}

export {
  isIgnoredByBrowser,
  removeStarHackDeclarations
};
