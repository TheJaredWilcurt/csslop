/**
 * @file Converts CSS color functions (rgb, hsl, hwb, lab, oklab, oklch, color-mix, and relative colors) to their shortest equivalent, and compacts the ones that have to stay functions.
 */

import {
  formatCompactNumber,
  parseAlphaString,
  parseAngleToDegrees
} from '../shared.js';

import {
  convertLabToHex,
  convertOklabToHex,
  convertOklchToHex,
  hslToRgbChannels,
  hwbToRgbChannels,
  rgbaToHex
} from './conversion.js';
import { evaluateColorMix } from './mix.js';
import { evaluateRelativeColor } from './relative.js';

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
 * Removes whitespace before a negative numeric channel in Lab-family colors.
 * A preceding numeric token already separates the sign from the prior channel.
 *
 * @param  {string} functionName  The name of the color function.
 * @param  {string} value         The minified function arguments.
 * @return {string}               The arguments with redundant channel spacing removed.
 */
function compactNegativeColorChannelSpacing (functionName, value) {
  const normalizedFunctionName = functionName.toLowerCase();
  if (!['lab', 'lch', 'oklab', 'oklch'].includes(normalizedFunctionName)) {
    return value;
  }

  let result = '';
  let nestingDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === ' ' && nestingDepth === 0) {
      const previousCharacter = result[result.length - 1];
      const nextCharacter = value[index + 1];
      const characterAfterSign = value[index + 2];
      const characterAfterDecimal = value[index + 3];
      const previousEndsNumber = (
        isCssDigit(previousCharacter) ||
        previousCharacter === '%'
      );
      const nextStartsNegativeNumber = (
        nextCharacter === '-' &&
        (
          isCssDigit(characterAfterSign) ||
          (
            characterAfterSign === '.' &&
            isCssDigit(characterAfterDecimal)
          )
        )
      );
      if (previousEndsNumber && nextStartsNegativeNumber) {
        continue;
      }
    }
    result += character;
    if (character === '(') {
      nestingDepth++;
    } else if (character === ')') {
      nestingDepth--;
    }
  }
  return result;
}

/**
 * Checks whether a character is an ASCII decimal digit.
 *
 * @param  {string}  character  The character to inspect.
 * @return {boolean}            Whether the character is a digit.
 */
function isCssDigit (character) {
  return character >= '0' && character <= '9';
}

/**
 * Converts OKLCH lightness and chroma percentages when doing so is shorter,
 * including the separator each spelling needs before the hue.
 *
 * @param  {string} value  The normalized arguments of an `oklch()` function.
 * @return {string}        The arguments with shorter percentage spellings.
 */
function minifyOklchPercentages (value) {
  const slashIndex = value.indexOf('/');
  const componentsText = slashIndex === -1 ? value : value.slice(0, slashIndex);
  const alphaText = slashIndex === -1 ? '' : value.slice(slashIndex + 1);
  const components = componentsText.trim().split(' ');
  if (components.length !== 3) {
    return value;
  }

  let [lightness, chroma, hue] = components;
  if (lightness.endsWith('%')) {
    lightness = formatCompactNumber(Number.parseFloat(lightness) / 100);
  }
  if (chroma.endsWith('%')) {
    const convertedChroma = formatCompactNumber(
      Number.parseFloat(chroma) / 100 * OKLCH_CHROMA_PERCENT_REFERENCE
    );
    const convertedWithHueSeparator = convertedChroma.length + 1;
    if (chroma.length < convertedWithHueSeparator) {
      return [lightness, chroma + hue].join(' ') + (slashIndex === -1 ? '' : '/' + alphaText);
    }
    chroma = convertedChroma;
  }

  return [lightness, chroma, hue].join(' ') + (slashIndex === -1 ? '' : '/' + alphaText);
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
 * Evaluates the colors that are computed from other colors, `color-mix()` and
 * the `color(from ...)` relative color syntax, into the color they resolve to.
 *
 * @param  {string} value  The CSS value string with potential computed colors.
 * @return {string}        The value with computed colors resolved where possible.
 */
function resolveComputedColors (value) {
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
  return value;
}

/**
 * Converts in-gamut `lab()` colors (CIE Lab, D50) to hex when that produces a
 * shorter representation. Out-of-gamut colors have no sRGB representation, so
 * they are left in their native color space.
 *
 * @param  {string} value  The CSS value string that may contain lab() colors.
 * @return {string}        The value with in-gamut lab() colors replaced by hex where shorter.
 */
function convertLabFunctionsToHex (value) {
  // Match lab() with three numeric or percentage channels and an optional slash-delimited alpha
  return value.replace(/\blab\(\s*(-?(?:\d+|\d*\.\d+)%?)\s+(-?(?:\d+|\d*\.\d+)%?)\s+(-?(?:\d+|\d*\.\d+)%?)(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, lightnessText, aAxisText, bAxisText, alphaText) => {
    const alpha = parseAlphaString(alphaText);
    const lightness = parseFloat(lightnessText);
    const aNumber = parseFloat(aAxisText);
    const a = aAxisText.endsWith('%') ? aNumber * 1.25 : aNumber;
    const bNumber = parseFloat(bAxisText);
    const b = bAxisText.endsWith('%') ? bNumber * 1.25 : bNumber;
    const hex = convertLabToHex(lightness, a, b, alpha);
    if (!hex) {
      return match; // out-of-gamut: keep native lab form
    }
    if (hex.length < match.length) {
      return hex;
    }
    return match;
  });
}

/**
 * Minifies the whitespace and numeric precision inside the wide-gamut and
 * functional color notations, rounding each channel to the precision its color
 * space needs.
 *
 * @param  {string} value  The CSS value string that may contain color functions.
 * @return {string}        The value with every color function's arguments compacted.
 */
function compactColorFunctionArguments (value) {
  // Match a wide-gamut or functional color notation, capturing its name and its arguments
  return value.replace(/\b(oklab|oklch|lch|lab|color|hwb)\((.*?)\)/gi, (match, functionName, inner) => {
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
    // Remove trailing ".0" from numbers so integer channel values stay integer
    // (e.g. display-p3 1.0 0.0 0.0 becomes display-p3 1 0 0)
    minified = minified.replace(/(-?\d*)\.0\b/g, (match, integer) => {
      if (integer === '' || integer === '-' || integer === '-0') {
        return '0';
      }
      return integer;
    });
    minified = compactNegativeColorChannelSpacing(functionName, minified);
    if (functionName.toLowerCase() === 'oklch') {
      minified = minifyOklchPercentages(minified);
    }
    return functionName + '(' + minified.trim() + ')';
  });
}

/**
 * Converts in-gamut `oklab()` colors to hex when that produces a shorter
 * representation. Out-of-gamut colors have no sRGB representation, so they are
 * left in their native color space.
 *
 * @param  {string} value  The CSS value string that may contain oklab() colors.
 * @return {string}        The value with in-gamut oklab() colors replaced by hex where shorter.
 */
function convertOklabFunctionsToHex (value) {
  // Match oklab() with three numeric channels and an optional slash-delimited alpha.
  // A negative channel may touch the preceding number because its sign separates the CSS number tokens.
  return value.replace(/\boklab\(\s*(-?(?:\d+|\d*\.\d+))(?:\s+|(?=-))(-?(?:\d+|\d*\.\d+))(?:\s+|(?=-))(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, lightnessText, aAxisText, bAxisText, alphaText) => {
    const alpha = parseAlphaString(alphaText);
    const hex = convertOklabToHex(parseFloat(lightnessText), parseFloat(aAxisText), parseFloat(bAxisText), alpha);
    if (!hex) {
      return match; // out-of-gamut: keep native oklab form
    }
    if (hex.length < match.length) {
      return hex;
    }
    return match;
  });
}

/**
 * Replaces the `none` keyword inside `rgb()` and `hsl()` functions with zero,
 * which is how CSS Color Level 4 treats a missing component.
 *
 * @param  {string} value  The CSS value string that may contain rgb() or hsl() colors.
 * @return {string}        The value with every `none` component of those functions written as 0.
 */
function replaceNoneInLegacyColorFunctions (value) {
  // Match an rgb(), rgba(), hsl(), or hsla() function up to its closing parenthesis
  return value.replace(/\b(rgba?|hsla?)\([^)]*\)/gi, (match) => {
    // Match the none keyword as a whole word
    return match.replace(/\bnone\b/gi, '0');
  });
}

/**
 * Converts `hwb()` colors to hex. Whiteness and blackness are always read as
 * percentages, so their percent signs are optional.
 *
 * @param  {string} value  The CSS value string that may contain hwb() colors.
 * @return {string}        The value with hwb() colors replaced by hex.
 */
function convertHwbFunctionsToHex (value) {
  // hwb() → hex (percent signs optional for whiteness/blackness, values always treated as percentages)
  return value.replace(/\bhwb\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%?\s+((?:\d+|\d*\.\d+))%?(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hueText, whitenessText, blacknessText, alphaText) => {
    const [r, g, b] = hwbToRgbChannels(parseFloat(hueText), parseFloat(whitenessText) / 100, parseFloat(blacknessText) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(alphaText));
  });
}

/**
 * Converts the space-separated syntax of `rgb()` and `hsl()` colors to hex.
 *
 * @param  {string} value  The CSS value string that may contain rgb() or hsl() colors.
 * @return {string}        The value with space-separated rgb() and hsl() colors replaced by hex.
 */
function convertSpaceSeparatedRgbAndHslToHex (value) {
  // rgb()/rgba() space syntax → hex, case-insensitive (handles decimals and any alpha)
  value = value.replace(/\brgba?\(\s*(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))\s+(-?(?:\d+|\d*\.\d+))(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, redText, greenText, blueText, alphaText) => {
    const r = Math.round(parseFloat(redText));
    const g = Math.round(parseFloat(greenText));
    const b = Math.round(parseFloat(blueText));
    return rgbaToHex(r, g, b, parseAlphaString(alphaText));
  });

  // hsl()/hsla() space syntax → hex, case-insensitive (percent signs optional, values always treated as percentages)
  value = value.replace(/\bhsla?\(\s*(-?(?:\d+|\d*\.\d+))\s+((?:\d+|\d*\.\d+))%?\s+((?:\d+|\d*\.\d+))%?(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, hueText, saturationText, lightnessText, alphaText) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hueText), parseFloat(saturationText) / 100, parseFloat(lightnessText) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(alphaText));
  });
  return value;
}

/**
 * Converts the legacy comma-separated syntax of `rgb()` and `hsl()` colors to
 * hex, with or without an alpha component.
 *
 * @param  {string} value  The CSS value string that may contain rgb() or hsl() colors.
 * @return {string}        The value with comma-separated rgb() and hsl() colors replaced by hex.
 */
function convertCommaSeparatedRgbAndHslToHex (value) {
  // rgba() comma syntax → hex, case-insensitive (handles any alpha)
  value = value.replace(/\brgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/gi, (match, redText, greenText, blueText, alphaText) => {
    const r = parseInt(redText, 10);
    const g = parseInt(greenText, 10);
    const b = parseInt(blueText, 10);
    return rgbaToHex(r, g, b, parseAlphaString(alphaText));
  });

  // hsla() comma syntax → hex, case-insensitive (percent signs optional, values always treated as percentages)
  value = value.replace(/\bhsla\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*(-?(?:\d+|\d*\.\d+)%?)\s*\)/gi, (match, hueText, saturationText, lightnessText, alphaText) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hueText), parseFloat(saturationText) / 100, parseFloat(lightnessText) / 100);
    return rgbaToHex(r, g, b, parseAlphaString(alphaText));
  });

  // hsl()/hsla() comma syntax without alpha → hex, case-insensitive (percent signs optional, values always treated as percentages)
  value = value.replace(/\bhsla?\(\s*(-?(?:\d+|\d*\.\d+))\s*,\s*((?:\d+|\d*\.\d+))%?\s*,\s*((?:\d+|\d*\.\d+))%?\s*\)/gi, (match, hueText, saturationText, lightnessText) => {
    const [r, g, b] = hslToRgbChannels(parseFloat(hueText), parseFloat(saturationText) / 100, parseFloat(lightnessText) / 100);
    return rgbaToHex(r, g, b, 1);
  });

  // rgb() comma syntax → hex, case-insensitive
  value = value.replace(/\brgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi, (match, r, g, b) => {
    return rgbaToHex(parseInt(r, 10), parseInt(g, 10), parseInt(b, 10), 1);
  });
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
  let converted = resolveComputedColors(value);
  converted = convertLabFunctionsToHex(converted);
  // Convert in-gamut oklch() to hex before precision rounding, so the full authored precision is used
  converted = convertOklchFunctionsToHex(converted);
  converted = compactColorFunctionArguments(converted);
  converted = convertOklabFunctionsToHex(converted);
  converted = replaceNoneInLegacyColorFunctions(converted);
  converted = convertHwbFunctionsToHex(converted);
  converted = convertSpaceSeparatedRgbAndHslToHex(converted);
  return convertCommaSeparatedRgbAndHslToHex(converted);
}

export {
  convertColorsToHex
};
