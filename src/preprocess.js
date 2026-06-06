/**
 * @file Preprocesses CSS declaration blocks by converting Unicode escape sequences to their literal characters before parsing.
 */

import { resolveUnicodeEscape } from './utilities.js';

/**
 * Automatically fixes common CSS syntax errors that would cause parsing to fail.
 * Handles missing closing braces, unmatched quotes, and other structural issues.
 *
 * @param  {string} css  The raw CSS string to fix.
 * @return {string}      The CSS string with common syntax errors corrected.
 */
function fixCommonSyntaxErrors (css) {
  let fixed = css;

  // Fix missing closing braces by analyzing brace balance
  // Count braces while ignoring those inside comments and strings
  let openBraces = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let commentType = '';

  for (let i = 0; i < fixed.length; i++) {
    const char = fixed[i];
    const prevChar = i > 0 ? fixed[i - 1] : '';

    // Handle string state
    if (!inComment && (char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = '';
      }
    }

    // Handle comment state
    if (!inString) {
      if (!inComment && char === '/' && i + 1 < fixed.length && fixed[i + 1] === '*') {
        inComment = true;
        commentType = '/*';
        i++; // Skip the next character
      } else if (inComment && commentType === '/*' && char === '*' && i + 1 < fixed.length && fixed[i + 1] === '/') {
        inComment = false;
        commentType = '';
        i++; // Skip the next character
      }
    }

    // Count braces only when not in strings or comments
    if (!inString && !inComment) {
      if (char === '{') {
        openBraces++;
      } else if (char === '}') {
        openBraces--;
      }
    }
  }

  // Add missing closing braces
  if (openBraces > 0) {
    fixed += '}'.repeat(openBraces);
  }

  // Fix unclosed strings (common in malformed CSS)
  if (inString) {
    fixed += stringChar;
  }

  // Fix unclosed comments
  if (inComment && commentType === '/*') {
    fixed += '*/';
  }

  return fixed;
}

/**
 * Converts CSS Unicode escape sequences inside declaration blocks to their literal character equivalents, while preserving control characters that must remain escaped.
 * Also cleans up malformed CSS syntax that would cause parser failures.
 *
 * @param  {string} css  The raw CSS string to preprocess.
 * @return {string}      The CSS string with printable Unicode escapes resolved inside declaration blocks and syntax errors fixed.
 */
function preprocessDeclarationBlocks (css) {
  // First, fix common syntax errors that would cause parsing to fail
  let processed = fixCommonSyntaxErrors(css);

  // Match top-level declaration blocks (non-nested { ... })
  return processed.replace(/\{([^{}]*)\}/g, (match, content) => {
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
