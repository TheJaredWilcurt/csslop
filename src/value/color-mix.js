/**
 * @file Evaluates CSS color-mix() expressions and normalizes them into compact color values.
 */

import {
  convertOklchToHex,
  oklabToRgb,
  parseColor,
  rgbToOklab,
  rgbToOklch,
  rgbaToHex
} from './colors.js';
import { roundCompactNumber } from './shared.js';

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
    // In-gamut results have an exact sRGB equivalent, which is always shorter than oklch()
    const hex = convertOklchToHex(L, C, H, alpha >= 1 ? 1 : alpha);
    if (hex) {
      return hex;
    }
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

export { evaluateColorMix };
