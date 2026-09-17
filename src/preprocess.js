/**
 * @file Preprocesses CSS declaration blocks by converting Unicode escape sequences to their literal characters before parsing.
 */

import { isUnicodeCharset } from './context.js';
import { resolveUnicodeEscape } from './utilities.js';

/**
 * Converts CSS Unicode escape sequences inside declaration blocks to their
 * literal character equivalents, while preserving the control characters that
 * must remain escaped. A property name is read as written, so an escape in one
 * is resolved before the parse rather than after it.
 *
 * @param  {string} css  The raw CSS string to preprocess.
 * @return {string}      The CSS string with printable Unicode escapes resolved inside declaration blocks.
 */
function preprocessDeclarationBlocks (css) {
  if (!isUnicodeCharset()) {
    return css;
  }
  // Match the innermost declaration blocks, which hold no block of their own
  return css.replace(/\{([^{}]*)\}/g, (blockMatch, blockContents) => {
    // Match a quoted string, whose escapes are data, or a unicode escape
    // outside one: a backslash, one to six hexadecimal digits, and the
    // optional whitespace that ends the escape
    const resolved = blockContents.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\([0-9a-fA-F]{1,6})\s?/g, (escapeMatch, hex) => {
      if (!hex) {
        return escapeMatch;
      }
      return resolveUnicodeEscape(hex) ?? escapeMatch;
    });
    return '{' + resolved + '}';
  });
}

export { preprocessDeclarationBlocks };
