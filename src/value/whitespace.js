/**
 * @file Normalizes the whitespace, quotes, and Unicode escapes of a CSS value, and restores the whitespace its math operators cannot do without.
 */

import { isUnicodeCharset } from '../context.js';
import { resolveUnicodeEscape } from '../utilities.js';

import { replaceOutsideStringsAndUrls } from './segments.js';
import {
  protectUrlTokens,
  removeWhitespaceAfterUrlTokens,
  restoreUrlTokens
} from './urls.js';

/**
 * Restores the whitespace that a math function requires before a `+` or a `-`
 * operator. Both operators have to be surrounded by whitespace to be read as
 * operators rather than as the sign of the term that follows, and the
 * whitespace before one that trails a closing parenthesis is removed together
 * with the rest of the parenthesis padding.
 *
 * @param  {string} value  The CSS value string with parenthesis padding removed.
 * @return {string}        The value with the operator separator restored.
 */
function restoreSpaceBeforeMathOperators (value) {
  return replaceOutsideStringsAndUrls(value, (segment) => {
    // Match a closing parenthesis immediately followed by a `+` or `-` operator
    return segment.replace(/\)(?=[+-])/g, ') ');
  });
}

/**
 * Normalizes whitespace, quotes, and unicode escapes in a CSS value string.
 *
 * @param  {string} value     The raw CSS value string to normalize.
 * @param  {string} property  The CSS property name, used for context-aware quote handling.
 * @return {string}           The value with whitespace collapsed, quotes normalized, and unicode escapes resolved.
 */
function normalizeWhitespaceAndQuotes (value, property) {
  const protectedUrls = protectUrlTokens(value);
  value = protectedUrls.value;

  // Unescape unicode (skip control characters — they must stay escaped in CSS strings).
  // Only resolve escapes when the charset is unicode-compatible (UTF-8/UTF-16 or default).
  if (isUnicodeCharset()) {
    value = value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
      return resolveUnicodeEscape(hex) ?? match;
    });
  }
  // Normalize single-quoted strings to double-quoted
  value = value.replace(/'((?:[^'\\]|\\.)*?)'/g, '"$1"');

  // Remove space between string literals
  value = value.replace(/("(?:[^"\\]|\\.)*")\s+(?=")/g, '$1');

  // Whitespace minification
  value = value.replace(/\s*!\s*important/i, '!important');
  // value = value.replace(/\s*([+*/=])\s*/g, '$1');
  // Strip whitespace around commas
  value = value.replace(/\s*([,])\s*/g, '$1');
  // Match quoted strings (to skip them) or parentheses with surrounding whitespace (to strip whitespace)
  value = value.replace(/("[^"]*"|'[^']*')|\s*([()])\s*/g, (match, quotedString, parenthesis) => {
    if (quotedString) {
      return quotedString;
    }
    return parenthesis;
  });

  // Strip quotes from simple strings (like "Custom", "image.png"), but not for content where quoted strings are semantically distinct
  if (property !== 'content' && property !== 'font' && property !== 'font-feature-settings' && property !== 'font-variation-settings') {
    // Match a boundary (start, whitespace, comma, open-paren), then a quoted simple value (alphanumeric, dots, slashes, hyphens), then a boundary lookahead
    value = value.replace(/(^|\s|,|\()("|')([a-zA-Z0-9_./-]+)\2(?=\s|,|$|\)|!)/g, (match, before, quote, inner) => {
      // Keep quotes around CSS generic font-family keywords — unquoted they mean something different
      if (property === 'font-family' && /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i.test(inner)) {
        return before + '"' + inner + '"';
      }
      return before + inner;
    });
  }

  value = removeWhitespaceAfterUrlTokens(value, protectedUrls.urlTokens);
  return restoreUrlTokens(value, protectedUrls.urlTokens);
}

export {
  normalizeWhitespaceAndQuotes,
  restoreSpaceBeforeMathOperators
};
