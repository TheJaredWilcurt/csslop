/**
 * @file Minifies CSS declaration values by applying color conversion, math simplification, shorthand compression, and other property-specific optimizations.
 */

import { isUnicodeCharset } from '../context.js';
import { resolveUnicodeEscape } from '../utilities.js';

import { evaluateColorMix } from './color-mix.js';
import {
  convertLabToHex,
  convertOklabToHex,
  convertOklchToHex,
  hslToRgbChannels,
  hwbToRgbChannels,
  parseHex,
  rgbaToHex,
  shortestColor
} from './colors.js';
import { minifyGradients } from './gradients.js';
import { simplifyEquivalentLightDarkFunctions } from './light-dark.js';
import {
  normalizeMathFunctions,
  simplifyStandaloneCalc
} from './math.js';
import { namedColors } from './named-colors.js';
import { isQuotesNoneEquivalent } from './quotes.js';
import {
  evaluateRelativeColor,
  minifyRelativeColorSyntax
} from './relative-colors.js';
import {
  collapseShorthandParts,
  convertAbsoluteLengthToPx,
  normalizeScaleComponent,
  parseAlphaString,
  parseAngleToDegrees,
  roundCompactNumber
} from './shared.js';
import { findMatchingParenthesis } from './syntax.js';
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
  Object.keys(namedColors).sort((a, b) => {
    return b.length - a.length;
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
 * @typedef  {object}  ValueSegment
 * @property {string}  text          The segment's slice of the value.
 * @property {boolean} isLiteral     Whether the segment is a quoted string or a url() token.
 */

/**
 * Splits a CSS value into literal and syntax segments. A quoted string and a
 * `url()` token are literals: they hold data rather than CSS syntax, so no pass
 * may rewrite what is inside them. Everything between the literals is syntax.
 *
 * @param  {string} value  The full CSS value string.
 * @return {Array}         The value's segments, in order.
 */
function splitValueSegments (value) {
  const segments = [];
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

  const consumeUrl = (start) => {
    let depth = 1;
    let end = start + 4;
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
    return end;
  };

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = consumeQuoted(index);
      segments.push({ text: value.slice(index, end), isLiteral: true });
      index = end;
      continue;
    }

    if (startsUrl(index)) {
      const end = consumeUrl(index);
      segments.push({ text: value.slice(index, end), isLiteral: true });
      index = end;
      continue;
    }

    const start = index;
    while (index < value.length && value[index] !== '"' && value[index] !== '\'' && !startsUrl(index)) {
      index++;
    }
    segments.push({ text: value.slice(start, index), isLiteral: false });
  }

  return segments;
}

/**
 * Reports whether a segment is a quoted string. Every literal segment is either
 * a quoted string or a url() token, so anything else is one of the latter.
 *
 * @param  {ValueSegment} [segment]  The segment to test, when the value has one there.
 * @return {boolean}                 Whether the segment is a quoted string.
 */
function isQuotedStringSegment (segment) {
  if (!segment?.isLiteral) {
    return false;
  }
  return segment.text.startsWith('"') || segment.text.startsWith('\'');
}

/**
 * Applies a replacer function only to segments of a CSS value that are outside quoted strings and url() functions, preserving those literal segments unchanged.
 *
 * @param  {string}                   value     The full CSS value string.
 * @param  {function(string): string} replacer  A function called with each non-string, non-url segment, returning the replacement string.
 * @return {string}                             The value with the replacer applied to all eligible segments.
 */
function replaceOutsideStringsAndUrls (value, replacer) {
  return splitValueSegments(value).map((segment) => {
    if (segment.isLiteral) {
      return segment.text;
    }
    return replacer(segment.text);
  }).join('');
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

/**
 * Removes whitespace that precedes a hex color token. A `#` unambiguously starts
 * a hash token in CSS, so no separator is required between it and a preceding
 * ident, keyword, or number (e.g. `1px solid #f00` becomes `1px solid#f00`).
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value with spaces before hex colors removed.
 */
function elideSpaceBeforeHexColors (value) {
  return replaceOutsideStringsAndUrls(value, (segment) => {
    // Match whitespace followed by a hex color token of 3 to 8 hex digits
    return segment.replace(/\s+#([0-9a-fA-F]{3,8})\b/gi, '#$1');
  });
}

/**
 * Matches the separator whitespace at the head of a value segment. Whitespace
 * that precedes a `+` or a `-` is left alone, because a math function requires
 * those two operators to be surrounded by it.
 *
 * @type {RegExp}
 */
const LEADING_SEPARATOR_PATTERN = /^\s+(?![+-])/;

/**
 * Removes the separator whitespace that follows a closing parenthesis. A
 * parenthesis ends its own token, so the whitespace after one never keeps two
 * tokens from merging: `url(a.png) 30 round` holds the same tokens as
 * `url(a.png)30 round`.
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value without the redundant separators.
 */
function elideSpaceAfterParentheses (value) {
  const segments = splitValueSegments(value);
  return segments.map((segment, index) => {
    if (segment.isLiteral) {
      return segment.text;
    }
    let text = segment.text;
    const previousSegment = segments[index - 1];
    // A url() token ends with the parenthesis that closes it, so whitespace at
    // the head of the segment after one is a separator of the same kind
    if (previousSegment?.isLiteral && !isQuotedStringSegment(previousSegment)) {
      text = text.replace(LEADING_SEPARATOR_PATTERN, '');
    }
    // Match whitespace that follows a closing parenthesis
    return text.replace(/\)\s+(?![+-])/g, ')');
  }).join('');
}

/**
 * Removes the separator whitespace that follows a closing quote. A string ends
 * its own token, so no separator is needed between it and the token that comes
 * next: `"smcp" 1` holds the same tokens as `"smcp"1`.
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value without the redundant separators.
 */
function elideSpaceAfterStrings (value) {
  const segments = splitValueSegments(value);
  return segments.map((segment, index) => {
    if (segment.isLiteral || !isQuotedStringSegment(segments[index - 1])) {
      return segment.text;
    }
    return segment.text.replace(LEADING_SEPARATOR_PATTERN, '');
  }).join('');
}

/**
 * Reports whether a value separates top-level entries with commas, the way the
 * repeatable values of properties such as `font-variation-settings` and
 * `transition` do. Every literal is skipped, so a comma inside a string or a
 * url does not count, and the parenthesis depth tells a function's argument
 * separators apart from the value's own.
 *
 * @param  {string}  value  The CSS value string.
 * @return {boolean}        Whether the value holds more than one comma-separated entry.
 */
function hasCommaSeparatedEntries (value) {
  let depth = 0;
  for (const segment of splitValueSegments(value)) {
    if (segment.isLiteral) {
      continue;
    }
    for (const character of segment.text) {
      if (character === '(') {
        depth++;
      }
      if (character === ')') {
        depth = Math.max(0, depth - 1);
      }
      if (character === ',' && depth === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Restores the whitespace that a math function requires before a `+` or a `-`
 * operator. Both operators have to be surrounded by whitespace to be read as
 * operators rather than as the sign of the term that follows, and the
 * whitespace before one that trails a closing parenthesis is removed together
 * with the rest of the parenthesis padding.
 *
 * @param  {string} value  The CSS value string with parenthesis padding removed.
 * @return {string}        The value with the operator separator restored.
 */
function restoreSpaceBeforeMathOperators (value) {
  return replaceOutsideStringsAndUrls(value, (segment) => {
    // Match a closing parenthesis immediately followed by a `+` or `-` operator
    return segment.replace(/\)(?=[+-])/g, ') ');
  });
}

/**
 * Chooses the shortest valid representation for the path inside a `url(...)`
 * token, weighing an unquoted form, an escaped single space, and a quoted form.
 *
 * @param  {string} path  The resolved url path, without surrounding quotes.
 * @return {string}       The shortest valid url() content string.
 */
function formatUrlPath (path) {
  // Parentheses and quote characters are invalid inside an unquoted url() token
  const hasQuoteForcingCharacters = /[()"']/.test(path);
  // Count spaces so escaping them can be compared against keeping the quotes
  const spaceCount = (path.match(/ /g) || []).length;

  if (hasQuoteForcingCharacters || spaceCount >= 2) {
    // Escape any embedded double quotes so the double-quoted wrapper stays valid
    return '"' + path.replace(/"/g, '\\"') + '"';
  }

  if (spaceCount === 1) {
    // A lone space is one byte shorter to escape than to wrap the value in quotes
    return path.replace(/ /g, '\\ ');
  }

  return path;
}

/**
 * Produces the shortest valid contents for a single `url(...)` token from the
 * raw text between its parentheses, stripping a leading current-directory
 * indicator and normalizing quoting.
 *
 * @param  {string} rawContent  The trimmed text found between the url parentheses.
 * @return {string}             The minified url() content.
 */
function minifyUrlContent (rawContent) {
  const wasQuoted = rawContent.startsWith('"') || rawContent.startsWith('\'');
  let path = rawContent;
  if (wasQuoted) {
    const quote = rawContent[0];
    if (rawContent.length >= 2 && rawContent.endsWith(quote)) {
      path = rawContent.slice(1, -1);
    }
  }

  // Remove a leading current-directory indicator (`./`); browsers resolve it implicitly
  path = path.replace(/^\.\//, '');

  return formatUrlPath(path);
}

/**
 * Rewrites every `url(...)` token in a CSS value to its shortest valid form,
 * skipping any quoted strings so an embedded `url(` inside a string is ignored.
 *
 * @param  {string} value  The CSS value string potentially containing url() tokens.
 * @return {string}        The value with all url() tokens minified.
 */
function minifyUrls (value) {
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
      const closingParenIndex = findMatchingParenthesis(value, index + 3);
      if (closingParenIndex === -1) {
        result += value.slice(index);
        break;
      }
      const inner = value.slice(index + 4, closingParenIndex).trim();
      result += 'url(' + minifyUrlContent(inner) + ')';
      index = closingParenIndex + 1;
      continue;
    }

    result += value[index];
    index++;
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
 * The OKLCH chroma value that `100%` resolves to, per CSS Color Level 4.
 *
 * @type {number}
 */
const OKLCH_CHROMA_PERCENT_REFERENCE = 0.4;

/**
 * Regex matching an `oklch()` function with three space-separated components
 * and an optional slash-delimited alpha. Lightness and chroma accept numbers
 * or percentages, hue accepts a number with an optional CSS angle unit, and
 * every component accepts the `none` keyword.
 *
 * @type {RegExp}
 */
const OKLCH_FUNCTION_PATTERN = new RegExp(
  '\\boklch\\(\\s*' +
  '(none|-?(?:\\d+|\\d*\\.\\d+)%?)\\s+' +
  '(none|-?(?:\\d+|\\d*\\.\\d+)%?)\\s+' +
  '(none|-?(?:\\d+|\\d*\\.\\d+)(?:deg|grad|rad|turn)?)' +
  '(?:\\s*/\\s*(none|-?(?:\\d+|\\d*\\.\\d+)%?))?' +
  '\\s*\\)',
  'gi'
);

/**
 * Parses an OKLCH lightness or chroma component into its numeric value.
 * Missing components (`none`) resolve to zero, and percentages are scaled
 * against the reference value for that component.
 *
 * @param  {string}      token             The raw component token.
 * @param  {number}      percentReference  The value that `100%` represents for this component.
 * @return {number|null}                   The numeric component value, or null when unparsable.
 */
function parseOklchComponent (token, percentReference) {
  const normalized = token.trim().toLowerCase();
  if (normalized === 'none') {
    return 0;
  }
  const numeric = parseFloat(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (normalized.endsWith('%')) {
    return numeric / 100 * percentReference;
  }
  return numeric;
}

/**
 * Parses an OKLCH hue component into degrees, treating `none` as zero.
 *
 * @param  {string}      token  The raw hue token, optionally carrying an angle unit.
 * @return {number|null}        The hue in degrees, or null when unparsable.
 */
function parseOklchHue (token) {
  const normalized = token.trim().toLowerCase();
  if (normalized === 'none') {
    return 0;
  }
  return parseAngleToDegrees(normalized);
}

/**
 * Converts `oklch()` colors that fall inside the sRGB gamut to their hex
 * equivalent when that is shorter. Out-of-gamut colors have no sRGB
 * representation, so they are left in their native color space.
 *
 * @param  {string} value  The CSS value string that may contain oklch() colors.
 * @return {string}        The value with in-gamut oklch() colors replaced by hex.
 */
function convertOklchFunctionsToHex (value) {
  return value.replace(OKLCH_FUNCTION_PATTERN, (match, lightnessToken, chromaToken, hueToken, alphaToken) => {
    const lightness = parseOklchComponent(lightnessToken, 1);
    const chroma = parseOklchComponent(chromaToken, OKLCH_CHROMA_PERCENT_REFERENCE);
    const hue = parseOklchHue(hueToken);
    if (lightness === null || chroma === null || hue === null) {
      return match;
    }
    const alpha = alphaToken?.trim().toLowerCase() === 'none' ? 0 : parseAlphaString(alphaToken);
    const hex = convertOklchToHex(lightness, chroma, hue, alpha);
    if (!hex) {
      return match; // out-of-gamut: keep native oklch form
    }
    if (hex.length < match.length) {
      return hex;
    }
    return match;
  });
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

  // Convert in-gamut lab() (CIE Lab, D50) to hex when it produces a shorter representation
  val = val.replace(/\blab\(\s*(-?(?:\d+|\d*\.\d+)%?)\s+(-?(?:\d+|\d*\.\d+)%?)\s+(-?(?:\d+|\d*\.\d+)%?)(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, lStr, aStr, bStr, alphaStr) => {
    const alpha = parseAlphaString(alphaStr);
    const l = parseFloat(lStr);
    const aNumber = parseFloat(aStr);
    const a = aStr.endsWith('%') ? aNumber * 1.25 : aNumber;
    const bNumber = parseFloat(bStr);
    const b = bStr.endsWith('%') ? bNumber * 1.25 : bNumber;
    const hex = convertLabToHex(l, a, b, alpha);
    if (!hex) {
      return match; // out-of-gamut: keep native lab form
    }
    if (hex.length < match.length) {
      return hex;
    }
    return match;
  });

  // Convert in-gamut oklch() to hex before precision rounding, so the full authored precision is used
  val = convertOklchFunctionsToHex(val);

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
    // Remove trailing ".0" from numbers so integer channel values stay integer
    // (e.g. display-p3 1.0 0.0 0.0 becomes display-p3 1 0 0)
    minified = minified.replace(/(-?\d*)\.0\b/g, (match, integer) => {
      if (integer === '' || integer === '-' || integer === '-0') {
        return '0';
      }
      return integer;
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

/**
 * Properties whose `initial` value is a number the browser resolves, so the
 * keyword only ever shortens for the two that have a shorter written form.
 *
 * @type {Set<string>}
 */
const NUMERIC_INITIAL_PROPERTIES = new Set([
  'opacity',
  'z-index',
  'flex-grow',
  'flex-shrink',
  'order',
  'line-height',
  'zoom'
]);

/**
 * Properties whose `initial` value is zero.
 *
 * @type {Set<string>}
 */
const ZERO_INITIAL_PROPERTIES = new Set(['margin', 'padding']);

/**
 * Properties whose `initial` value is `auto`.
 *
 * @type {Set<string>}
 */
const AUTO_INITIAL_PROPERTIES = new Set(['min-width', 'min-height']);

/**
 * Properties whose value is a time, where a millisecond amount may be worth
 * rewriting in seconds.
 *
 * @type {Set<string>}
 */
const TIME_PROPERTIES = new Set([
  'transition',
  'transition-duration',
  'transition-delay',
  'animation',
  'animation-duration',
  'animation-delay'
]);

/**
 * Properties whose grammar delimits its own components, either with punctuation
 * (the `/` and `,` of the `background`, `mask`, and `src` layers) or by taking
 * nothing but functions (`transform`). Their components stay readable without
 * the whitespace that follows a closing parenthesis, so that whitespace is left
 * elided and each of them restores only the separators its grammar still needs.
 *
 * @type {Set<string>}
 */
const PUNCTUATED_COMPONENT_PROPERTIES = new Set([
  'background',
  'mask',
  'src',
  'transform'
]);

/**
 * Matches one offset of a position: an edge keyword or a numeric distance.
 *
 * @type {string}
 */
const POSITION_OFFSET_SOURCE = '(?:left|center|right|top|bottom|[+-]?(?:\\d+|\\d*\\.\\d+)(?:%|[a-z]+)?)';

/**
 * Matches a whole position component, which is one or two of those offsets.
 *
 * @type {string}
 */
const POSITION_COMPONENT_SOURCE = '(' + POSITION_OFFSET_SOURCE + '(?:\\s+' + POSITION_OFFSET_SOURCE + ')?)';

/**
 * Matches everything a `url()` holds up to but not including its own closing
 * parenthesis. A url is written without nested parentheses, so the first one
 * that closes it is the end of the token.
 *
 * @type {string}
 */
const URL_TOKEN_BODY_SOURCE = 'url\\([^()]*';

/**
 * Matches a close-paren that ends an image function, directly followed by a
 * position that no slash follows, which is the position that needs its
 * separator put back. The parenthesis that ends a `url()` is skipped, since
 * that one closes a token rather than a function.
 *
 * @type {RegExp}
 */
const UNSEPARATED_FUNCTION_POSITION_PATTERN = new RegExp('(?<!' + URL_TOKEN_BODY_SOURCE + ')\\)' + POSITION_COMPONENT_SOURCE + '(?!\\/)', 'gi');

/**
 * Matches a `url()` separated from the position that follows it, which is the
 * separator a url does not need.
 *
 * @type {RegExp}
 */
const SEPARATED_URL_POSITION_PATTERN = new RegExp('(' + URL_TOKEN_BODY_SOURCE + '\\))\\s+' + POSITION_COMPONENT_SOURCE, 'gi');

/**
 * Matches a close-paren separated from a position that a slash follows, where
 * the slash already delimits the position from the size behind it.
 *
 * @type {RegExp}
 */
const SEPARATED_IMAGE_SIZE_POSITION_PATTERN = new RegExp('\\)\\s+' + POSITION_COMPONENT_SOURCE + '(?=\\/)', 'gi');

/**
 * Normalizes the separator between the image of a layer and the position that
 * follows it. Both `background` and `mask` take a `<position> [ / <size> ]`
 * component after their image, and a bare position only reads as its own
 * component while whitespace separates it from an image function. Neither a
 * position that a `/` follows nor one that follows a `url()` needs the
 * separator, since the slash delimits the pair and a url is consumed whole as a
 * single token that ends at its own closing parenthesis.
 *
 * @param  {string} value  The layered image value, with the parenthesis padding removed.
 * @return {string}        The value with the position separator normalized.
 */
function normalizeImagePositionSeparator (value) {
  const separatedFromFunction = value.replace(UNSEPARATED_FUNCTION_POSITION_PATTERN, ') $1');
  const joinedToUrl = separatedFromFunction.replace(SEPARATED_URL_POSITION_PATTERN, '$1$2');
  return joinedToUrl.replace(SEPARATED_IMAGE_SIZE_POSITION_PATTERN, ')$1');
}

/**
 * Applies property-specific optimizations to a CSS value (transition, flex, font,
 * background, display, scale, border-radius, shorthand collapsing, etc.).
 *
 * @param  {string}  val                     The CSS value string after generic minification.
 * @param  {string}  property                The CSS property name.
 * @param  {boolean} allowsSeparatorElision  Whether redundant separator whitespace may be removed.
 * @return {string}                          The value with property-specific optimizations applied.
 */
function applyPropertyOptimizations (val, property, allowsSeparatorElision) {
  if (property === 'font-weight' && isUnicodeCharset()) {
    // Replace font-weight keyword "bold" with its numeric equivalent
    val = val.replace(/\bbold\b/gi, '700');
    // Replace font-weight keyword "normal" with its numeric equivalent
    val = val.replace(/\bnormal\b/gi, '400');
  }

  // Convert ms to s for time-related properties when the seconds form is shorter
  if (TIME_PROPERTIES.has(property)) {
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
    if (NUMERIC_INITIAL_PROPERTIES.has(property)) {
      // Just leaving them or mapping some: opacity: initial -> opacity: 1
      if (property === 'opacity') {
        val = '1';
      }
      if (property === 'z-index') {
        val = 'auto';
      }
    }
    if (ZERO_INITIAL_PROPERTIES.has(property)) {
      val = '0';
    }
    if (AUTO_INITIAL_PROPERTIES.has(property)) {
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

  // Custom properties hold an arbitrary token stream rather than a typed value,
  // so a unit-like token in one is not necessarily a length.
  const isCustomProperty = Boolean(property) && property.startsWith('--');
  if (!isCustomProperty) {
    val = replaceOutsideStringsAndUrls(val, convertAbsoluteLengthsToPx);
  }

  if (property === 'syntax') {
    // Remove whitespace around pipe separators in @property syntax descriptors
    val = val.replace(/\s*\|\s*/g, '|');
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
  val = replaceOutsideStringsAndUrls(val, (segment) => {
    return shortenColorValues(segment, allowsSeparatorElision);
  });

  // Remove space before hex colors (second pass after color evaluations)
  if (allowsSeparatorElision) {
    val = elideSpaceBeforeHexColors(val);
  }
  if (!PUNCTUATED_COMPONENT_PROPERTIES.has(property)) {
    // Restore space after close-paren when followed by an alphanumeric, hash, or hyphen
    val = val.replace(/\)(?=[0-9a-zA-Z#-])/g, ') ');
  }
  val = restoreSpaceBeforeMathOperators(val);

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
    val = normalizeImagePositionSeparator(val);
  }

  if (property === 'mask') {
    val = normalizeImagePositionSeparator(val);
  }

  if (property === 'border') {
    // Remove default "medium" border-width keyword
    val = val.replace(/\bmedium\s+/g, '');
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
function computeMinifiedValue (declaration) {
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
  // Values assembled from already-minified longhands keep the separator spaces
  // between their components, because those spaces delimit the shorthand's
  // parts rather than the authored whitespace of a single written value.
  const allowsSeparatorElision = !declaration.isAssembledShorthand;

  if (typeof val === 'string') {
    val = val.trim();
    val = normalizeWhitespaceAndQuotes(val, declaration.property);
    val = minifyUrls(val);

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

    val = lowercaseHexColors(val);
    if (allowsSeparatorElision) {
      val = elideSpaceBeforeHexColors(val);
    }

    // Convert color functions to hex equivalents
    val = convertColorsToHex(val);

    // Shorten all color tokens (hex and named) to their shortest representation.
    // An assembled shorthand keeps the whitespace between its components, so a
    // spelling of the same length saves it nothing and its components keep the
    // spelling they were written with.
    val = replaceOutsideStringsAndUrls(val, (segment) => {
      return shortenColorValues(segment, allowsSeparatorElision);
    });

    // Collapse light-dark() when both normalized branches are identical
    val = simplifyEquivalentLightDarkFunctions(val);

    // Property-specific optimizations
    val = applyPropertyOptimizations(val, declaration.property, allowsSeparatorElision);

    // Minify relative color syntax (identity resolution and whitespace collapsing)
    val = minifyRelativeColorSyntax(val);
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

  // Every earlier pass reads the value with its component separators in place,
  // so the ones that turned out to be redundant are only dropped at the end.
  // The properties that punctuate their own components never got them back.
  const elidesRedundantSeparators = (
    typeof val === 'string' &&
    allowsSeparatorElision &&
    !PUNCTUATED_COMPONENT_PROPERTIES.has(declaration.property)
  );
  if (elidesRedundantSeparators) {
    val = elideSpaceAfterParentheses(val);
    // A value written as one entry is elided down to its tokens, while a
    // comma-separated list keeps the whitespace that groups each of its entries.
    if (!hasCommaSeparatedEntries(val)) {
      val = elideSpaceAfterStrings(val);
    }
  }

  return val;
}

/**
 * Memoizes minified values for the current stylesheet. Minification runs many
 * passes over the same declarations (deduplication, shorthand assembly,
 * CSS-wide keyword hoisting, stringification), and the result only depends on
 * the declaration fields that make up the cache key, so each distinct
 * property/value pair is minified once per stylesheet.
 *
 * @type {Map<string, string>}
 */
const minifiedValueCache = new Map();

/**
 * Discards every memoized value. The minifier calls this at the start of each
 * stylesheet, since the active `@charset` can change how a value minifies and
 * the cache should not outlive the pass that filled it.
 */
function clearMinifiedValueCache () {
  minifiedValueCache.clear();
}

/**
 * Builds the cache key for a declaration from every field the value minifier
 * reads. A null character cannot appear in a property name or in a parsed CSS
 * value, so it safely delimits the parts.
 *
 * @param  {object} declaration  The CSS declaration object.
 * @return {string}              The cache key.
 */
function createMinifiedValueCacheKey (declaration) {
  const assembledFlag = declaration.isAssembledShorthand ? '1' : '0';
  return declaration.property + '\u0000' + assembledFlag + '\u0000' + declaration.value;
}

/**
 * Minifies a CSS declaration's value, reusing the memoized result when the same
 * property and value has already been minified during this pass.
 *
 * @param  {object} declaration  The CSS declaration object with property and value fields.
 * @return {string}              The minified value string.
 */
function minifyValue (declaration) {
  // Only string values have a stable, collision-free key; anything else is rare
  // enough that minifying it again costs less than encoding its type.
  if (typeof declaration.value !== 'string') {
    return computeMinifiedValue(declaration);
  }
  const cacheKey = createMinifiedValueCacheKey(declaration);
  const cachedValue = minifiedValueCache.get(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  const minifiedValue = computeMinifiedValue(declaration);
  minifiedValueCache.set(cacheKey, minifiedValue);
  return minifiedValue;
}

export {
  clearMinifiedValueCache,
  minifyValue
};
