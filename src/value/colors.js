/**
 * @file Provides color parsing, color space conversion (sRGB, OKLab, OKLCH, HSL, HWB), color-mix evaluation, and hex formatting for CSS value minification.
 */

import { namedColors } from './named-colors.js';
import {
  parseAlphaString,
  roundCompactNumber
} from './shared.js';

/**
 * Reverse lookup from "r,g,b" to the shortest CSS named color keyword.
 * Built once at module load from the namedColors map.
 *
 * @type {Map<string, string>}
 */
const rgbToShortestName = new Map();
for (const [name, channels] of Object.entries(namedColors)) {
  const key = channels[0] + ',' + channels[1] + ',' + channels[2];
  const existing = rgbToShortestName.get(key);
  if (!existing || name.length < existing.length) {
    rgbToShortestName.set(key, name);
  }
}

/**
 * Converts HSL color values to RGB channel values in the 0–255 range.
 *
 * @param  {number} hue         The hue angle in degrees.
 * @param  {number} saturation  The saturation as a fraction from 0 to 1.
 * @param  {number} lightness   The lightness as a fraction from 0 to 1.
 * @return {Array}              An array of [r, g, b] channel values, each 0–255.
 */
function hslToRgbChannels (hue, saturation, lightness) {
  const normalizedHue = (((hue % 360) + 360) % 360) / 360;
  const normalizedSaturation = Math.max(0, Math.min(1, saturation));
  const normalizedLightness = Math.max(0, Math.min(1, lightness));

  if (normalizedSaturation === 0) {
    const channel = Math.round(normalizedLightness * 255);
    return [channel, channel, channel];
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };

  const q = normalizedLightness < 0.5 ?
    normalizedLightness * (1 + normalizedSaturation) :
    normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;

  return [
    Math.round(hue2rgb(p, q, normalizedHue + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, normalizedHue) * 255),
    Math.round(hue2rgb(p, q, normalizedHue - 1 / 3) * 255)
  ];
}

/**
 * Converts RGBA channel values to a hex color string, omitting the alpha suffix when fully opaque.
 *
 * @param  {number} r      The red channel value, 0–255.
 * @param  {number} g      The green channel value, 0–255.
 * @param  {number} b      The blue channel value, 0–255.
 * @param  {number} alpha  The alpha value from 0 to 1.
 * @return {string}        A hex color string like "#rrggbb" or "#rrggbbaa".
 */
function rgbaToHex (r, g, b, alpha = 1) {
  const rgbHex = [r, g, b].map((channel) => {
    const value = Math.max(0, Math.min(255, Math.round(channel)));
    return value.toString(16).padStart(2, '0');
  }).join('');
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));
  const alphaByte = Math.round(normalizedAlpha * 255);
  const alphaHex = alphaByte === 255 ? '' : alphaByte.toString(16).padStart(2, '0');
  return '#' + rgbHex + alphaHex;
}

/**
 * Finds the shortest CSS representation of an RGBA color by comparing
 * the full hex, shortened hex (collapsed digit pairs), and any matching
 * named color keyword. Prefers hex when representations tie in length.
 *
 * @param  {number} r      The red channel value, 0–255.
 * @param  {number} g      The green channel value, 0–255.
 * @param  {number} b      The blue channel value, 0–255.
 * @param  {number} alpha  The alpha value from 0 to 1.
 * @return {string}        The shortest CSS color string.
 */
function shortestColor (r, g, b, alpha = 1) {
  r = Math.max(0, Math.min(255, Math.round(r)));
  g = Math.max(0, Math.min(255, Math.round(g)));
  b = Math.max(0, Math.min(255, Math.round(b)));
  alpha = Math.max(0, Math.min(1, alpha));

  const fullHex = rgbaToHex(r, g, b, alpha);

  // Try collapsing identical hex digit pairs: #rrggbbaa → #rgba, #rrggbb → #rgb
  let shortest = fullHex;
  const match8 = fullHex.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3([0-9a-f])\4$/);
  if (match8) {
    shortest = '#' + match8[1] + match8[2] + match8[3] + match8[4];
  } else {
    const match6 = fullHex.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/);
    if (match6) {
      shortest = '#' + match6[1] + match6[2] + match6[3];
    }
  }

  // Check named colors (only fully opaque colors have named equivalents)
  const alphaByte = Math.round(alpha * 255);
  if (alphaByte === 255) {
    const key = r + ',' + g + ',' + b;
    const name = rgbToShortestName.get(key);
    if (name && name.length < shortest.length) {
      shortest = name;
    }
  }

  return shortest;
}

/**
 * Converts HWB (hue, whiteness, blackness) color values to RGB channel values in the 0–255 range.
 *
 * @param  {number} hue        The hue angle in degrees.
 * @param  {number} whiteness  The whiteness as a fraction from 0 to 1.
 * @param  {number} blackness  The blackness as a fraction from 0 to 1.
 * @return {Array}             An array of [r, g, b] channel values, each 0–255.
 */
function hwbToRgbChannels (hue, whiteness, blackness) {
  let w = Math.max(0, Math.min(1, whiteness));
  let b = Math.max(0, Math.min(1, blackness));

  if (w + b >= 1) {
    const gray = Math.round((w / (w + b)) * 255);
    return [gray, gray, gray];
  }

  const [r, g, bl] = hslToRgbChannels(hue, 1, 0.5);
  const ratio = 1 - w - b;
  return [
    Math.round(r / 255 * ratio * 255 + w * 255),
    Math.round(g / 255 * ratio * 255 + w * 255),
    Math.round(bl / 255 * ratio * 255 + w * 255)
  ];
}

/**
 * Converts a gamma-encoded sRGB component to linear light using the sRGB transfer function.
 *
 * @param  {number} c  The gamma-encoded sRGB component, 0 to 1.
 * @return {number}    The linearized component value.
 */
function linearize (c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Applies sRGB gamma encoding to a linear-light component, the inverse of linearize.
 *
 * @param  {number} c  The linear-light component, 0 to 1.
 * @return {number}    The gamma-encoded sRGB component value.
 */
function delinearize (c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Converts sRGB color components (0–1) to the OKLab perceptual color space.
 *
 * @param  {number} r  The red component, 0 to 1.
 * @param  {number} g  The green component, 0 to 1.
 * @param  {number} b  The blue component, 0 to 1.
 * @return {object}    An object with L, a, b OKLab components.
 */
function srgbToOklab (r, g, b) {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  };
}

/**
 * Converts OKLab color components to unclamped linear sRGB, used for gamut-boundary checking.
 *
 * @param  {number} L  The OKLab lightness component.
 * @param  {number} a  The OKLab green-red axis component.
 * @param  {number} b  The OKLab blue-yellow axis component.
 * @return {object}    An object with r, g, b linear sRGB components (may exceed 0–1).
 */
function oklabToLinearSrgb (L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  };
}

/**
 * Converts OKLab color components to clamped, gamma-encoded sRGB (0–1).
 *
 * @param  {number} L  The OKLab lightness component.
 * @param  {number} a  The OKLab green-red axis component.
 * @param  {number} b  The OKLab blue-yellow axis component.
 * @return {object}    An object with r, g, b sRGB components, each clamped to 0–1.
 */
function oklabToSrgb (L, a, b) {
  const linear = oklabToLinearSrgb(L, a, b);
  return {
    r: Math.max(0, Math.min(1, delinearize(linear.r))),
    g: Math.max(0, Math.min(1, delinearize(linear.g))),
    b: Math.max(0, Math.min(1, delinearize(linear.b)))
  };
}

/**
 * Converts OKLab color components to the OKLCH cylindrical representation.
 *
 * @param  {number} L  The OKLab lightness component.
 * @param  {number} a  The OKLab green-red axis component.
 * @param  {number} b  The OKLab blue-yellow axis component.
 * @return {object}    An object with L (lightness), C (chroma), H (hue in degrees).
 */
function oklabToOklch (L, a, b) {
  const C = Math.sqrt(a * a + b * b);
  let H = Math.atan2(b, a) * (180 / Math.PI);
  if (H < 0) {
    H += 360;
  }
  return { L, C, H };
}

/**
 * Converts OKLCH cylindrical color components back to OKLab rectangular coordinates.
 *
 * @param  {number} L  The OKLCH lightness component.
 * @param  {number} C  The chroma value.
 * @param  {number} H  The hue angle in degrees.
 * @return {object}    An object with L, a, b OKLab components.
 */
function oklchToOklab (L, C, H) {
  const hRad = H * Math.PI / 180;
  return {
    L,
    a: C * Math.cos(hRad),
    b: C * Math.sin(hRad)
  };
}

/**
 * Interpolates between two hue angles along the shorter arc, per the CSS Color specification.
 *
 * @param  {number} h1  The first hue angle in degrees.
 * @param  {number} h2  The second hue angle in degrees.
 * @param  {number} t   The interpolation factor from 0 to 1.
 * @return {number}     The interpolated hue angle in degrees, normalized to 0–360.
 */
function interpolateHueShorter (h1, h2, t) {
  let diff = h2 - h1;
  if (diff > 180) {
    diff -= 360;
  }
  if (diff < -180) {
    diff += 360;
  }
  let result = h1 + diff * t;
  return ((result % 360) + 360) % 360;
}

/**
 * Parse a hex color string to [r, g, b, a].
 *
 * @param  {string}     hex  The hex color string (3, 4, 6, or 8 hex digits, with or without leading #).
 * @return {Array|null}      An [r, g, b, a] array (r,g,b: 0–255, a: 0–1), or null for invalid lengths.
 */
function parseHex (hex) {
  // Strip leading # from hex string
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 1];
  }
  if (hex.length === 4) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), parseInt(hex[3] + hex[3], 16) / 255];
  }
  if (hex.length === 6) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
  }
  if (hex.length === 8) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16) / 255];
  }
  return null;
}

/**
 * Parse a CSS color string to [r, g, b, a] (r,g,b: 0-255, a: 0-1) or null if unresolvable.
 *
 * @param  {string}     colorString  The CSS color string (named, hex, rgb, rgba, hsl, hsla, or hwb).
 * @return {Array|null}              An [r, g, b, a] array, or null if the color cannot be parsed.
 */
function parseColor (colorString) {
  let normalized = colorString.trim().toLowerCase();

  // Handle 'none' keyword in channels
  normalized = normalized.replace(/\bnone\b/g, '0');

  // Named color
  if (namedColors[normalized]) {
    // transparent has alpha=0, all other named colors have alpha=1
    const alpha = normalized === 'transparent' ? 0 : 1;
    return [...namedColors[normalized], alpha];
  }

  // Hex
  if (normalized.startsWith('#')) {
    return parseHex(normalized);
  }

  // rgb() / rgba() space syntax
  let match = normalized.match(/^rgba?\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*(-?[\d.]+%?))?\s*\)$/);
  if (match) {
    const r = Math.round(parseFloat(match[1]));
    const g = Math.round(parseFloat(match[2]));
    const b = Math.round(parseFloat(match[3]));
    return [r, g, b, Math.max(0, Math.min(1, parseAlphaString(match[4])))];
  }

  // rgb() / rgba() comma syntax
  match = normalized.match(/^rgba?\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+%?))?\s*\)$/);
  if (match) {
    const r = Math.round(parseFloat(match[1]));
    const g = Math.round(parseFloat(match[2]));
    const b = Math.round(parseFloat(match[3]));
    return [r, g, b, Math.max(0, Math.min(1, parseAlphaString(match[4])))];
  }

  // hsl() / hsla() space syntax
  match = normalized.match(/^hsla?\(\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*(-?[\d.]+%?))?\s*\)$/);
  if (match) {
    const [r, g, b] = hslToRgbChannels(parseFloat(match[1]), parseFloat(match[2]) / 100, parseFloat(match[3]) / 100);
    return [r, g, b, Math.max(0, Math.min(1, parseAlphaString(match[4])))];
  }

  // hsl() / hsla() comma syntax
  match = normalized.match(/^hsla?\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*(-?[\d.]+%?))?\s*\)$/);
  if (match) {
    const [r, g, b] = hslToRgbChannels(parseFloat(match[1]), parseFloat(match[2]) / 100, parseFloat(match[3]) / 100);
    return [r, g, b, Math.max(0, Math.min(1, parseAlphaString(match[4])))];
  }

  // hwb()
  match = normalized.match(/^hwb\(\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*(-?[\d.]+%?))?\s*\)$/);
  if (match) {
    const [r, g, b] = hwbToRgbChannels(parseFloat(match[1]), parseFloat(match[2]) / 100, parseFloat(match[3]) / 100);
    return [r, g, b, Math.max(0, Math.min(1, parseAlphaString(match[4])))];
  }

  return null;
}

/**
 * Convert [r, g, b] (0-255) to OKLab {L, a, b}.
 *
 * @param  {number} r  The red channel value, 0–255.
 * @param  {number} g  The green channel value, 0–255.
 * @param  {number} b  The blue channel value, 0–255.
 * @return {object}    An object with L, a, b OKLab components.
 */
function rgbToOklab (r, g, b) {
  return srgbToOklab(r / 255, g / 255, b / 255);
}

/**
 * Convert [r, g, b] (0-255) to OKLCH {L, C, H}.
 *
 * @param  {number} r  The red channel value, 0–255.
 * @param  {number} g  The green channel value, 0–255.
 * @param  {number} b  The blue channel value, 0–255.
 * @return {object}    An object with L (lightness), C (chroma), H (hue in degrees).
 */
function rgbToOklch (r, g, b) {
  const lab = rgbToOklab(r, g, b);
  return oklabToOklch(lab.L, lab.a, lab.b);
}

/**
 * Convert OKLab {L, a, b} to [r, g, b] (0-255).
 *
 * @param  {number} L  The OKLab lightness component.
 * @param  {number} a  The OKLab green-red axis component.
 * @param  {number} b  The OKLab blue-yellow axis component.
 * @return {Array}     An [r, g, b] array with channel values 0–255.
 */
function oklabToRgb (L, a, b) {
  const srgb = oklabToSrgb(L, a, b);
  return [Math.round(srgb.r * 255), Math.round(srgb.g * 255), Math.round(srgb.b * 255)];
}

/**
 * Format an OKLCH result as a minified string.
 *
 * @param  {number}           L      The lightness component.
 * @param  {number}           C      The chroma component.
 * @param  {number}           H      The hue angle in degrees.
 * @param  {number|undefined} alpha  The alpha value from 0 to 1, or undefined for fully opaque.
 * @return {string}                  A minified oklch() function string.
 */
function formatOklch (L, C, H, alpha) {
  const fmtL = roundCompactNumber(L, 3);
  const fmtC = roundCompactNumber(C, 3);
  const fmtH = roundCompactNumber(H, 1);
  if (alpha !== undefined && alpha < 1) {
    return 'oklch(' + fmtL + ' ' + fmtC + ' ' + fmtH + '/' + roundCompactNumber(alpha, 3) + ')';
  }
  return 'oklch(' + fmtL + ' ' + fmtC + ' ' + fmtH + ')';
}

/**
 * Detect which channel indices have 'none' in a raw color function string.
 *
 * @param  {string} rawColorStr  The raw CSS color function string (e.g. "rgb(none 0 0)").
 * @return {Array}               An array of zero-based channel indices where 'none' was found.
 */
function findNoneChannels (rawColorStr) {
  const indices = [];
  // Match rgb/rgba/hsl/hsla/hwb function calls and extract their arguments
  const functionMatch = rawColorStr.match(/\b(?:rgba?|hsla?|hwb)\(([^)]*)\)/i);
  if (functionMatch) {
    // Split arguments on whitespace, commas, or slash separators
    const parts = functionMatch[1].trim().split(/[\s,/]+/).map((part) => {
      return part.trim();
    }).filter((part) => {
      return part.length > 0;
    });
    parts.forEach((part, index) => {
      if (part.toLowerCase() === 'none') {
        indices.push(index);
      }
    });
  }
  return indices;
}

/**
 * Evaluate an N-color (3+) color-mix() expression. Returns a minified CSS color string or null.
 *
 * @param  {string}      colorSpace  The interpolation color space ("srgb", "oklab", or "oklch").
 * @param  {Array}       args        The raw argument strings for each color.
 * @return {string|null}             A minified CSS color string, or null if the expression cannot be evaluated.
 */
function evaluateNColorMix (colorSpace, args) {
  const parsedArgs = [];
  for (const arg of args) {
    const parsed = parseColorMixArg(arg.trim());
    if (!parsed) {
      return null;
    }
    parsedArgs.push(parsed);
  }

  // If any color is unresolvable (var(), currentcolor), whitespace-strip only
  if (parsedArgs.some((parsedArg) => {
    return !parsedArg.color;
  })) {
    return normalizeUnresolvableNColorMix(colorSpace, parsedArgs);
  }

  const percentages = normalizeNColorPercentages(parsedArgs);
  const percentageSum = percentages.reduce((sum, value) => {
    return sum + value;
  }, 0);

  // All-zero percentages → transparent black
  if (percentageSum === 0) {
    return rgbaToHex(0, 0, 0, 0);
  }

  let alphaMultiplier = 1;
  if (percentageSum < 100) {
    alphaMultiplier = percentageSum / 100;
  } else if (percentageSum > 100) {
    for (let i = 0; i < percentages.length; i++) {
      percentages[i] = percentages[i] / percentageSum * 100;
    }
  }

  // Compute weights
  const totalPercentage = percentages.reduce((sum, value) => {
    return sum + value;
  }, 0);
  const weights = percentages.map((value) => {
    return value / totalPercentage;
  });
  const colors = parsedArgs.map((parsedArg) => {
    return parsedArg.color;
  });

  if (colorSpace === 'srgb') {
    return mixNColorsSrgb(colors, weights, alphaMultiplier);
  }

  if (colorSpace === 'oklab') {
    return mixNColorsOklab(colors, weights, alphaMultiplier);
  }

  return null;
}

/**
 * Normalize percentages for an N-color color-mix() expression.
 * When no percentages are specified, each color gets an equal share of 100%.
 * When some are unspecified, the remaining percentage is split equally among them.
 *
 * @param  {Array} parsedArgs  The parsed color-mix arguments.
 * @return {Array}             An array of normalized percentage values.
 */
function normalizeNColorPercentages (parsedArgs) {
  const percentages = parsedArgs.map((parsedArg) => {
    return parsedArg.percentage;
  });
  if (percentages.every((value) => {
    return value === null;
  })) {
    const equalWeight = 100 / parsedArgs.length;
    return parsedArgs.map(() => {
      return equalWeight;
    });
  }
  const specifiedSum = percentages.reduce((sum, value) => {
    return sum + (value !== null ? value : 0);
  }, 0);
  const unspecifiedCount = percentages.filter((value) => {
    return value === null;
  }).length;
  if (unspecifiedCount > 0) {
    const remaining = Math.max(0, 100 - specifiedSum);
    const percentagePerUnspecified = remaining / unspecifiedCount;
    return percentages.map((value) => {
      return value !== null ? value : percentagePerUnspecified;
    });
  }
  return percentages;
}

/**
 * Build a whitespace-stripped color-mix() string for an unresolvable N-color expression.
 *
 * @param  {string} colorSpace  The interpolation color space.
 * @param  {Array}  parsedArgs  The parsed color-mix arguments.
 * @return {string}             A whitespace-stripped color-mix() expression.
 */
function normalizeUnresolvableNColorMix (colorSpace, parsedArgs) {
  const parts = parsedArgs.map((parsedArg) => {
    const rawColor = parsedArg.raw.trim();
    const percentageString = parsedArg.percentage !== null ? ' ' + parsedArg.percentage + '%' : '';
    return rawColor + percentageString;
  });
  return 'color-mix(in ' + colorSpace + ',' + parts.join(',') + ')';
}

/**
 * Mix N colors in the sRGB color space using weighted averages.
 *
 * @param  {Array}  colors           Array of [r, g, b, a] color arrays.
 * @param  {Array}  weights          Array of weight values for each color.
 * @param  {number} alphaMultiplier  Multiplier for the final alpha channel.
 * @return {string}                  A hex color string.
 */
function mixNColorsSrgb (colors, weights, alphaMultiplier) {
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  for (let i = 0; i < colors.length; i++) {
    r += colors[i][0] * weights[i];
    g += colors[i][1] * weights[i];
    b += colors[i][2] * weights[i];
    alpha += colors[i][3] * weights[i];
  }
  return rgbaToHex(Math.round(r), Math.round(g), Math.round(b), alpha * alphaMultiplier);
}

/**
 * Mix N colors in the OKLab color space using weighted averages.
 *
 * @param  {Array}  colors           Array of [r, g, b, a] color arrays.
 * @param  {Array}  weights          Array of weight values for each color.
 * @param  {number} alphaMultiplier  Multiplier for the final alpha channel.
 * @return {string}                  A hex color string.
 */
function mixNColorsOklab (colors, weights, alphaMultiplier) {
  const oklabValues = colors.map((color) => {
    return rgbToOklab(color[0], color[1], color[2]);
  });
  let L = 0;
  let a = 0;
  let b = 0;
  let alpha = 0;
  for (let i = 0; i < oklabValues.length; i++) {
    L += oklabValues[i].L * weights[i];
    a += oklabValues[i].a * weights[i];
    b += oklabValues[i].b * weights[i];
    alpha += colors[i][3] * weights[i];
  }
  alpha *= alphaMultiplier;
  const rgb = oklabToRgb(L, a, b);
  return rgbaToHex(rgb[0], rgb[1], rgb[2], alpha >= 1 ? 1 : alpha);
}

/**
 * Evaluate a color-mix() expression. Returns a minified CSS color string or null.
 *
 * @param  {string}      expr  The full color-mix() expression string.
 * @return {string|null}       A minified CSS color string, or null if the expression cannot be evaluated.
 */
function evaluateColorMix (expr) {
  // Parse: color-mix(in <space> [<hue-method>], <color> [<p>%], <color> [<p>%])
  // We need to handle nested parentheses for inner color functions
  const inner = extractBalancedArgs(expr, 'color-mix');
  if (!inner) {
    return null;
  }

  // Parse the interpolation method
  const inMatch = inner.match(/^in\s+(srgb|oklch|oklab)(?:\s+shorter\s+hue)?\s*,\s*/i);
  if (!inMatch) {
    return null;
  }

  const colorSpace = inMatch[1].toLowerCase();
  const rest = inner.slice(inMatch[0].length);

  // Split color arguments (handling nested parens)
  const args = splitColorMixArgs(rest);
  if (args.length < 2) {
    return null;
  }

  // N-color path (3+ colors)
  if (args.length > 2) {
    return evaluateNColorMix(colorSpace, args);
  }

  // Parse each argument: "<color> [<percentage>]"
  const parsed1 = parseColorMixArg(args[0].trim());
  const parsed2 = parseColorMixArg(args[1].trim());
  if (!parsed1 || !parsed2) {
    return null;
  }

  // Check for unresolvable colors (var(), currentcolor, etc.)
  if (!parsed1.color || !parsed2.color) {
    // Can still do normalization but not computation
    return normalizeColorMix(colorSpace, parsed1, parsed2);
  }

  // Normalize percentages per CSS spec
  let p1 = parsed1.percentage;
  let p2 = parsed2.percentage;

  if (p1 === null && p2 === null) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === null) {
    p1 = 100 - p2;
  } else if (p2 === null) {
    p2 = 100 - p1;
  }

  let alphaMultiplier = 1;
  const pSum = p1 + p2;
  if (pSum === 0) {
    return null;
  }

  if (pSum < 100) {
    alphaMultiplier = pSum / 100;
  } else if (pSum > 100) {
    p1 = p1 / pSum * 100;
    p2 = p2 / pSum * 100;
  }

  // Trivial cases
  if (p1 === 0) {
    return rgbaToHex(parsed2.color[0], parsed2.color[1], parsed2.color[2], parsed2.color[3]);
  }
  if (p2 === 0) {
    return rgbaToHex(parsed1.color[0], parsed1.color[1], parsed1.color[2], parsed1.color[3]);
  }

  // CSS spec: 'none' channels are missing — fill from the other color before mixing
  const nones1 = findNoneChannels(parsed1.raw);
  const nones2 = findNoneChannels(parsed2.raw);
  for (const idx of nones1) {
    if (idx < parsed1.color.length) {
      parsed1.color[idx] = parsed2.color[idx];
    }
  }
  for (const idx of nones2) {
    if (idx < parsed2.color.length) {
      parsed2.color[idx] = parsed1.color[idx];
    }
  }

  const t1 = p1 / (p1 + p2);
  const t2 = p2 / (p1 + p2);
  const [r1, g1, b1, a1] = parsed1.color;
  const [r2, g2, b2, a2] = parsed2.color;

  if (colorSpace === 'srgb') {
    const r = Math.round(r1 * t1 + r2 * t2);
    const g = Math.round(g1 * t1 + g2 * t2);
    const b = Math.round(b1 * t1 + b2 * t2);
    const a = (a1 * t1 + a2 * t2) * alphaMultiplier;
    return rgbaToHex(r, g, b, a);
  }

  if (colorSpace === 'oklab') {
    const lab1 = rgbToOklab(r1, g1, b1);
    const lab2 = rgbToOklab(r2, g2, b2);
    const L = lab1.L * t1 + lab2.L * t2;
    const a = lab1.a * t1 + lab2.a * t2;
    const b = lab1.b * t1 + lab2.b * t2;
    const alpha = (a1 * t1 + a2 * t2) * alphaMultiplier;
    // Check if result fits in sRGB gamut
    const rgb = oklabToRgb(L, a, b);
    if (alpha >= 1) {
      return rgbaToHex(rgb[0], rgb[1], rgb[2], 1);
    }
    return rgbaToHex(rgb[0], rgb[1], rgb[2], alpha);
  }

  if (colorSpace === 'oklch') {
    const lch1 = rgbToOklch(r1, g1, b1);
    const lch2 = rgbToOklch(r2, g2, b2);
    const L = lch1.L * t1 + lch2.L * t2;
    const C = lch1.C * t1 + lch2.C * t2;
    const H = interpolateHueShorter(lch1.H, lch2.H, t2);
    const alpha = (a1 * t1 + a2 * t2) * alphaMultiplier;
    return formatOklch(L, C, H, alpha);
  }

  return null;
}

/**
 * Extract the balanced content inside a function call.
 *
 * @param  {string}      expr      The expression string containing the function call.
 * @param  {string}      funcName  The function name to locate (e.g. "color-mix").
 * @return {string|null}           The content between the matching parentheses, or null if not found.
 */
function extractBalancedArgs (expr, funcName) {
  const prefix = funcName + '(';
  const start = expr.indexOf(prefix);
  if (start === -1) {
    return null;
  }
  let depth = 1;
  let position = start + prefix.length;
  while (position < expr.length && depth > 0) {
    if (expr[position] === '(') {
      depth++;
    } else if (expr[position] === ')') {
      depth--;
    }
    position++;
  }
  return expr.slice(start + prefix.length, position - 1);
}

/**
 * Split color-mix arguments at top-level commas (handling nested parens).
 *
 * @param  {string} str  The color arguments string, with arguments separated by commas.
 * @return {Array}       An array of argument strings split at each top-level comma.
 */
function splitColorMixArgs (str) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let position = 0; position < str.length; position++) {
    if (str[position] === '(') {
      depth++;
    } else if (str[position] === ')') {
      depth--;
    } else if (str[position] === ',' && depth === 0) {
      args.push(str.slice(start, position));
      start = position + 1;
    }
  }
  args.push(str.slice(start));
  return args;
}

/**
 * Parse a single color-mix argument: "<color> [<percentage>]" or "<percentage> <color>".
 *
 * @param  {string}      arg  The color-mix argument string to parse.
 * @return {object|null}      An object with color (Array or null), percentage (number or null), raw (string), and hasVar (boolean), or null if unparseable.
 */
function parseColorMixArg (arg) {
  arg = arg.trim();

  // Try: percentage at end, e.g. "red 50%" or "rgb(0 0 0)50%"
  let match = arg.match(/^(.+?)\s*(\d+(?:\.\d+)?)%\s*$/);
  if (match) {
    const colorStr = match[1].trim();
    const percentage = parseFloat(match[2]);
    const color = parseColor(colorStr);
    // Check if color contains var() or currentcolor (cannot be evaluated statically)
    return { color, percentage, raw: colorStr, hasVar: /var\(|currentcolor/i.test(colorStr) };
  }

  // Try: percentage at start, e.g. "50% red"
  match = arg.match(/^(\d+(?:\.\d+)?)%\s+(.+)$/);
  if (match) {
    const colorStr = match[2].trim();
    const percentage = parseFloat(match[1]);
    const color = parseColor(colorStr);
    // Check if color contains var() or currentcolor (cannot be evaluated statically)
    return { color, percentage, raw: colorStr, hasVar: /var\(|currentcolor/i.test(colorStr) };
  }

  // No percentage
  const color = parseColor(arg);
  // Check if color contains var() or currentcolor (cannot be evaluated statically)
  return { color, percentage: null, raw: arg, hasVar: /var\(|currentcolor/i.test(arg) };
}

/**
 * Normalize a color-mix expression when we can't fully compute it.
 *
 * @param  {string} colorSpace  The interpolation color space ("srgb", "oklab", or "oklch").
 * @param  {object} parsed1     The parsed first color argument with color, percentage, and raw fields.
 * @param  {object} parsed2     The parsed second color argument with color, percentage, and raw fields.
 * @return {string}             A normalized color-mix() expression with default percentages and color space elided.
 */
function normalizeColorMix (colorSpace, parsed1, parsed2) {
  // Normalize percentages: strip explicit 50%/50% (the defaults)
  let p1Str = '';
  let p2Str = '';
  if (parsed1.percentage !== null && parsed1.percentage !== 50) {
    p1Str = ' ' + parsed1.percentage + '%';
  }
  if (parsed2.percentage !== null && parsed2.percentage !== 50) {
    p2Str = ' ' + parsed2.percentage + '%';
  }

  // Use the raw color strings (but try to minify known colors)
  let c1 = parsed1.raw;
  let c2 = parsed2.raw;
  if (parsed1.color) {
    c1 = rgbaToHex(parsed1.color[0], parsed1.color[1], parsed1.color[2], parsed1.color[3]);
  }
  if (parsed2.color) {
    c2 = rgbaToHex(parsed2.color[0], parsed2.color[1], parsed2.color[2], parsed2.color[3]);
  }

  // oklab is the default interpolation method per CSS Color 5 — elide it
  const spacePrefix = colorSpace === 'oklab' ? '' : 'in ' + colorSpace + ',';
  return 'color-mix(' + spacePrefix + c1 + p1Str + ',' + c2 + p2Str + ')';
}

/**
 * Convert a standalone oklab() value to hex if it fits in sRGB gamut; returns null if out-of-gamut.
 *
 * @param  {number}      L      The OKLab lightness component.
 * @param  {number}      a      The OKLab green-red axis component.
 * @param  {number}      b      The OKLab blue-yellow axis component.
 * @param  {number}      alpha  The alpha value from 0 to 1.
 * @return {string|null}        A hex color string, or null if the color is outside the sRGB gamut.
 */
function convertOklabToHex (L, a, b, alpha) {
  const linear = oklabToLinearSrgb(L, a, b);
  // Out-of-gamut check on unclamped linear sRGB channels
  if (linear.r < -0.002 || linear.r > 1.002 || linear.g < -0.002 || linear.g > 1.002 || linear.b < -0.002 || linear.b > 1.002) {
    return null;
  }
  const r = Math.round(delinearize(Math.max(0, Math.min(1, linear.r))) * 255);
  const g = Math.round(delinearize(Math.max(0, Math.min(1, linear.g))) * 255);
  const bl = Math.round(delinearize(Math.max(0, Math.min(1, linear.b))) * 255);
  return rgbaToHex(r, g, bl, alpha !== undefined ? alpha : 1);
}

/**
 * Handle color(from ...) relative color syntax for simple identity cases.
 *
 * @param  {string}      expr  The color(from ...) expression string.
 * @return {string|null}       A hex color string if the relative color is a simple identity transform, or null otherwise.
 */
function evaluateRelativeColor (expr) {
  // Match: color(from <base-color> srgb r g b [/ <alpha>]) identity transform pattern
  const match = expr.match(/^color\(\s*from\s+(.+?)\s+srgb\s+r\s+g\s+b(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (!match) {
    return null;
  }
  const baseColor = parseColor(match[1]);
  if (!baseColor) {
    return null;
  }
  const alpha = parseAlphaString(match[2], baseColor[3]);
  return rgbaToHex(baseColor[0], baseColor[1], baseColor[2], alpha);
}

export {
  hslToRgbChannels,
  rgbaToHex,
  hwbToRgbChannels,
  namedColors,
  parseColor,
  parseHex,
  evaluateColorMix,
  convertOklabToHex,
  evaluateRelativeColor,
  shortestColor,
  srgbToOklab,
  oklabToSrgb,
  oklabToOklch,
  oklchToOklab,
  rgbToOklab,
  rgbToOklch,
  oklabToRgb
};
