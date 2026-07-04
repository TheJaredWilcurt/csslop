/**
 * @file Manages the shared minification context for tracking registered custom properties and their syntax.
 */

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
 * Returns true when the active charset is a unicode-compatible encoding
 * (UTF-8, UTF-16, or the default when no `@charset` is declared), meaning
 * CSS unicode escapes can safely be resolved to literal characters.
 *
 * @return {boolean} True if the active charset supports unicode characters.
 */
function isUnicodeCharset () {
  if (!activeCharset) {
    return true;
  }
  const normalized = activeCharset.toLowerCase().replace(/["']/g, '');
  return normalized === 'utf-8' || normalized.startsWith('utf-16');
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
