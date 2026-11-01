/**
 * @file Rewrites `border` and `outline` values into their shortest canonical form, stating the width before the style and dropping the default width.
 */

/**
 * Matches the keywords that state a border line style.
 *
 * @type {string}
 */
const BORDER_STYLE_KEYWORD_SOURCE = 'solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none';

/**
 * Matches the ways a border line width is stated: one of its three keywords, a
 * length, or a math function that resolves to one.
 *
 * @type {string}
 */
const BORDER_WIDTH_SOURCE = 'thin|medium|thick|[+-]?(?:\\d+|\\d*\\.\\d+)(?:e[+-]?\\d+)?[a-z]*|(?:calc|min|max|clamp)\\([^()]*\\)';

/**
 * Matches a `border` value that states its line style in front of its line
 * width, with the two captured so they can be swapped.
 *
 * @type {RegExp}
 */
const BORDER_STYLE_BEFORE_WIDTH_PATTERN = new RegExp(
  '^(' + BORDER_STYLE_KEYWORD_SOURCE + ')\\s+(' + BORDER_WIDTH_SOURCE + ')(?=\\s|$)',
  'i'
);

/**
 * Rewrites a `border` value that leads with its line style into the canonical
 * width-style-color order. The width has to be recognized before the two are
 * swapped: `border` states its components in any order, so the component behind
 * the style may be a color instead, as in `solid #8aadf4 1px`, and that one
 * belongs behind the width rather than in front of it.
 *
 * @param  {string} value  The `border` value.
 * @return {string}        The value with its width stated before its style.
 */
function reorderBorderWidthBeforeStyle (value) {
  return value.replace(BORDER_STYLE_BEFORE_WIDTH_PATTERN, '$2 $1');
}

/**
 * Removes the default `medium` line width from a `border` value, since the
 * shorthand resets an unstated width to it anyway.
 *
 * @param  {string} value  The `border` value.
 * @return {string}        The value without its default line width.
 */
function removeDefaultBorderWidth (value) {
  // Match the medium keyword and the whitespace that separates it from the next component
  return value.replace(/\bmedium\s+/g, '');
}

/**
 * Matches a line style keyword written directly against one of the color
 * keywords that can follow it, capturing both so a space can be put back
 * between them.
 *
 * @type {RegExp}
 */
const STYLE_TOUCHING_COLOR_PATTERN = new RegExp(
  '\\b(' + BORDER_STYLE_KEYWORD_SOURCE + ')(red|green|olive|tan|transparent)\\b',
  'g'
);

/**
 * Restores the space between an `outline` value's line style and a color
 * keyword when the two have been written against each other, since together
 * they would read as one unknown keyword.
 *
 * @param  {string} value  The `outline` value.
 * @return {string}        The value with its style and color keywords separated.
 */
function separateOutlineStyleFromColor (value) {
  return value.replace(STYLE_TOUCHING_COLOR_PATTERN, '$1 $2');
}

export {
  removeDefaultBorderWidth,
  reorderBorderWidthBeforeStyle,
  separateOutlineStyleFromColor
};
