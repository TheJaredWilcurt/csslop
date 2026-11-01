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
 * Reports whether a property is a custom property. A custom property holds an
 * arbitrary token stream rather than a typed value, so every one of its tokens,
 * whitespace included, is part of what it stores, and neither shorthands nor
 * `all` ever reset it.
 *
 * @param  {string}  property  The CSS property name.
 * @return {boolean}           Whether the property is a custom property.
 */
function isCustomProperty (property) {
  return Boolean(property) && property.startsWith('--');
}

export {
  isCustomProperty,
  resolveUnicodeEscape
};
