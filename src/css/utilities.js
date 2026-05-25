/**
 * @file General CSS utilities shared across the minification pipeline.
 */

/**
 * Resolves a CSS Unicode escape hex string to its literal character.
 * Returns null for control characters (code points below 0x20 or equal to 0x7F),
 * which must remain escaped in CSS.
 *
 * @param  {string}      hex  The hex digit string (1–6 characters) from a CSS escape sequence.
 * @return {string|null}      The resolved character, or null if the code point is a control character.
 */
function resolveUnicodeEscape (hex) {
  const codePoint = parseInt(hex, 16);
  const isControlCharacter = codePoint < 0x20 || codePoint === 0x7f;
  if (isControlCharacter) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

/**
 * Escapes special regex metacharacters in a string so it can be safely used
 * as a literal pattern in a RegExp constructor.
 *
 * @param  {string} input  The string to escape.
 * @return {string}        The escaped string safe for use in a RegExp.
 */
function escapeRegexString (input) {
  // Escape all regex metacharacters: . * + ? ^ $ { } ( ) | [ ] backslash
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  escapeRegexString,
  resolveUnicodeEscape
};
