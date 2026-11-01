/**
 * @file Rewrites hex colors and named color keywords in their shortest equivalent spelling.
 */

import { replaceOutsideStringsAndUrls } from '../segments.js';

import {
  parseHex,
  shortestColor
} from './conversion.js';
import { namedColors } from './named.js';

/**
 * Regex matching hex color tokens (#rgb, #rgba, #rrggbb, #rrggbbaa) and CSS named
 * color keywords. Hex patterns are ordered longest-first to avoid partial matches.
 * Named colors are sorted longest-first so longer names like `darkslategray` are
 * matched before shorter substrings. A named color only counts as a color keyword
 * when it is a complete identifier, so hyphens on either side disqualify it (this
 * keeps identifiers such as the custom property name in `var(--grey)` intact).
 *
 * @type {RegExp}
 */
const COLOR_TOKEN_PATTERN = new RegExp(
  '#[0-9a-fA-F]{8}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{6}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{4}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{3}(?![0-9a-fA-F])|' +
  '(?<![\\w-])(?:' +
  Object.keys(namedColors).sort((first, second) => {
    return second.length - first.length;
  }).join('|') +
  ')(?![\\w-])',
  'gi'
);

/**
 * Replaces every hex color and named color keyword in a CSS value segment with
 * the shortest equivalent representation, comparing full hex, shortened hex,
 * and any matching named color keyword.
 *
 * @param  {string}  segment                      A CSS value segment (outside strings and urls).
 * @param  {boolean} rewritesEqualLengthSpelling  Whether a spelling of the same length is worth switching to.
 * @return {string}                               The segment with all colors shortened to their minimal form.
 */
function shortenColorValues (segment, rewritesEqualLengthSpelling = true) {
  // Match "color-mix(" as a whole word, case-insensitive
  const hasColorMix = /\bcolor-mix\(/i.test(segment);
  return segment.replace(COLOR_TOKEN_PATTERN, (match) => {
    let channels;
    if (match.startsWith('#')) {
      channels = parseHex(match);
    } else {
      if (hasColorMix) {
        return match;
      }
      const rgb = namedColors[match.toLowerCase()];
      if (rgb) {
        // transparent has alpha=0, all other named colors have alpha=1
        const alpha = match.toLowerCase() === 'transparent' ? 0 : 1;
        channels = [rgb[0], rgb[1], rgb[2], alpha];
      }
    }
    if (!channels) {
      return match;
    }
    const shortest = shortestColor(channels[0], channels[1], channels[2], channels[3]);
    if (!rewritesEqualLengthSpelling && shortest.length >= match.length) {
      return match;
    }
    return shortest;
  });
}

/**
 * Lowercases every hex color token in a CSS value, since uppercase hex digits
 * compress worse and are equivalent to their lowercase form.
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value with all hex color tokens lowercased.
 */
function lowercaseHexColors (value) {
  return replaceOutsideStringsAndUrls(value, (segment) => {
    // Match hex color tokens of 3 to 8 hex digits
    return segment.replace(/#([0-9a-fA-F]{3,8})\b/gi, (hexColor) => {
      return hexColor.toLowerCase();
    });
  });
}

export {
  lowercaseHexColors,
  shortenColorValues
};
