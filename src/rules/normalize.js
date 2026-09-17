/**
 * @file Normalizes CSS selectors, `@media` queries, and `@supports` conditions by unescaping identifiers and collapsing whitespace.
 */

import { resolveUnicodeEscape } from '../utilities.js';

/**
 * Converts CSS Unicode escape sequences in an identifier to their literal characters, preserving control characters that must remain escaped.
 *
 * @param  {string} identifier  The CSS identifier string to unescape.
 * @return {string}             The identifier with printable Unicode escapes resolved.
 */
function unescapeIdent (identifier) {
  // Match CSS unicode escapes: backslash + 1-6 hex digits + optional trailing whitespace
  return identifier.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
    return resolveUnicodeEscape(hex) ?? match;
  });
}

/**
 * Converts CSS Unicode escape sequences in a selector to literal characters, preserving escapes that are syntactically required such as leading digits after class or ID selectors.
 *
 * @param  {string} selector  The CSS selector string to unescape.
 * @return {string}           The selector with safe Unicode escapes resolved.
 */
function unescapeSelector (selector) {
  // Match CSS unicode escapes: backslash + 1-6 hex digits + optional trailing whitespace
  return selector.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex, offset) => {
    const character = resolveUnicodeEscape(hex);
    if (character === null) {
      return match;
    }
    let precedingCharacter;
    if (offset > 0) {
      precedingCharacter = selector[offset - 1];
    } else {
      precedingCharacter = '';
    }
    // Check if the unescaped character is a digit that would form an invalid start of a class/id name
    const isLeadingDigitAfterSelector = (
      /[0-9]/.test(character) &&
      (offset === 0 || precedingCharacter === '.' || precedingCharacter === '#')
    );
    if (isLeadingDigitAfterSelector) {
      return match;
    }
    return character;
  });
}

/**
 * Matches a single whitespace character.
 *
 * @type {RegExp}
 */
const WHITESPACE_CHARACTER = /\s/;

/**
 * Collapses every run of whitespace in a selector down to the single space a
 * descendant combinator is written with, and trims the ends. Whitespace held
 * inside a quoted string, or written as an escape, is copied through untouched:
 * there it is part of the value being matched rather than a combinator.
 *
 * @param  {string} selector  The raw selector string.
 * @return {string}           The selector with its combinator whitespace normalized.
 */
function normalizeSelectorWhitespace (selector) {
  let normalized = '';
  let quoteDelimiter = '';
  let index = 0;
  while (index < selector.length) {
    const character = selector[index];
    if (quoteDelimiter) {
      if (character === '\\') {
        normalized += selector.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (character === quoteDelimiter) {
        quoteDelimiter = '';
      }
      normalized += character;
      index++;
      continue;
    }
    if (character === '"' || character === '\'') {
      quoteDelimiter = character;
      normalized += character;
      index++;
      continue;
    }
    if (character === '\\') {
      normalized += selector.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (WHITESPACE_CHARACTER.test(character)) {
      normalized += ' ';
      while (index < selector.length && WHITESPACE_CHARACTER.test(selector[index])) {
        index++;
      }
      continue;
    }
    normalized += character;
    index++;
  }
  return normalized.trim();
}

/**
 * Rewrites every selector in a stylesheet into its whitespace-normalized form,
 * descending into nested rules and the bodies of at-rules. Running this before
 * any rule is rewritten means each later pass compares, nests, and prints
 * selectors that are already written the one canonical way, so a selector that
 * happens to be spaced out in the source cannot leak that spacing into a
 * selector the minifier builds from it.
 *
 * @param {Array} rules  The AST rule nodes to normalize.
 */
function normalizeRuleSelectors (rules) {
  for (const rule of rules || []) {
    if (rule?.selectors?.length) {
      rule.selectors = rule.selectors.map(normalizeSelectorWhitespace);
    }
    normalizeRuleSelectors(rule?.rules);
    normalizeRuleSelectors(rule?.declarations);
  }
}

/**
 * Normalizes a `@layer` cascade layer name list by trimming it and removing the
 * optional whitespace that may surround the commas separating the layer names.
 *
 * @param  {string} layerNames  The raw layer name list (e.g. "reset, base,\n  components").
 * @return {string}             The normalized comma-separated layer name list.
 */
function normalizeLayerNames (layerNames) {
  // Collapse the optional whitespace surrounding the commas between layer names
  return String(layerNames ?? '').trim().replace(/\s*,\s*/g, ',');
}

/**
 * Normalizes a `@media` query string by collapsing whitespace, stripping the default "all and" prefix, and converting min/max-width to range syntax.
 *
 * @param  {string} media  The raw `@media` query string.
 * @return {string}        The normalized and minified media query.
 */
function normalizeMedia (media) {
  // Collapse whitespace, strip spaces around punctuation, and remove the redundant "all and" prefix
  media = media.replace(/\s+/g, ' ').replace(/\s*([:,])\s*/g, '$1').replace(/\s*([=<>])\s*/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\b(?:all and )/gi, '');
  // Convert min-width/max-width to range syntax (e.g. min-width:768px → width>=768px)
  media = media.replace(/min-width:(\d+[a-z%]*)/gi, 'width>=$1').replace(/max-width:(\d+[a-z%]*)/gi, 'width<=$1');
  media = media.replace(/min-height:(\d+[a-z%]*)/gi, 'height>=$1').replace(/max-height:(\d+[a-z%]*)/gi, 'height<=$1');
  // Combine adjacent min+max range queries into a single range expression: (width>=X) and (width<=Y) → (X<=width<=Y)
  media = media.replace(
    /\((\w+)>=(\d+[a-z%]*)\)\s+and\s+\((\w+)<=(\d+[a-z%]*)\)/gi,
    (fullMatch, minProperty, minValue, maxProperty, maxValue) => {
      if (minProperty === maxProperty) {
        return '(' + minValue + '<=' + minProperty + '<=' + maxValue + ')';
      }
      return fullMatch;
    }
  );
  return compactLogicalOperators(media.trim());
}

/**
 * Removes the whitespace between a closing parenthesis and a following `and`/`or`
 * logical operator, which a closing parenthesis already separates unambiguously.
 * The space after the operator is required, since it separates the operator from
 * the next condition's opening parenthesis.
 *
 * @param  {string} condition  A normalized `@media` or `@supports` condition string.
 * @return {string}            The condition with tightened logical operator spacing.
 */
function compactLogicalOperators (condition) {
  // Compact logical operator spacing: ") and (" → ")and (", ") or (" → ")or ("
  return condition.replace(/\)\s*(and|or)\s*\(/gi, ')$1 (');
}

/**
 * Normalizes a `@supports` condition string by collapsing whitespace, trimming, and standardizing spacing around logical operators.
 *
 * @param  {string} supports  The raw `@supports` condition string.
 * @return {string}           The normalized `@supports` condition.
 */
function normalizeSupports (supports) {
  // Collapse whitespace and strip spaces around punctuation
  supports = supports.replace(/\s+/g, ' ').replace(/\s*([:,])\s*/g, '$1').replace(/\s*([=<>])\s*/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  supports = supports.replace(/\s+and\s+/g, ' and ').replace(/\s+or\s+/g, ' or ').replace(/\s+not\s+/g, ' not ');
  return compactLogicalOperators(supports);
}

/**
 * Checks if a `@supports` condition tests for universally supported features like display:grid or display:flex, allowing the `@supports` wrapper to be safely removed.
 *
 * @param  {string}  supports  The normalized `@supports` condition string.
 * @return {boolean}           True if the `@supports` block can be unwrapped.
 */
function canUnwrapSupports (supports) {
  return supports === '(display:grid)' || supports === '(display:flex)';
}

export {
  canUnwrapSupports,
  normalizeLayerNames,
  normalizeMedia,
  normalizeRuleSelectors,
  normalizeSupports,
  unescapeIdent,
  unescapeSelector
};
