/**
 * @file Preprocesses CSS declaration blocks by converting Unicode escape sequences to their literal characters before parsing.
 */

import { resolveUnicodeEscape } from './utilities.js';

/**
 * Converts CSS Unicode escape sequences inside declaration blocks to their literal character equivalents, while preserving control characters that must remain escaped.
 *
 * @param  {string} css  The raw CSS string to preprocess.
 * @return {string}      The CSS string with printable Unicode escapes resolved inside declaration blocks.
 */
function preprocessDeclarationBlocks (css) {
  // Match top-level declaration blocks (non-nested { ... })
  return css.replace(/\{([^{}]*)\}/g, (match, content) => {
    // Skip quoted strings, then match CSS unicode escapes (backslash + 1-6 hex digits + optional whitespace)
    const processed = content.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\([0-9a-fA-F]{1,6})\s?/g, (fullMatch, hex) => {
      if (!hex) {
        return fullMatch;
      }
      return resolveUnicodeEscape(hex) ?? fullMatch;
    });
    return '{' + processed + '}';
  });
}

export { preprocessDeclarationBlocks };
