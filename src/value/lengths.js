/**
 * @file Converts absolute CSS lengths to the pixels they measure whenever the conversion is exact and no longer.
 */

import {
  convertAbsoluteLengthToPx,
  roundCompactNumber
} from './shared.js';

/**
 * Matches an absolute CSS length token: an optionally signed number followed by
 * an absolute length unit. The lookbehind rejects digits that belong to a larger
 * identifier, such as the custom property name in `var(--size-2in)`, where the
 * digits and unit do not form a value of their own.
 *
 * @type {RegExp}
 */
const ABSOLUTE_LENGTH_PATTERN = /(?<![\w#.%-])(-?(?:\d+|\d*\.\d+))(pt|pc|in|cm|mm|q)\b/gi;

/**
 * The largest difference in pixels that a rounded conversion may introduce and
 * still count as exact, which allows for binary floating point error without
 * allowing a visible change to the rendered length.
 *
 * @type {number}
 */
const PIXEL_ROUNDING_TOLERANCE = 1e-6;

/**
 * Converts absolute length values (pt, pc, in, cm, mm, Q) to their pixel
 * equivalent when the conversion is exact and the pixel form is no longer than
 * the original. Normalizing to px also improves compression by reducing the
 * number of distinct unit strings in the output.
 *
 * @param  {string} value  A CSS value segment, outside strings and urls.
 * @return {string}        The segment with eligible absolute lengths converted to px.
 */
function convertAbsoluteLengthsToPx (value) {
  return value.replace(ABSOLUTE_LENGTH_PATTERN, (token, amount, unit) => {
    const pixels = convertAbsoluteLengthToPx(amount, unit);
    if (pixels === null) {
      return token;
    }
    const converted = roundCompactNumber(pixels) + 'px';
    const isExact = Math.abs(parseFloat(converted) - pixels) < PIXEL_ROUNDING_TOLERANCE;
    if (!isExact || converted.length > token.length) {
      return token;
    }
    return converted;
  });
}

export {
  convertAbsoluteLengthsToPx
};
