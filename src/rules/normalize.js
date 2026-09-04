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
  normalizeSupports,
  unescapeIdent,
  unescapeSelector
};
