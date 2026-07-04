/**
 * @file Preprocesses CSS declaration blocks by converting Unicode escape sequences to their literal characters before parsing.
 */

import { isUnicodeCharset } from './context.js';
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
    // Remove semicolons after standalone comments (between declarations) which cause parser errors.
    // Only match when preceded by a semicolon, so property values like --foo: /*...*/; keep their terminator.
    let processed = content.replace(/(?<=;)\s*\/\*.*?\*\/\s*;/g, (commentMatch) => {
      // Remove the trailing semicolon from comment+semicolon combinations
      return commentMatch.replace(/;$/, '');
    });
    
    // Then, skip quoted strings and match CSS unicode escapes (backslash + 1-6 hex digits + optional whitespace).
    // Only resolve when the charset is unicode-compatible.
    if (isUnicodeCharset()) {
      processed = processed.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\([0-9a-fA-F]{1,6})\s?/g, (fullMatch, hex) => {
        if (!hex) {
          return fullMatch;
        }
        return resolveUnicodeEscape(hex) ?? fullMatch;
      });
    }
    
    return '{' + processed + '}';
  });
}

/**
 * Unicode Private Use Area characters used as temporary placeholders
 * for CSS escape sequences during preprocessing, preventing the parser
 * from exceeding its internal escape-counting limit on large files.
 */
const ESCAPED_COLON_PLACEHOLDER = '\uE001';
const ESCAPED_DOT_PLACEHOLDER = '\uE002';
const ESCAPED_SLASH_PLACEHOLDER = '\uE003';

/**
 * Replaces common single-character CSS escape sequences with Unicode Private
 * Use Area placeholder characters to prevent the parser from exceeding its
 * internal escape-counting limit on files with many escaped selectors
 * (e.g. Tailwind-style utility classes like `.sm\:p-0`).
 *
 * Only neutralizes escapes outside of attribute selector brackets `[...]`,
 * quoted strings, and comments so the minifier's quote-vs-escape length
 * comparisons in attribute selectors remain accurate.
 *
 * @param  {string} css  The raw CSS string to preprocess.
 * @return {string}      The CSS with escape sequences replaced by placeholders.
 */
function neutralizeEscapeSequences (css) {
  let result = '';
  let insideBrackets = false;
  let insideString = false;
  let stringDelimiter = '';
  let insideComment = false;

  for (let i = 0; i < css.length; i++) {
    const character = css[i];
    const nextCharacter = i + 1 < css.length ? css[i + 1] : '';

    // Track block comment state
    if (!insideString && !insideComment && character === '/' && nextCharacter === '*') {
      insideComment = true;
      result += '/*';
      i++;
      continue;
    }
    if (insideComment) {
      if (character === '*' && nextCharacter === '/') {
        insideComment = false;
        result += '*/';
        i++;
        continue;
      }
      result += character;
      continue;
    }

    // Track string state (preserve escapes inside strings)
    if (!insideString && (character === '"' || character === '\'')) {
      insideString = true;
      stringDelimiter = character;
      result += character;
      continue;
    }
    if (insideString) {
      if (character === '\\' && nextCharacter) {
        result += character + nextCharacter;
        i++;
        continue;
      }
      if (character === stringDelimiter) {
        insideString = false;
        stringDelimiter = '';
      }
      result += character;
      continue;
    }

    // Track attribute selector bracket state
    if (character === '[') {
      insideBrackets = true;
      result += character;
      continue;
    }
    if (character === ']') {
      insideBrackets = false;
      result += character;
      continue;
    }

    // Replace escape sequences only outside brackets, strings, and comments
    if (!insideBrackets && character === '\\') {
      if (nextCharacter === ':') {
        result += ESCAPED_COLON_PLACEHOLDER;
        i++;
        continue;
      }
      if (nextCharacter === '.') {
        result += ESCAPED_DOT_PLACEHOLDER;
        i++;
        continue;
      }
      if (nextCharacter === '/') {
        result += ESCAPED_SLASH_PLACEHOLDER;
        i++;
        continue;
      }
    }

    result += character;
  }

  return result;
}

/**
 * Restores the original CSS escape sequences from their Unicode Private Use
 * Area placeholder characters after minification is complete.
 *
 * @param  {string} css  The minified CSS string with placeholders.
 * @return {string}      The CSS with original escape sequences restored.
 */
function restoreEscapeSequences (css) {
  return css
    .replaceAll(ESCAPED_COLON_PLACEHOLDER, '\\:')
    .replaceAll(ESCAPED_DOT_PLACEHOLDER, '\\.')
    .replaceAll(ESCAPED_SLASH_PLACEHOLDER, '\\/');
}

export {
  neutralizeEscapeSequences,
  preprocessDeclarationBlocks,
  restoreEscapeSequences
};
