/**
 * @file Minifies CSS declaration values by applying color conversion, math simplification, shorthand compression, and other property-specific optimizations.
 */

import { isUnicodeCharset } from '../context.js';
import { resolveUnicodeEscape } from '../utilities.js';

import {
  convertOklabToHex,
  evaluateColorMix,
  evaluateRelativeColor,
  hslToRgbChannels,
  hwbToRgbChannels,
  parseHex,
  rgbaToHex,
  shortestColor
} from './colors.js';
import { minifyGradients } from './gradients.js';
import {
  normalizeMathFunctions,
  simplifyStandaloneCalc
} from './math.js';
import { namedColors } from './named-colors.js';
import { isQuotesNoneEquivalent } from './quotes.js';
import {
  collapseShorthandParts,
  normalizeScaleComponent,
  parseAlphaString,
  roundCompactNumber
} from './shared.js';
import { minifyTransformValue } from './transforms.js';
import { optimizeUnicodeRange } from './unicode-range.js';

/**
 * Map of position-area two-keyword values to their single-keyword equivalents.
 * Per CSS spec, `center center` is redundant with `center`, etc.
 *
 * @type {{[key: string]: string}}
 */
const POSITION_AREA_SHORTHANDS = {
  'center center': 'center',
  'top center': 'top',
  'bottom center': 'bottom',
  'center top': 'top',
  'center bottom': 'bottom',
  'left center': 'left',
  'right center': 'right'
};

/**
 * Regex matching hex color tokens (#rgb, #rgba, #rrggbb, #rrggbbaa) and CSS named
 * color keywords. Hex patterns are ordered longest-first to avoid partial matches.
 * Named colors are sorted longest-first so longer names like `darkslategray` are
 * matched before shorter substrings.
 *
 * @type {RegExp}
 */
const COLOR_TOKEN_PATTERN = new RegExp(
  '#[0-9a-fA-F]{8}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{6}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{4}(?![0-9a-fA-F])|' +
  '#[0-9a-fA-F]{3}(?![0-9a-fA-F])|' +
  '\\b(?:' +
  Object.keys(namedColors).sort((a, b) => {
    return b.length - a.length;
  }).join('|') +
  ')\\b',
  'gi'
);

/**
 * Replaces every hex color and named color keyword in a CSS value segment with
 * the shortest equivalent representation, comparing full hex, shortened hex,
 * and any matching named color keyword.
 *
 * @param  {string} segment  A CSS value segment (outside strings and urls).
 * @return {string}          The segment with all colors shortened to their minimal form.
 */
function shortenColorValues (segment) {
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
    return shortestColor(channels[0], channels[1], channels[2], channels[3]);
  });
}

/**
 * Applies a replacer function only to segments of a CSS value that are outside quoted strings and url() functions, preserving those literal segments unchanged.
 *
 * @param  {string}                   value     The full CSS value string.
 * @param  {function(string): string} replacer  A function called with each non-string, non-url segment, returning the replacement string.
 * @return {string}                             The value with the replacer applied to all eligible segments.
 */
function replaceOutsideStringsAndUrls (value, replacer) {
  let result = '';
  let index = 0;

  const consumeQuoted = (start) => {
    const quote = value[start];
    let end = start + 1;
    while (end < value.length) {
      if (value[end] === '\\') {
        end += 2;
        continue;
      }
      if (value[end] === quote) {
        end++;
        break;
      }
      end++;
    }
    return end;
  };

  const startsUrl = (start) => {
    return value.slice(start, start + 4).toLowerCase() === 'url(';
  };

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = consumeQuoted(index);
      result += value.slice(index, end);
      index = end;
      continue;
    }

    if (startsUrl(index)) {
      let depth = 1;
      let end = index + 4;
      while (end < value.length && depth > 0) {
        if (value[end] === '"' || value[end] === '\'') {
          end = consumeQuoted(end);
          continue;
        }
        if (value[end] === '(') {
          depth++;
        }
        if (value[end] === ')') {
          depth--;
        }
        end++;
      }
      result += value.slice(index, end);
      index = end;
      continue;
    }

    const start = index;
    while (index < value.length && value[index] !== '"' && value[index] !== '\'' && !startsUrl(index)) {
      index++;
    }
    result += replacer(value.slice(start, index));
  }

  return result;
}

/**
 * Normalizes whitespace, quotes, and unicode escapes in a CSS value string.
 *
 * @param  {string} val       The raw CSS value string to normalize.
 * @param  {string} property  The CSS property name, used for context-aware quote handling.
 * @return {string}           The value with whitespace collapsed, quotes normalized, and unicode escapes resolved.
 */
function normalizeWhitespaceAndQuotes (val, property) {
  // Unescape unicode (skip control characters — they must stay escaped in CSS strings).
  // Only resolve escapes when the charset is unicode-compatible (UTF-8/UTF-16 or default).
  if (isUnicodeCharset()) {
    val = val.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
      return resolveUnicodeEscape(hex) ?? match;
    });
  }
  // Normalize single-quoted strings to double-quoted
  val = val.replace(/'((?:[^'\\]|\\.)*?)'/g, '"$1"');

  // Remove space between string literals
  val = val.replace(/("(?:[^"\\]|\\.)*")\s+(?=")/g, '$1');

  // Whitespace minification
  val = val.replace(/\s*!\s*important/i, '!important');
  // val = val.replace(/\s*([+*/=])\s*/g, '$1');
  // Strip whitespace around commas
  val = val.replace(/\s*([,])\s*/g, '$1');
  // Match quoted strings (to skip them) or parentheses with surrounding whitespace (to strip whitespace)
  val = val.replace(/("[^"]*"|'[^']*')|\s*([()])\s*/g, (match, str, paren) => {
    if (str) {
      return str;
    }
    return paren;
  });

  // Strip quotes from simple strings (like "Custom", "image.png"), but not for content where quoted strings are semantically distinct
  if (property !== 'content' && property !== 'font-feature-settings' && property !== 'font-variation-settings') {
    // Match a boundary (start, whitespace, comma, open-paren), then a quoted simple value (alphanumeric, dots, slashes, hyphens), then a boundary lookahead
    val = val.replace(/(^|\s|,|\()("|')([a-zA-Z0-9_./-]+)\2(?=\s|,|$|\)|!)/g, (match, before, quote, inner) => {
      // Keep quotes around CSS generic font-family keywords — unquoted they mean something different
      if (property === 'font-family' && /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i.test(inner)) {
        return before + '"' + inner + '"';
      }
      return before + inner;
    });
  }

  return val;
}

/**
 * Converts CSS color functions (rgb, hsl, hwb, oklab, color-mix, etc.) to their
 * shortest hex equivalents and applies hex shortening.
 *
 * @param  {string} val  The CSS value string with potential color functions.
 * @return {string}      The value with color functions converted to hex where shorter.
 */
function convertColorsToHex (val) {
  // Evaluate color-mix() expressions (before space minification to avoid nested-paren issues)
  if (/\bcolor-mix\(/i.test(val)) {
    const result = evaluateColorMix(val);
    if (result) {
      val = result;
    }
  }

  // Handle color(from ...) relative color syntax (identity case)
  if (/\bcolor\(\s*from\b/i.test(val)) {
    const result = evaluateRelativeColor(val);
    if (result) {
      val = result;
    }
  }

  // Minify whitespace and numeric precision inside wide-gamut and functional color notations
  val = val.replace(/\b(oklab|oklch|lch|lab|color|hwb)\((.*?)\)/gi, (match, func, inner) => {
    // Collapse whitespace to single space
    let minified = inner.replace(/\s+/g, ' ');
    // Remove space after commas
    minified = minified.replace(/, /g, ',');
    // Remove spaces around slash separator (alpha delimiter)
    minified = minified.replace(/ \/ /g, '/');
    // Strip leading zeros from decimal numbers (e.g. 0.5 → .5)
    minified = minified.replace(/\b0+(\.[\d]+)/g, '$1');
    // Strip leading zeros from decimals preceded by a keyword (e.g. srgb 0.5 → srgb .5)
    minified = minified.replace(/([A-Za-z]) 0+(\.[\d]+)/g, '$1 $2');
    // Check if function uses a wide-gamut color space requiring higher numeric precision
    const useWidePrecision = func.toLowerCase() === 'color' && /\b(srgb-linear|xyz-d65|xyz-d50|xyz)\b/i.test(inner);
    // Round numbers with 3+ decimal places, using context-aware precision
    minified = minified.replace(/(^|[\s(,/-])(-?\d*\.\d{3,})/g, (match, before, num) => {
      const isAlpha = before === '/';
      const absoluteValue = Math.abs(parseFloat(num));
      // Check if function is a Lab/LCH color notation with a large channel value (less precision needed)
      const isLargeLabValue = /^(?:lch|lab|oklch|oklab)$/i.test(func) && absoluteValue >= 10;
      let precision;
      if (isAlpha) {
        precision = 3;
      } else if (isLargeLabValue) {
        precision = 1;
      } else if (useWidePrecision) {
        precision = 4;
      } else {
        precision = 3;
      }
      const factor = Math.pow(10, precision);
      const roundedNum = Math.round(parseFloat(num) * factor) / factor;
      // Strip trailing zeros and trailing decimal point from the rounded number
      let rounded = roundedNum.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '');
      if (rounded.startsWith('0.')) {
        rounded = rounded.substring(1);
      }
      if (rounded.startsWith('-0.')) {
        rounded = '-' + rounded.substring(2);
      }
      return before + rounded;
    });
    return func + '(' + minified.trim() + ')';
  });

  // Convert in-gamut oklab() to hex when it produces a shorter representation
  val = val.replace(/\boklab\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, lStr, aStr, bStr, alphaStr) => {
    const alpha = parseAlphaString(alphaStr);
    const hex = convertOklabToHex(parseFloat(lStr), parseFloat(aStr), parseFloat(bStr), alpha);
    if (!hex) {
      return match; // out-of-gamut: keep native oklab form
    }
    if (hex.length < match.length) {
      return hex;
    }
    return match;
  });

  // Handle 'none' keyword in rgb/hsl functions (CSS Color Level 4: treated as 0)
  val = val.replace(/\b(rgba?|hsla?)\([^)]*\)/gi, (match) => {
    return match.replace(/\bnone\b/gi, '0');
  });

  // hwb() → hex (percent signs optional for whiteness/blackness, values always treated as percentages)
  val = val.replace(/\bhwb\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%?\s+((?:\d+|\d*\.\d+))%?(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hStr, wStr, bStr, aStr) => {
    const [r, g, b] = hwbToRgbChannels(parseFloat(hStr), parseFloat(wStr) / 100, parseFloat(bStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgb()/rgba() space syntax → hex, case-insensitive (handles decimals and any alpha)
  val = val.replace(/\brgba?\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, rStr, gStr, bStr, aStr) => {
    const r = Math.round(parseFloat(rStr));
    const g = Math.round(parseFloat(gStr));
    const b = Math.round(parseFloat(bStr));
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl()/hsla() space syntax → hex, case-insensitive (percent signs optional, values always treated as percentages)
  val = val.replace(/\bhsla?\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%?\s+((?:\d+|\d*\.\d+))%?(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgba() comma syntax → hex, case-insensitive (handles any alpha)
  val = val.replace(/\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/gi, (match, rStr, gStr, bStr, aStr) => {
    const r = parseInt(rStr, 10);
    const g = parseInt(gStr, 10);
    const b = parseInt(bStr, 10);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsla() comma syntax → hex, case-insensitive (percent signs optional, values always treated as percentages)
  val = val.replace(/\bhsla\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/gi, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl()/hsla() comma syntax without alpha → hex, case-insensitive (percent signs optional, values always treated as percentages)
  val = val.replace(/\bhsla?\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*((?:\d+|\d*\.\d+))%?\s*\)/gi, (match, hStr, sStr, lStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, 1);
  });

  // rgb() comma syntax → hex, case-insensitive
  val = val.replace(/\brgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi, (match, r, g, b) => {
    return rgbaToHex(parseInt(r, 10), parseInt(g, 10), parseInt(b, 10), 1);
  });
  return val;
}

/**
 * Map from background-position keyword names to their equivalent percent values.
 *
 * @type {{[key: string]: string}}
 */
const POSITION_KEYWORD_TO_PERCENT = {
  left: '0',
  center: '50%',
  right: '100%',
  top: '0',
  bottom: '100%'
};

/**
 * Converts background-position keyword values to their shorter percent
 * equivalents when possible. Single Y-axis keywords (top, bottom) and
 * multi-value offset syntax (3 or 4 values) are left unchanged.
 *
 * @param  {string} value  The background-position value string.
 * @return {string}        The value with keywords converted to percents where shorter.
 */
function convertBackgroundPositionKeywords (value) {
  // Split on whitespace to determine the number of position parts
  const parts = value.split(/\s+/);

  // 3 or 4 value syntax uses keyword offsets, retain keywords
  if (parts.length >= 3) {
    return value;
  }

  if (parts.length === 1) {
    const keyword = parts[0].toLowerCase();
    // Y-axis-only keywords (top, bottom) can't be expressed as a single X-axis percent
    const isYAxisOnly = keyword === 'top' || keyword === 'bottom';
    if (isYAxisOnly) {
      return value;
    }
    if (POSITION_KEYWORD_TO_PERCENT[keyword] !== undefined) {
      return POSITION_KEYWORD_TO_PERCENT[keyword];
    }
    return value;
  }

  if (parts.length === 2) {
    const firstKeyword = parts[0].toLowerCase();
    const secondKeyword = parts[1].toLowerCase();
    const firstIsPositionKeyword = POSITION_KEYWORD_TO_PERCENT[firstKeyword] !== undefined;
    const secondIsPositionKeyword = POSITION_KEYWORD_TO_PERCENT[secondKeyword] !== undefined;

    if (firstIsPositionKeyword && secondIsPositionKeyword) {
      const firstPercent = POSITION_KEYWORD_TO_PERCENT[firstKeyword];
      const secondPercent = POSITION_KEYWORD_TO_PERCENT[secondKeyword];
      // Collapse to single value when Y is center (50%), since a single value defaults Y to 50%
      if (secondPercent === '50%') {
        return firstPercent;
      }
      return firstPercent + ' ' + secondPercent;
    }
  }

  return value;
}

/**
 * Converts millisecond time values to seconds when the result is a
 * shorter string. Values of 0ms become 0s (time must keep a unit),
 * and values at or below 99ms stay in milliseconds (shorter representation).
 *
 * @param  {string} value  The CSS value string potentially containing ms time values.
 * @return {string}        The value with eligible ms times converted to seconds.
 */
function convertMillisecondsToSeconds (value) {
  // Match numeric values followed by the "ms" unit at word boundaries
  return value.replace(/\b(\d+(?:\.\d+)?)ms\b/gi, (match, amount) => {
    const milliseconds = parseFloat(amount);
    if (milliseconds === 0) {
      return '0s';
    }
    // Keep ms for values at or below 99ms (ms representation is shorter)
    if (milliseconds <= 99) {
      return match;
    }
    return roundCompactNumber(milliseconds / 1000) + 's';
  });
}

/**
 * Applies property-specific optimizations to a CSS value (transition, flex, font,
 * background, display, scale, border-radius, shorthand collapsing, etc.).
 *
 * @param  {string} val       The CSS value string after generic minification.
 * @param  {string} property  The CSS property name.
 * @return {string}           The value with property-specific optimizations applied.
 */
function applyPropertyOptimizations (val, property) {
  if (property === 'font-weight' && isUnicodeCharset()) {
    // Replace font-weight keyword "bold" with its numeric equivalent
    val = val.replace(/\bbold\b/gi, '700');
    // Replace font-weight keyword "normal" with its numeric equivalent
    val = val.replace(/\bnormal\b/gi, '400');
  }

  // Convert ms to s for time-related properties when the seconds form is shorter
  const isTimeProperty = (
    property === 'transition' ||
    property === 'transition-duration' ||
    property === 'transition-delay' ||
    property === 'animation' ||
    property === 'animation-duration' ||
    property === 'animation-delay'
  );
  if (isTimeProperty) {
    val = convertMillisecondsToSeconds(val);
  }

  // Transition: remove " 0s" duration (transition: all 0s -> transition: all)
  if (property === 'transition') {
    // Remove zero-second duration from transition shorthand
    val = val.replace(/\s+0s/g, ' ');
    // Remove leading zero-pixel value from transition shorthand
    val = val.replace(/^0px\s*/, '');
    // Replace cubic-bezier functions with their equivalent named timing-function keywords
    val = val.replace(/cubic-bezier\(0,0,1,1\)/g, 'linear');
    val = val.replace(/cubic-bezier\(\.25,\.1,\.25,1\)/g, 'ease');
    val = val.replace(/cubic-bezier\(\.42,0,1,1\)/g, 'ease-in');
    val = val.replace(/cubic-bezier\(0,0,\.58,1\)/g, 'ease-out');
    val = val.trim();
  }

  if (property === 'animation') {
    // Replace steps() functions with their equivalent named timing-function keywords
    val = val.replace(/steps\(1,start\)/g, 'step-start');
    val = val.replace(/steps\(1,end\)/g, 'step-end');
    // Restore space between step-start/step-end keyword and following token
    // (the parenthesis whitespace stripping removes the space before replacement)
    val = val.replace(/(step-start|step-end)(?=[a-zA-Z0-9#-])/g, '$1 ');
  }

  // Flex: remove " 0px" from flex shorthand (flex: 0 0 0px -> flex: 0 0)
  if (property === 'flex') {
    // Remove trailing zero-pixel basis value
    val = val.replace(/\s+0px/g, ' ');
    // Remove leading zero-pixel value
    val = val.replace(/^0px\s*/, '');
    // Remove trailing zero
    val = val.replace(/\s+0$/, '');
    // Remove standalone zero-pixel value
    val = val.replace(/^0px$/, '');
    val = val.trim();
  }

  // Initial values
  if (val === 'initial') {
    if (['opacity', 'z-index', 'flex-grow', 'flex-shrink', 'order', 'line-height', 'zoom'].includes(property)) {
      // Just leaving them or mapping some: opacity: initial -> opacity: 1
      if (property === 'opacity') {
        val = '1';
      }
      if (property === 'z-index') {
        val = 'auto';
      }
    }
    if (['margin', 'padding'].includes(property)) {
      val = '0';
    }
    if (['min-width', 'min-height'].includes(property)) {
      val = 'auto';
    }
    // background-color: initial should become #0000 (transparent)
    if (property === 'background-color') {
      val = '#0000';
    }
  }

  if (property === 'background' && val === 'none') {
    val = '0 0';
  }

  if (property === 'display') {
    if (val === 'block flow') {
      val = 'block';
    }
    if (val === 'inline flow-root') {
      val = 'inline-block';
    }
  }

  if (property === 'background-repeat') {
    if (val === 'no-repeat no-repeat') {
      val = 'no-repeat';
    }
    if (val === 'repeat no-repeat') {
      val = 'repeat-x';
    }
    if (val === 'no-repeat repeat') {
      val = 'repeat-y';
    }
  }

  if (property === 'background-position') {
    val = convertBackgroundPositionKeywords(val);
  }

  // Check if border value starts with a style keyword, and reorder to canonical width-style-color order
  if (property === 'border' && /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\s+/i.test(val)) {
    // Reorder border shorthand from style-width-color to width-style-color
    val = val.replace(/^((?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none))\s+([^\s]+)\s+(.+)$/i, '$2 $1 $3');
  }

  if (property === 'flex-flow') {
    // Reorder flex-flow from wrap-direction to direction-wrap (canonical order)
    val = val.replace(/^(nowrap|wrap|wrap-reverse)\s+(row|row-reverse|column|column-reverse)$/i, '$2 $1');
  }

  if (property === 'font-family') {
    // Strip quotes from simple multi-word font family names that don't require quoting
    val = val.replace(/"([A-Za-z0-9-]+(?: [A-Za-z0-9-]+)+)"/g, '$1');
    const seenFamilies = new Set();
    val = val.split(',').map((part) => {
      return part.trim();
    }).filter(Boolean).filter((part) => {
      const lowercaseName = part.toLowerCase();
      if (seenFamilies.has(lowercaseName)) {
        return false;
      }
      seenFamilies.add(lowercaseName);
      return true;
    }).join(',');
  }

  if (property === 'grid-template-areas') {
    // Normalize each quoted grid-template-areas row string
    val = val.replace(/"([^"]*)"/g, (match, inner) => {
      // Collapse whitespace to single space within grid row
      let normalized = inner.replace(/\s+/g, ' ').trim();
      // Collapse consecutive dots (null cell tokens) to a single dot
      normalized = normalized.replace(/(^| )\.{2,}(?= |$)/g, '$1.');
      return '"' + normalized + '"';
    });
  }

  if (property === 'font-size') {
    // Convert point (pt) font-size values to their pixel (px) equivalent
    val = val.replace(/^(-?(?:\d+|\d*\.\d+))pt$/i, (match, amount) => {
      return roundCompactNumber(parseFloat(amount) * (96 / 72)) + 'px';
    });
  }

  // Simplify clamp() where all three arguments are identical (e.g. clamp(1rem,1rem,1rem) → 1rem)
  val = val.replace(/\bclamp\(([^,]+),\1,\1\)/gi, '$1');

  // Convert display-p3 neutral grays to sRGB (equal channels are identical across gamuts)
  val = val.replace(/\bcolor\(display-p3\s+([\d.]+)\s+\1\s+\1(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, channelStr, alphaStr) => {
    const channelValue = parseFloat(channelStr);
    const r = Math.round(channelValue * 255);
    return rgbaToHex(r, r, r, parseAlphaString(alphaStr));
  });

  // Shorten all color tokens (second pass after property-specific color evaluations)
  val = replaceOutsideStringsAndUrls(val, shortenColorValues);

  // Remove space before hex colors (second pass after color evaluations)
  val = replaceOutsideStringsAndUrls(val, (segment) => {
    // Preserve space after border style keywords (solid, dashed, etc.) before hex colors
    segment = segment.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\s+#([0-9a-fA-F]{3,8})\b/gi, '$1 #$2');
    // Then remove other spaces before hex colors
    return segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
  });
  if (property !== 'transform' && property !== 'background' && property !== 'src') {
    // Restore space after close-paren when followed by an alphanumeric, hash, or hyphen
    val = val.replace(/\)(?=[0-9a-zA-Z#-])/g, ') ');
  }

  if (property === 'font') {
    // Split font shorthand on whitespace
    const parts = val.split(/\s+/);
    // Find the font-size part: contains a digit and a recognized CSS length/percentage unit
    const sizeIndex = parts.findIndex((part) => {
      return /\d/.test(part) && /(?:px|em|rem|%|pt|pc|vw|vh|vmin|vmax|ch|ex|cm|mm|in|lh|rlh)/i.test(part);
    });
    if (sizeIndex > 0) {
      val = [...parts.slice(0, sizeIndex).filter((part) => {
        return part !== 'normal' && part !== '400';
      }), ...parts.slice(sizeIndex)].join(' ');
    }
  }

  if (property === 'background' && val !== 'none') {
    const normalized = val
      // Remove default "0 0" background-position values
      .replace(/(?:^|\s)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ' ')
      // Remove "0 0" background-position after a close-paren (e.g. after url())
      .replace(/\)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ') ')
      // Remove default "repeat" background-repeat keyword (excluding compound values like no-repeat)
      .replace(/(?<!-)\brepeat\b(?!-)/g, ' ')
      // Remove default "scroll" background-attachment keyword
      .replace(/\bscroll\b/g, ' ')
      // Remove default "none" background-image keyword
      .replace(/\bnone\b/g, ' ')
      // Collapse whitespace to single space
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized) {
      val = normalized;
    }
    // Restore the required separator between an image function and a following
    // background-position when that position is not immediately followed by `/size`.
    val = val.replace(/\)((?:left|center|right|top|bottom|[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?)(?:\s+(?:left|center|right|top|bottom|[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?))?)(?!\/)/gi, ') $1');
    val = val.replace(/\)\s+((?:left|center|right|top|bottom|[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?)(?:\s+(?:left|center|right|top|bottom|[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?))?)(?=\/)/gi, ')$1');
  }

  if (property === 'border') {
    // Remove default "medium" border-width keyword
    val = val.replace(/\bmedium\s+/g, '');
    // Restore missing space between border-style and a 4-digit hex color (with alpha) when they are adjacent
    // This is needed because solid#0000 could be parsed as solid followed by #000 followed by position 0
    val = val.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)#([0-9a-fA-F]{4})\b/gi, '$1 #$2');
  }

  if (property === 'outline') {
    // Restore missing space between outline-style and a color keyword when they are adjacent
    val = val.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)(red|green|olive|tan|transparent)\b/g, '$1 $2');
  }

  if (property === 'transform') {
    val = minifyTransformValue(val);
    // Remove whitespace between consecutive transform functions
    val = val.replace(/\)\s+(?=[a-z-]+\()/gi, ')');
  }

  if (property === 'scale') {
    // Split scale value on whitespace into individual axis components
    const parts = val.split(/\s+/).filter(Boolean).map(normalizeScaleComponent);
    if (parts.length === 2 && parts[0] === parts[1]) {
      val = parts[0];
    } else if (parts.length === 3 && parts[2] === '1') {
      if (parts[0] === parts[1]) {
        val = parts[0];
      } else {
        val = parts[0] + ' ' + parts[1];
      }
    } else {
      val = parts.join(' ');
    }
  }

  // Replace multiple spaces
  val = val.replace(/\s+/g, ' ');

  // Shorthands: margin, padding, border-width, border-style, border-color, inset
  // Check if property supports box-model shorthand collapsing (4 → 3 → 2 → 1 values)
  if (/^(margin|padding|inset|border-width|border-style|border-color|gap|overflow)$/.test(property)) {
    val = collapseShorthandParts(val.split(' ')).join(' ');
  }

  if (property === 'border-radius') {
    const segments = val.split('/').map((segment) => {
      return segment.trim();
    }).filter(Boolean).map((segment) => {
      // Split each segment on whitespace and collapse redundant parts
      return collapseShorthandParts(segment.split(/\s+/)).join(' ');
    });
    val = segments.join('/');
  }

  return val;
}

/**
 * Minifies a CSS declaration's value by applying color conversion, math simplification, shorthand compression, gradient optimization, and other property-specific optimizations.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value string.
 */
function minifyValue (declaration) {
  if (declaration.property === 'position-area') {
    const shorthand = POSITION_AREA_SHORTHANDS[declaration.value];
    if (shorthand) {
      return shorthand;
    }
  }
  if (declaration.property === 'quotes' && isQuotesNoneEquivalent(declaration.value)) {
    return 'none';
  }
  let val = declaration.value;

  if (typeof val === 'string') {
    val = val.trim();
    val = normalizeWhitespaceAndQuotes(val, declaration.property);

    // Instead of unconditionally removing spaces around + and - and *, handle math vs non-math
    // Collapse spaces around division operator
    val = val.replace(/ \/ /g, '/');
    // Remove whitespace around * and / operators (safe outside calc context)
    val = val.replace(/\s*([*/])\s*/g, '$1');
    val = normalizeMathFunctions(val, declaration.property, declaration.value || '');
    val = simplifyStandaloneCalc(val);
    // Simplify calc() expressions containing zero-percent additive terms
    val = val.replace(/calc\(([^()]+)\)/gi, (match, inner) => {
      // Collapse whitespace inside calc expression
      const compactInner = inner.replace(/\s+/g, ' ').trim();
      // Extract all percentage terms from the expression
      const percentTerms = compactInner.match(/[+-]?\s*(?:\d*\.\d+|\d+)%/g) || [];
      const hasNonZeroPercent = percentTerms.some((term) => {
        return Math.abs(parseFloat(term)) > 0;
      });
      if (!hasNonZeroPercent) {
        return match;
      }
      // Remove trailing "+ 0%" and leading "0% +" additive identity terms
      return 'calc(' + compactInner.replace(/\s*\+\s*0%(?=\s*$)/g, '').replace(/^0%\s*\+\s*/g, '').trim() + ')';
    });

    // Zeros and Decimals
    if (declaration.property !== 'initial-value') {
      // Strip units from zero values (0px → 0, 0em → 0, etc.) at a value boundary
      val = val.replace(/(^|\s|,|\()0(?:px|em|rem|vw|vh|cm|mm|in|pt|pc|ex|ch|vmin|vmax)(?=\s|,|$|\)|!)/g, '$10');
    }
    val = val.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3'); // e.g. 0.5 -> .5, -0.5 -> -.5

    // If value is a standalone number with optional unit, round it compactly
    if (/^[+-]?(?:\d+|\d*\.\d+)([a-z%]+)?$/i.test(val)) {
      const [, rawNumber, rawUnit = ''] = val.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z%]+)?$/i);
      val = roundCompactNumber(rawNumber, 4) + rawUnit;
    }

    // Remove space before hex colors
    val = replaceOutsideStringsAndUrls(val, (segment) => {
      // Preserve space after border style keywords by using a temporary placeholder
      segment = segment.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\s+#([0-9a-fA-F]{3,8})\b/gi, '$1__BORDER_SPACE__#$2');
      // Remove other spaces before hex colors
      segment = segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
      // Restore the preserved space
      segment = segment.replace(/__BORDER_SPACE__#/g, ' #');
      // Lowercase hex color tokens for consistency and shorter output
      segment = segment.replace(/#([0-9a-fA-F]{3,8})\b/gi, (m) => {
        return m.toLowerCase();
      });
      return segment;
    });

    // Convert color functions to hex equivalents
    val = convertColorsToHex(val);

    // Shorten all color tokens (hex and named) to their shortest representation
    val = replaceOutsideStringsAndUrls(val, shortenColorValues);

    // Property-specific optimizations
    val = applyPropertyOptimizations(val, declaration.property);
  }

  // Gradient optimizations
  // Check if value contains a gradient function
  if (/gradient\(/.test(val)) {
    val = minifyGradients(val);
  }

  // Unicode range optimization: dedup, merge overlapping/adjacent, wildcard compression
  if (declaration.property === 'unicode-range') {
    val = optimizeUnicodeRange(val);
  }

  return val;
}

export { minifyValue };
