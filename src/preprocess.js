/**
 * @file Preprocesses CSS declaration blocks by converting Unicode escape sequences to their literal characters before parsing.
 */

import { resolveUnicodeEscape } from './utilities.js';

/**
 * Converts CSS Unicode escape sequences inside declaration blocks to their literal character equivalents, while preserving control characters that must remain escaped.
 * Also cleans up malformed CSS syntax that would cause parser failures.
 *
 * @param  {string} css  The raw CSS string to preprocess.
 * @return {string}      The CSS string with printable Unicode escapes resolved inside declaration blocks and syntax errors fixed.
 */
function preprocessDeclarationBlocks (css) {
  // Match top-level declaration blocks (non-nested { ... })
  return css.replace(/\{([^{}]*)\}/g, (match, content) => {
    // First, remove semicolons after comments which cause parser errors
    // Pattern: comment followed by optional whitespace and semicolon
    let processed = content.replace(/\/\*.*?\*\/\s*;/g, (commentMatch) => {
      // Remove the trailing semicolon from comment+semicolon combinations
      return commentMatch.replace(/;$/, '');
    });
    
    // Then, skip quoted strings and match CSS unicode escapes (backslash + 1-6 hex digits + optional whitespace)
    processed = processed.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\([0-9a-fA-F]{1,6})\s?/g, (fullMatch, hex) => {
      if (!hex) {
        return fullMatch;
      }
      return resolveUnicodeEscape(hex) ?? fullMatch;
    });
    
    return '{' + processed + '}';
  });
}

export { preprocessDeclarationBlocks };
