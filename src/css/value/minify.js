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
  return segment.replace(COLOR_TOKEN_PATTERN, (match) => {
    let channels;
    if (match.startsWith('#')) {
      channels = parseHex(match);
    } else {
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
 * @param  {string} val       The raw CSS value string to normalize.
 * @param  {string} property  The CSS property name, used for context-aware quote handling.
 * @return {string}           The value with whitespace collapsed, quotes normalized, and unicode escapes resolved.
 */
function normalizeWhitespaceAndQuotes (val, property) {
  // Unescape unicode (skip control characters — they must stay escaped in CSS strings)
  val = val.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (match, hex) => {
    return resolveUnicodeEscape(hex) ?? match;
  });
  // Normalize single-quoted strings to double-quoted
  val = val.replace(/'((?:[^'\\]|\\.)*?)'/g, '"$1"');

  // Remove space between string literals
  val = val.replace(/("(?:[^"\\]|\\.)*")\s+(?=")/g, '$1');

  // Whitespace minification
  val = val.replace(/\s*!\s*important/i, '!important');
  // val = val.replace(/\s*([+*/=])\s*/g, '$1');
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
    let minified = inner.replace(/\s+/g, ' ');
    minified = minified.replace(/, /g, ',');
    minified = minified.replace(/ \/ /g, '/');
    minified = minified.replace(/\b0+(\.[\d]+)/g, '$1');
    minified = minified.replace(/([A-Za-z]) 0+(\.[\d]+)/g, '$1 $2');
    const useWidePrecision = func.toLowerCase() === 'color' && /\b(srgb-linear|xyz-d65|xyz-d50|xyz)\b/i.test(inner);
    // Round numbers with 3+ decimal places, using context-aware precision
    minified = minified.replace(/(^|[\s(,/-])(-?\d*\.\d{3,})/g, (match, before, num) => {
      const isAlpha = before === '/';
      const absoluteValue = Math.abs(parseFloat(num));
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

  // hwb() → hex
  val = val.replace(/\bhwb\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%\s+((?:\d+|\d*\.\d+))%(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hStr, wStr, bStr, aStr) => {
    const [r, g, b] = hwbToRgbChannels(parseFloat(hStr), parseFloat(wStr) / 100, parseFloat(bStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgb() space syntax → hex (handles decimals and any alpha)
  val = val.replace(/\brgb\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/g, (match, rStr, gStr, bStr, aStr) => {
    const r = Math.round(parseFloat(rStr));
    const g = Math.round(parseFloat(gStr));
    const b = Math.round(parseFloat(bStr));
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl() space syntax → hex (handles any alpha)
  val = val.replace(/\bhsl\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%\s+((?:\d+|\d*\.\d+))%(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/g, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // rgba() comma syntax → hex (handles any alpha)
  val = val.replace(/\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/g, (match, rStr, gStr, bStr, aStr) => {
    const r = parseInt(rStr, 10);
    const g = parseInt(gStr, 10);
    const b = parseInt(bStr, 10);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsla() comma syntax → hex (handles any alpha)
  val = val.replace(/\bhsla\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/g, (match, hStr, sStr, lStr, aStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(aStr));
  });

  // hsl() comma syntax → hex
  val = val.replace(/\bhsl\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%\s*,\s*((?:\d+|\d*\.\d+))%\s*\)/g, (match, hStr, sStr, lStr) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hStr), parseFloat(sStr) / 100, parseFloat(lStr) / 100);
    return rgbaToHex(r, g, b, 1);
  });

  // rgb() comma syntax → hex
  val = val.replace(/\brgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (match, r, g, b) => {
    return rgbaToHex(parseInt(r, 10), parseInt(g, 10), parseInt(b, 10), 1);
  });
  return val;
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
  if (property === 'font-weight') {
    val = val.replace(/\bbold\b/gi, '700');
    val = val.replace(/\bnormal\b/gi, '400');
  }

  if (property === 'transition-duration') {
    val = val.replace(/^(-?(?:\d+|\d*\.\d+))ms$/i, (match, amount) => {
      return roundCompactNumber(parseFloat(amount) / 1000) + 's';
    });
  }

  // Transition: remove " 0s" duration (transition: all 0s -> transition: all)
  if (property === 'transition') {
    val = val.replace(/\s+0s/g, ' ');
    val = val.replace(/^0px\s*/, '');
    val = val.replace(/cubic-bezier\(0,0,1,1\)/g, 'linear');
    val = val.replace(/cubic-bezier\(\.25,\.1,\.25,1\)/g, 'ease');
    val = val.replace(/cubic-bezier\(\.42,0,1,1\)/g, 'ease-in');
    val = val.replace(/cubic-bezier\(0,0,\.58,1\)/g, 'ease-out');
    val = val.trim();
  }

  if (property === 'animation') {
    val = val.replace(/steps\(1,start\)/g, 'step-start');
    val = val.replace(/steps\(1,end\)/g, 'step-end');
  }

  // Flex: remove " 0px" from flex shorthand (flex: 0 0 0px -> flex: 0 0)
  if (property === 'flex') {
    val = val.replace(/\s+0px/g, ' ');
    val = val.replace(/^0px\s*/, '');
    val = val.replace(/\s+0$/, '');
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
    if (val === 'center center') {
      val = '50%';
    }
    if (val === 'left top') {
      val = '0 0';
    }
  }

  if (property === 'border' && /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)\s+/i.test(val)) {
    val = val.replace(/^((?:solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none))\s+([^\s]+)\s+(.+)$/i, '$2 $1 $3');
  }

  if (property === 'flex-flow') {
    val = val.replace(/^(nowrap|wrap|wrap-reverse)\s+(row|row-reverse|column|column-reverse)$/i, '$2 $1');
  }

  if (property === 'font-family') {
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
    val = val.replace(/"([^"]*)"/g, (match, inner) => {
      let normalized = inner.replace(/\s+/g, ' ').trim();
      normalized = normalized.replace(/(^| )\.{2,}(?= |$)/g, '$1.');
      return '"' + normalized + '"';
    });
  }

  if (property === 'font-size') {
    val = val.replace(/^(-?(?:\d+|\d*\.\d+))pt$/i, (match, amount) => {
      return roundCompactNumber(parseFloat(amount) * (96 / 72)) + 'px';
    });
  }

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
    return segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
  });
  if (property !== 'transform' && property !== 'background' && property !== 'src') {
    // Restore space after close-paren when followed by an alphanumeric, hash, or hyphen
    val = val.replace(/\)(?=[0-9a-zA-Z#-])/g, ') ');
  }

  if (property === 'font') {
    const parts = val.split(/\s+/);
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
      .replace(/(?:^|\s)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ' ')
      .replace(/\)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ') ')
      .replace(/(?<!-)\brepeat\b(?!-)/g, ' ')
      .replace(/\bscroll\b/g, ' ')
      .replace(/\bnone\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized) {
      val = normalized;
    }
  }

  if (property === 'border') {
    val = val.replace(/\bmedium\s+/g, '');
  }

  if (property === 'outline') {
    // Restore missing space between outline-style and a color keyword when they are adjacent
    val = val.replace(/\b(solid|dashed|dotted|double|groove|ridge|inset|outset|hidden|none)(red|green|olive|tan|transparent)\b/g, '$1 $2');
  }

  if (property === 'transform') {
    val = minifyTransformValue(val);
    val = val.replace(/\)\s+(?=[a-z-]+\()/gi, ')');
  }

  if (property === 'scale') {
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
  if (/^(margin|padding|inset|border-width|border-style|border-color|gap|overflow)$/.test(property)) {
    val = collapseShorthandParts(val.split(' ')).join(' ');
  }

  if (property === 'border-radius') {
    const segments = val.split('/').map((segment) => {
      return segment.trim();
    }).filter(Boolean).map((segment) => {
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
  let val = declaration.value;

  if (typeof val === 'string') {
    val = val.trim();
    val = normalizeWhitespaceAndQuotes(val, declaration.property);

    // Instead of unconditionally removing spaces around + and - and *, handle math vs non-math
    val = val.replace(/ \/ /g, '/');
    val = val.replace(/\s*([*/])\s*/g, '$1'); // Space around * and / is safely removable
    val = normalizeMathFunctions(val, declaration.property, declaration.value || '');
    val = simplifyStandaloneCalc(val);
    val = val.replace(/calc\(([^()]+)\)/gi, (match, inner) => {
      const compactInner = inner.replace(/\s+/g, ' ').trim();
      const percentTerms = compactInner.match(/[+-]?\s*(?:\d*\.\d+|\d+)%/g) || [];
      const hasNonZeroPercent = percentTerms.some((term) => {
        return Math.abs(parseFloat(term)) > 0;
      });
      if (!hasNonZeroPercent) {
        return match;
      }
      return 'calc(' + compactInner.replace(/\s*\+\s*0%(?=\s*$)/g, '').replace(/^0%\s*\+\s*/g, '').trim() + ')';
    });

    // Zeros and Decimals
    if (declaration.property !== 'initial-value') {
      // Strip units from zero values (0px → 0, 0em → 0, etc.) at a value boundary
      val = val.replace(/(^|\s|,|\()0(?:px|em|rem|vw|vh|cm|mm|in|pt|pc|ex|ch|vmin|vmax)(?=\s|,|$|\)|!)/g, '$10');
    }
    val = val.replace(/(^|\s|,|\()(-?)0+(\.\d+)/g, '$1$2$3'); // e.g. 0.5 -> .5, -0.5 -> -.5

    if (/^[+-]?(?:\d+|\d*\.\d+)([a-z%]+)?$/i.test(val)) {
      const [, rawNumber, rawUnit = ''] = val.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z%]+)?$/i);
      val = roundCompactNumber(rawNumber, 4) + rawUnit;
    }

    // Remove space before hex colors
    val = replaceOutsideStringsAndUrls(val, (segment) => {
      segment = segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
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
  if (/gradient\(/.test(val)) {
    val = minifyGradients(val);
  }

  // Unicode range compaction: U+0000-00FF -> U+??
  if (declaration.property === 'unicode-range') {
    val = val.replace(/U\+([0-9a-fA-F]+)-([0-9a-fA-F]+)/gi, (match, startHex, endHex) => {
      const len = Math.max(startHex.length, endHex.length);
      const s = startHex.padStart(len, '0').toUpperCase();
      const e = endHex.padStart(len, '0').toUpperCase();
      let prefixLen = 0;
      while (prefixLen < len && s[prefixLen] === e[prefixLen]) {
        prefixLen++;
      }
      const suffixS = s.slice(prefixLen);
      const suffixE = e.slice(prefixLen);
      if (/^0*$/.test(suffixS) && /^F*$/i.test(suffixE)) {
        const wildcardCount = len - prefixLen;
        const prefix = s.slice(0, prefixLen).replace(/^0+/, '');
        return 'U+' + prefix + '?'.repeat(wildcardCount);
      }
      return match;
    });
  }

  return val;
}

export { minifyValue };
