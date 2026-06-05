/**
 * @file Minifies CSS declaration values by applying color conversion, math simplification, shorthand compression, and other property-specific optimizations.
 */

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
import {
  collapseShorthandParts,
  normalizeScaleComponent,
  parseAlphaString,
  roundCompactNumber
} from './shared.js';
import { minifyTransformValue } from './transforms.js';

const MAX_MINIFIED_VALUE_CACHE_SIZE = 5000;
const UNDEFINED_CACHE_VALUE = Symbol('undefined-cache-value');
const declarationValueCache = new WeakMap();
const minifiedValueCache = new Map();

/**
 * Builds a cache key from a declaration's property and value, joined by a null character.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              A string key uniquely identifying the declaration's property–value pair.
 */
function getDeclarationCacheKey (declaration) {
  return String(declaration.property || '') + '\u0000' + String(declaration.value || '');
}

/**
 * Stores a minified value in the per-declaration WeakMap cache, keyed by the declaration object itself.
 *
 * @param {object}           declaration  The CSS declaration object to cache against.
 * @param {string}           key          The cache key derived from the declaration's property and value.
 * @param {string|undefined} value        The minified value to cache, or undefined to cache an absent value.
 */
function setDeclarationCacheValue (declaration, key, value) {
  declarationValueCache.set(declaration, {
    key,
    value: value === undefined ? UNDEFINED_CACHE_VALUE : value
  });
}

/**
 * Stores a value in a bounded Map cache, clearing the entire cache when it exceeds the size limit.
 *
 * @param  {Map}              cache  The Map cache to store the entry in.
 * @param  {string}           key    The cache key.
 * @param  {string|undefined} value  The value to cache, or undefined to cache an absent value.
 * @return {string|undefined}        The stored value.
 */
function setBoundedCacheValue (cache, key, value) {
  if (cache.size >= MAX_MINIFIED_VALUE_CACHE_SIZE) {
    cache.clear();
  }
  cache.set(key, value === undefined ? UNDEFINED_CACHE_VALUE : value);
  return value;
}

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
        channels = [rgb[0], rgb[1], rgb[2], 1];
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
 * @param  {string} value     The raw CSS value string to normalize.
 * @param  {string} property  The CSS property name, used for context-aware quote handling.
 * @return {string}           The value with whitespace collapsed, quotes normalized, and unicode escapes resolved.
 */
function normalizeWhitespaceAndQuotes (value, property) {
  // Unescape unicode (skip control characters — they must stay escaped in CSS strings)
  value = value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
    return resolveUnicodeEscape(hex) ?? match;
  });
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
  value = value.replace(/("[^"]*"|'[^']*')|\s*([()])\s*/g, (match, quotedString, paren) => {
    if (quotedString) {
      return quotedString;
    }
    return paren;
  });

  // Strip quotes from simple strings (like "Custom", "image.png"), but not for content where quoted strings are semantically distinct
  if (property !== 'content' && property !== 'font-feature-settings' && property !== 'font-variation-settings') {
    // Match a boundary (start, whitespace, comma, open-paren), then a quoted simple value (alphanumeric, dots, slashes, hyphens), then a boundary lookahead
    value = value.replace(/(^|\s|,|\()("|')([a-zA-Z0-9_./-]+)\2(?=\s|,|$|\)|!)/g, (match, before, quote, inner) => {
      // Keep quotes around CSS generic font-family keywords — unquoted they mean something different
      if (property === 'font-family' && /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/i.test(inner)) {
        return before + '"' + inner + '"';
      }
      return before + inner;
    });
  }

  return value;
}

/**
 * Converts CSS color functions (rgb, hsl, hwb, oklab, color-mix, etc.) to their
 * shortest hex equivalents and applies hex shortening.
 *
 * @param  {string} value  The CSS value string with potential color functions.
 * @return {string}        The value with color functions converted to hex where shorter.
 */
function convertColorsToHex (value) {
  // Evaluate color-mix() expressions (before space minification to avoid nested-paren issues)
  if (/\bcolor-mix\(/i.test(value)) {
    const result = evaluateColorMix(value);
    if (result) {
      value = result;
    }
  }

  // Handle color(from ...) relative color syntax (identity case)
  if (/\bcolor\(\s*from\b/i.test(value)) {
    const result = evaluateRelativeColor(value);
    if (result) {
      value = result;
    }
  }

  // Minify whitespace and numeric precision inside wide-gamut and functional color notations
  value = value.replace(/\b(oklab|oklch|lch|lab|color|hwb)\((.*?)\)/gi, (match, functionName, inner) => {
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
    const useWidePrecision = functionName.toLowerCase() === 'color' && /\b(srgb-linear|xyz-d65|xyz-d50|xyz)\b/i.test(inner);
    // Round numbers with 3+ decimal places, using context-aware precision
    minified = minified.replace(/(^|[\s(,/-])(-?\d*\.\d{3,})/g, (match, before, number) => {
      const isAlpha = before === '/';
      const absoluteValue = Math.abs(parseFloat(number));
      // Check if function is a Lab/LCH color notation with a large channel value (less precision needed)
      const isLargeLabValue = /^(?:lch|lab|oklch|oklab)$/i.test(functionName) && absoluteValue >= 10;
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
      const roundedNumber = Math.round(parseFloat(number) * factor) / factor;
      // Strip trailing zeros and trailing decimal point from the rounded number
      let rounded = roundedNumber.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '');
      if (rounded.startsWith('0.')) {
        rounded = rounded.substring(1);
      }
      if (rounded.startsWith('-0.')) {
        rounded = '-' + rounded.substring(2);
      }
      return before + rounded;
    });
    return functionName + '(' + minified.trim() + ')';
  });

  // Convert in-gamut oklab() to hex when it produces a shorter representation
  value = value.replace(/\boklab\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, lStr, aStr, bStr, alphaStr) => {
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
  value = value.replace(/\b(rgba?|hsla?)\([^)]*\)/gi, (match) => {
    return match.replace(/\bnone\b/gi, '0');
  });

  // hwb() → hex
  value = value.replace(/\bhwb\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%\s+((?:\d+|\d*\.\d+))%(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hStr, wStr, bStr, aStr) => {
    const [r, g, b] = hwbToRgbChannels(parseFloat(hStr), parseFloat(wStr) / 100, parseFloat(bStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgb() space syntax → hex (handles decimals and any alpha)
  value = value.replace(/\brgb\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/g, (match, rStr, gStr, bStr, aStr) => {
    const r = Math.round(parseFloat(rStr));
    const g = Math.round(parseFloat(gStr));
    const b = Math.round(parseFloat(bStr));
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl() space syntax → hex (handles any alpha)
  value = value.replace(/\bhsl\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%\s+((?:\d+|\d*\.\d+))%(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/g, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgba() comma syntax → hex (handles any alpha)
  value = value.replace(/\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/g, (match, rStr, gStr, bStr, aStr) => {
    const r = parseInt(rStr, 10);
    const g = parseInt(gStr, 10);
    const b = parseInt(bStr, 10);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsla() comma syntax → hex (handles any alpha)
  value = value.replace(/\bhsla\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/g, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl() comma syntax → hex
  value = value.replace(/\bhsl\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*((?:\d+|\d*\.\d+))%\s*\)/g, (match, hStr, sStr, lStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, 1);
  });

  // rgb() comma syntax → hex
  value = value.replace(/\brgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (match, r, g, b) => {
    return rgbaToHex(parseInt(r, 10), parseInt(g, 10), parseInt(b, 10), 1);
  });
  return value;
}

/**
 * Applies property-specific optimizations to a CSS value (transition, flex, font,
 * background, display, scale, border-radius, shorthand collapsing, etc.).
 *
 * @param  {string} value     The CSS value string after generic minification.
 * @param  {string} property  The CSS property name.
 * @return {string}           The value with property-specific optimizations applied.
 */
function applyPropertyOptimizations (value, property) {
  if (property === 'font-weight') {
    // Replace font-weight keyword "bold" with its numeric equivalent
    value = value.replace(/\bbold\b/gi, '700');
    // Replace font-weight keyword "normal" with its numeric equivalent
    value = value.replace(/\bnormal\b/gi, '400');
  }

  if (property === 'transition-duration') {
    // Convert millisecond duration to seconds when the result is shorter (e.g. 200ms → .2s)
    value = value.replace(/^(-?(?:\d+|\d*\.\d+))ms$/i, (match, amount) => {
      return roundCompactNumber(parseFloat(amount) / 1000) + 's';
    });
  }

  // Transition: remove " 0s" duration (transition: all 0s -> transition: all)
  if (property === 'transition') {
    // Remove zero-second duration from transition shorthand
    value = value.replace(/\s+0s/g, ' ');
    // Remove leading zero-pixel value from transition shorthand
    value = value.replace(/^0px\s*/, '');
    // Replace cubic-bezier functions with their equivalent named timing-function keywords
    value = value.replace(/cubic-bezier\(0,0,1,1\)/g, 'linear');
    value = value.replace(/cubic-bezier\(\.25,\.1,\.25,1\)/g, 'ease');
    value = value.replace(/cubic-bezier\(\.42,0,1,1\)/g, 'ease-in');
    value = value.replace(/cubic-bezier\(0,0,\.58,1\)/g, 'ease-out');
    value = value.trim();
  }

  if (property === 'animation') {
    // Replace steps() functions with their equivalent named timing-function keywords
    value = value.replace(/steps\(1,start\)/g, 'step-start');
    value = value.replace(/steps\(1,end\)/g, 'step-end');
  }

  // Flex: remove " 0px" from flex shorthand (flex: 0 0 0px -> flex: 0 0)
  if (property === 'flex') {
    // Remove trailing zero-pixel basis value
    value = value.replace(/\s+0px/g, ' ');
    // Remove leading zero-pixel value
    value = value.replace(/^0px\s*/, '');
    // Remove trailing zero
    value = value.replace(/\s+0$/, '');
    // Remove standalone zero-pixel value
    value = value.replace(/^0px$/, '');
    value = value.trim();
  }

  // Initial values
  if (value === 'initial') {
    if (['opacity', 'z-index', 'flex-grow', 'flex-shrink', 'order', 'line-height', 'zoom'].includes(property)) {
      // Just leaving them or mapping some: opacity: initial -> opacity: 1
      if (property === 'opacity') {
        value = '1';
      }
      if (property === 'z-index') {
        value = 'auto';
      }
    }
    if (['margin', 'padding'].includes(property)) {
      value = '0';
    }
    if (['min-width', 'min-height'].includes(property)) {
      value = 'auto';
    }
  }

  if (property === 'background' && value === 'none') {
    value = '0 0';
  }

  if (property === 'display') {
    if (value === 'block flow') {
      value = 'block';
    }
    if (value === 'inline flow-root') {
      value = 'inline-block';
    }
  }

  if (property === 'background-repeat') {
    if (value === 'no-repeat no-repeat') {
      value = 'no-repeat';
    }
    if (value === 'repeat no-repeat') {
      value = 'repeat-x';
    }
    if (value === 'no-repeat repeat') {
      value = 'repeat-y';
    }
  }

  if (property === 'background-position') {
    if (value === 'center center') {
      value = '50%';
    }
    if (value === 'left top') {
      value = '0 0';
    }
  }

  // Check if border value starts with a style keyword, and reorder to canonical width-style-color order
  if (property === 'border' && /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\s+/i.test(value)) {
    // Reorder border shorthand from style-width-color to width-style-color
    value = value.replace(/^((?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none))\s+([^\s]+)\s+(.+)$/i, '$2 $1 $3');
  }

  if (property === 'flex-flow') {
    // Reorder flex-flow from wrap-direction to direction-wrap (canonical order)
    value = value.replace(/^(nowrap|wrap|wrap-reverse)\s+(row|row-reverse|column|column-reverse)$/i, '$2 $1');
  }

  if (property === 'font-family') {
    // Strip quotes from simple multi-word font family names that don't require quoting
    value = value.replace(/"([A-Za-z0-9-]+(?: [A-Za-z0-9-]+)+)"/g, '$1');
    const seenFamilies = new Set();
    value = value.split(',').map((part) => {
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
    value = value.replace(/"([^"]*)"/g, (match, inner) => {
      // Collapse whitespace to single space within grid row
      let normalized = inner.replace(/\s+/g, ' ').trim();
      // Collapse consecutive dots (null cell tokens) to a single dot
      normalized = normalized.replace(/(^| )\.{2,}(?= |$)/g, '$1.');
      return '"' + normalized + '"';
    });
  }

  if (property === 'font-size') {
    // Convert point (pt) font-size values to their pixel (px) equivalent
    value = value.replace(/^(-?(?:\d+|\d*\.\d+))pt$/i, (match, amount) => {
      return roundCompactNumber(parseFloat(amount) * (96 / 72)) + 'px';
    });
  }

  // Simplify clamp() where all three arguments are identical (e.g. clamp(1rem,1rem,1rem) → 1rem)
  value = value.replace(/\bclamp\(([^,]+),\1,\1\)/gi, '$1');

  // Convert display-p3 neutral grays to sRGB (equal channels are identical across gamuts)
  value = value.replace(/\bcolor\(display-p3\s+([\d.]+)\s+\1\s+\1(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, channelStr, alphaStr) => {
    const channelValue = parseFloat(channelStr);
    const r = Math.round(channelValue * 255);
    return rgbaToHex(r, r, r, parseAlphaString(alphaStr));
  });

  // Shorten all color tokens (second pass after property-specific color evaluations)
  value = replaceOutsideStringsAndUrls(value, shortenColorValues);

  // Remove space before hex colors (second pass after color evaluations)
  value = replaceOutsideStringsAndUrls(value, (segment) => {
    return segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
  });
  if (property !== 'transform' && property !== 'background' && property !== 'src') {
    // Restore space after close-paren when followed by an alphanumeric, hash, or hyphen
    value = value.replace(/\)(?=[0-9a-zA-Z#-])/g, ') ');
  }

  if (property === 'font') {
    // Split font shorthand on whitespace
    const parts = value.split(/\s+/);
    // Find the font-size part: contains a digit and a recognized CSS length/percentage unit
    const sizeIndex = parts.findIndex((part) => {
      return /\d/.test(part) && /(?:px|em|rem|%|pt|pc|vw|vh|vmin|vmax|ch|ex|cm|mm|in|lh|rlh)/i.test(part);
    });
    if (sizeIndex > 0) {
      value = [...parts.slice(0, sizeIndex).filter((part) => {
        return part !== 'normal' && part !== '400';
      }), ...parts.slice(sizeIndex)].join(' ');
    }
  }

  if (property === 'background' && value !== 'none') {
    const normalized = value
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
      value = normalized;
    }
  }

  if (property === 'border') {
    // Remove default "medium" border-width keyword
    value = value.replace(/\bmedium\s+/g, '');
  }

  if (property === 'outline') {
    // Restore missing space between outline-style and a color keyword when they are adjacent
    value = value.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)(red|green|olive|tan|transparent)\b/g, '$1 $2');
  }

  if (property === 'transform') {
    value = minifyTransformValue(value);
    // Remove whitespace between consecutive transform functions
    value = value.replace(/\)\s+(?=[a-z-]+\()/gi, ')');
  }

  if (property === 'scale') {
    // Split scale value on whitespace into individual axis components
    const parts = value.split(/\s+/).filter(Boolean).map(normalizeScaleComponent);
    if (parts.length === 2 && parts[0] === parts[1]) {
      value = parts[0];
    } else if (parts.length === 3 && parts[2] === '1') {
      if (parts[0] === parts[1]) {
        value = parts[0];
      } else {
        value = parts[0] + ' ' + parts[1];
      }
    } else {
      value = parts.join(' ');
    }
  }

  // Replace multiple spaces
  value = value.replace(/\s+/g, ' ');

  // Shorthands: margin, padding, border-width, border-style, border-color, inset
  // Check if property supports box-model shorthand collapsing (4 → 3 → 2 → 1 values)
  if (/^(margin|padding|inset|border-width|border-style|border-color|gap|overflow)$/.test(property)) {
    value = collapseShorthandParts(value.split(' ')).join(' ');
  }

  if (property === 'border-radius') {
    const segments = value.split('/').map((segment) => {
      return segment.trim();
    }).filter(Boolean).map((segment) => {
      // Split each segment on whitespace and collapse redundant parts
      return collapseShorthandParts(segment.split(/\s+/)).join(' ');
    });
    value = segments.join('/');
  }

  return value;
}

/**
 * Minifies a CSS declaration's value by applying color conversion, math simplification, shorthand compression, gradient optimization, and other property-specific optimizations.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value string.
 */
function minifyValue (declaration) {
  const declarationCacheKey = getDeclarationCacheKey(declaration);
  if (declarationValueCache.has(declaration)) {
    const cachedDeclarationValue = declarationValueCache.get(declaration);
    if (cachedDeclarationValue.key === declarationCacheKey) {
      if (cachedDeclarationValue.value === UNDEFINED_CACHE_VALUE) {
        return undefined;
      }
      return cachedDeclarationValue.value;
    }
  }

  if (minifiedValueCache.has(declarationCacheKey)) {
    const cachedValue = minifiedValueCache.get(declarationCacheKey);
    setDeclarationCacheValue(
      declaration,
      declarationCacheKey,
      cachedValue === UNDEFINED_CACHE_VALUE ? undefined : cachedValue
    );
    if (cachedValue === UNDEFINED_CACHE_VALUE) {
      return undefined;
    }
    return cachedValue;
  }

  if (declaration.property === 'position-area') {
    const shorthand = POSITION_AREA_SHORTHANDS[declaration.value];
    if (shorthand) {
      setDeclarationCacheValue(declaration, declarationCacheKey, shorthand);
      setBoundedCacheValue(minifiedValueCache, declarationCacheKey, shorthand);
      return shorthand;
    }
  }
  let value = declaration.value;

  if (typeof value === 'string') {
    value = value.trim();
    value = normalizeWhitespaceAndQuotes(value, declaration.property);

    // Instead of unconditionally removing spaces around + and - and *, handle math vs non-math
    // Collapse spaces around division operator
    value = value.replace(/ \/ /g, '/');
    // Remove whitespace around * and / operators (safe outside calc context)
    value = value.replace(/\s*([*/])\s*/g, '$1');
    value = normalizeMathFunctions(value, declaration.property, declaration.value || '');
    value = simplifyStandaloneCalc(value);
    // Simplify calc() expressions containing zero-percent additive terms
    value = value.replace(/calc\(([^()]+)\)/gi, (match, inner) => {
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
      value = value.replace(/(^|\s|,|\()0(?:px|em|rem|vw|vh|cm|mm|in|pt|pc|ex|ch|vmin|vmax)(?=\s|,|$|\)|!)/g, '$10');
    }
    value = value.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3'); // e.g. 0.5 -> .5, -0.5 -> -.5

    // If value is a standalone number with optional unit, round it compactly
    if (/^[+-]?(?:\d+|\d*\.\d+)([a-z%]+)?$/i.test(value)) {
      const [, rawNumber, rawUnit = ''] = value.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z%]+)?$/i);
      value = roundCompactNumber(rawNumber, 4) + rawUnit;
    }

    // Remove space before hex colors
    value = replaceOutsideStringsAndUrls(value, (segment) => {
      segment = segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
      // Lowercase hex color tokens for consistency and shorter output
      segment = segment.replace(/#([0-9a-fA-F]{3,8})\b/gi, (hexMatch) => {
        return hexMatch.toLowerCase();
      });
      return segment;
    });

    // Convert color functions to hex equivalents
    value = convertColorsToHex(value);

    // Shorten all color tokens (hex and named) to their shortest representation
    value = replaceOutsideStringsAndUrls(value, shortenColorValues);

    // Property-specific optimizations
    value = applyPropertyOptimizations(value, declaration.property);
  }

  // Gradient optimizations
  // Check if value contains a gradient function
  if (/gradient\(/.test(value)) {
    value = minifyGradients(value);
  }

  // Unicode range compaction: U+0000-00FF -> U+??
  if (declaration.property === 'unicode-range') {
    value = value.replace(/U\+([0-9a-fA-F]+)-([0-9a-fA-F]+)/gi, (match, startHex, endHex) => {
      const len = Math.max(startHex.length, endHex.length);
      const s = startHex.padStart(len, '0').toUpperCase();
      const e = endHex.padStart(len, '0').toUpperCase();
      let prefixLen = 0;
      while (prefixLen < len && s[prefixLen] === e[prefixLen]) {
        prefixLen++;
      }
      const suffixS = s.slice(prefixLen);
      const suffixE = e.slice(prefixLen);
      // Check if the suffix range spans all values (all-zeros start, all-F end) for wildcard replacement
      if (/^0*$/.test(suffixS) && /^F*$/i.test(suffixE)) {
        const wildcardCount = len - prefixLen;
        // Strip leading zeros from the common prefix
        const prefix = s.slice(0, prefixLen).replace(/^0+/, '');
        return 'U+' + prefix + '?'.repeat(wildcardCount);
      }
      return match;
    });
  }

  setDeclarationCacheValue(declaration, declarationCacheKey, value);
  setBoundedCacheValue(minifiedValueCache, declarationCacheKey, value);
  return value;
}

export { minifyValue };
