/**
 * @file Manages the shared minification context for tracking registered custom properties and their syntax.
 */

import { isUnicodeCompatibleCharset } from './charset.js';

/**
 * Creates a fresh minification context used to track `@property`-registered custom properties and their declared syntax types across the entire stylesheet.
 *
 * @return {object} A context object with a registeredCustomProperties Set and a registeredCustomPropertySyntax Map.
 */
function createMinifyContext () {
  return {
    registeredCustomProperties: new Set(),
    registeredCustomPropertySyntax: new Map()
  };
}

/**
 * Module-level charset state used during a single synchronous minifyCSS call.
 * Tracks whether the stylesheet declares a non-unicode charset, so that the
 * value minifier can avoid resolving unicode escapes in non-unicode encodings.
 */
let activeCharset = '';

/**
 * Returns true when the active charset leaves the stylesheet in a
 * unicode-compatible encoding (UTF-8, a UTF-16 label that falls back to UTF-8,
 * an unrecognized label, or the default when no `@charset` is declared),
 * meaning CSS unicode escapes can safely be resolved to literal characters.
 *
 * @return {boolean} True if the active charset supports unicode characters.
 */
function isUnicodeCharset () {
  return isUnicodeCompatibleCharset(activeCharset);
}

/**
 * Sets the active charset for the current minification pass.
 *
 * @param {string} charset  The `@charset` value (with quotes) from the stylesheet.
 */
function setActiveCharset (charset) {
  activeCharset = charset || '';
}

/**
 * Clears the active charset after a minification pass completes.
 */
function clearActiveCharset () {
  activeCharset = '';
}

export {
  clearActiveCharset,
  createMinifyContext,
  isUnicodeCharset,
  setActiveCharset
};
