/**
 * @file Custom property value whitespace and comment processing for CSS minification.
 */

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
 * Strips leading zeros from decimal numbers in a custom property value
 * (e.g. `0.5` becomes `.5`, `-0.02em` becomes `-.02em`).
 *
 * @param  {string} value  The custom property value string.
 * @return {string}        The value with leading zeros removed from decimals.
 */
function stripLeadingZerosFromDecimals (value) {
  // Match a boundary (start, whitespace, comma, open-paren), optional sign, then leading zeros before a decimal
  return value.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3');
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
 * leading zeros on decimal numbers are stripped.
 *
 * @param  {string} value  The raw custom property value string.
 * @return {string}        The minified custom property value.
 */
function collapseCustomPropertyWhitespace (value) {
  // Collapse all whitespace sequences (newlines, tabs, multiple spaces) to a single space
  let collapsed = value.replace(/\s+/g, ' ');
  // Remove spaces after commas only inside function calls (e.g. var(--bar, 1.5) → var(--bar,1.5))
  collapsed = removeSpacesAfterCommasInsideFunctions(collapsed);
  // Strip leading zeros from decimals (e.g. 0.5 → .5, -0.02em → -.02em)
  collapsed = stripLeadingZerosFromDecimals(collapsed);
  return collapsed;
}
export {
  collapseCustomPropertyWhitespace,
  processCustomPropertyComments
};
