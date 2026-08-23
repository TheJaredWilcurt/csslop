/**
 * @file Parses and minifies CSS gradient function calls by splitting arguments, normalizing default directions, and removing redundant stop positions.
 */

import {
  parseHex,
  shortestColor
} from './colors.js';

/**
 * Splits a gradient function's argument string at top-level commas, correctly handling nested parentheses.
 *
 * @param  {string} argumentString  The raw gradient arguments string.
 * @return {Array}                  An array of trimmed argument strings.
 */
function splitGradientArgs (argumentString) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of argumentString) {
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
    }
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim() || parts.length) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Checks whether a string is a valid gradient stop position consisting of one
 * or two numeric tokens with optional CSS units.
 *
 * @param  {string}  positionText  The potential stop position text.
 * @return {boolean}               Whether the text is a valid stop position.
 */
function isGradientStopPosition (positionText) {
  // Match one or two numeric stop-position tokens, such as `50%`, `10px`, or `0 50%`.
  return /^[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?(?:\s+[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?)?$/i.test(positionText);
}

/**
 * Splits a hex color stop that has an attached position with no separating
 * whitespace back into distinct color and position parts.
 *
 * @param  {string}      stop  The raw gradient stop text.
 * @return {object|null}       Parsed `color` and `position` parts, or null.
 */
function splitAttachedHexColorStop (stop) {
  if (!stop.startsWith('#')) {
    return null;
  }

  const hexLengths = [8, 6, 4, 3];
  for (const hexLength of hexLengths) {
    const colorLength = hexLength + 1;
    if (stop.length <= colorLength) {
      continue;
    }

    const colorCandidate = stop.slice(0, colorLength);
    const positionCandidate = stop.slice(colorLength).trim();
    const hexDigits = colorCandidate.slice(1);
    const isHexColor = hexDigits.length === hexLength && /^[0-9a-f]+$/i.test(hexDigits);
    if (!isHexColor || !isGradientStopPosition(positionCandidate)) {
      continue;
    }

    return {
      color: colorCandidate,
      position: positionCandidate
    };
  }

  return null;
}

/**
 * Splits a function-based color stop that has an attached position with no
 * separating whitespace back into distinct color and position parts.
 *
 * @param  {string}      stop  The raw gradient stop text.
 * @return {object|null}       Parsed `color` and `position` parts, or null.
 */
function splitAttachedFunctionColorStop (stop) {
  const lastCloseParenthesis = stop.lastIndexOf(')');
  if (lastCloseParenthesis === -1 || lastCloseParenthesis === stop.length - 1) {
    return null;
  }

  const colorCandidate = stop.slice(0, lastCloseParenthesis + 1).trim();
  const positionCandidate = stop.slice(lastCloseParenthesis + 1).trim();
  if (!isGradientStopPosition(positionCandidate)) {
    return null;
  }

  return {
    color: colorCandidate,
    position: positionCandidate
  };
}

/**
 * Normalizes a gradient stop color token to the same shortest representation
 * used by the general value minifier so equivalent adjacent stops can merge.
 *
 * @param  {string} colorToken  The parsed stop color token.
 * @return {string}             The normalized color token.
 */
function normalizeStopColorToken (colorToken) {
  if (!colorToken.startsWith('#')) {
    return colorToken;
  }

  const channels = parseHex(colorToken);
  if (!channels) {
    return colorToken;
  }

  return shortestColor(channels[0], channels[1], channels[2], channels[3]);
}

/**
 * Splits a gradient color stop into its color value and optional position.
 * The position is the trailing percentage/length token(s), while the color
 * is everything before it. Handles colors with parentheses like rgb() and hsl().
 *
 * @param  {string} stop  A single gradient color stop string (e.g. "red 50%").
 * @return {object}       An object with `color` and `position` string properties.
 */
function parseColorStop (stop) {
  const trimmed = stop.trim();
  
  // Check if the entire stop is a 4-digit hex color (with alpha) like #0000
  // These should not be split as they are complete colors
  if (/^#[0-9a-fA-F]{4}\b$/.test(trimmed)) {
    return {
      color: trimmed,
      position: null
    };
  }
  
  // Check if the entire stop is an 8-digit hex color (with alpha) like #00000000
  // These should not be split as they are complete colors
  if (/^#[0-9a-fA-F]{8}\b$/.test(trimmed)) {
    return {
      color: trimmed,
      position: null
    };
  }
  
  // Match a trailing position: one or two values that are numbers with optional units
  // like "50%", "10px", or "0". Captures the last position token(s) after the color.
  const positionMatch = trimmed.match(/^(.+?)\s+((?:\d+(?:\.\d+)?(?:%|[a-z]+)?\s*){1,2})$/i);
  if (positionMatch) {
    return {
      color: positionMatch[1].trim(),
      position: positionMatch[2].trim()
    };
  }
  const attachedHexStop = splitAttachedHexColorStop(trimmed);
  if (attachedHexStop) {
    return attachedHexStop;
  }
  const attachedFunctionStop = splitAttachedFunctionColorStop(trimmed);
  if (attachedFunctionStop) {
    return attachedFunctionStop;
  }
  return {
    color: trimmed,
    position: null
  };
}

/**
 * Splits a stop position into individual start and end tokens.
 *
 * @param  {string|null} position  The raw stop position text.
 * @return {Array}                 The normalized position tokens.
 */
function splitStopPositionTokens (position) {
  if (position === null) {
    return [];
  }

  return position.split(/\s+/).filter(Boolean);
}

/**
 * Serializes a color stop from its color and normalized position tokens.
 *
 * @param  {string} color           The normalized stop color.
 * @param  {Array}  positionTokens  The normalized stop positions.
 * @return {string}                 The serialized color stop.
 */
function serializeColorStop (color, positionTokens) {
  if (positionTokens.length === 0) {
    return color;
  }

  return color + ' ' + positionTokens.join(' ');
}

/**
 * Merges consecutive stops with the same color into a single logical stop.
 *
 * @param  {Array}  group  The adjacent parsed stops for one color.
 * @return {object}        The merged stop data.
 */
function mergeIdenticalStopGroup (group) {
  const firstStop = group[0];
  const lastStop = group[group.length - 1];
  const firstPositionTokens = splitStopPositionTokens(firstStop.position);
  const lastPositionTokens = splitStopPositionTokens(lastStop.position);

  let positionTokens;
  if (group.length === 1) {
    positionTokens = firstPositionTokens;
  } else {
    const mergedTokens = [];
    const startPosition = firstPositionTokens[0] || null;
    const endPosition = lastPositionTokens[lastPositionTokens.length - 1] || null;

    if (startPosition !== null) {
      mergedTokens.push(startPosition);
    }
    if (endPosition !== null && endPosition !== startPosition) {
      mergedTokens.push(endPosition);
    }

    positionTokens = mergedTokens;
  }

  return {
    color: firstStop.color,
    effectiveEndPosition: lastPositionTokens[lastPositionTokens.length - 1] || null,
    positionTokens
  };
}

/**
 * Removes implied edge positions and rewrites repeated starts as `0`.
 *
 * @param  {Array} mergedStops  The merged stops to normalize.
 * @return {Array}              The serialized normalized stops.
 */
function normalizeBoundaryPositionTokens (mergedStops) {
  const result = [];
  let previousEndPosition = null;

  for (let stopIndex = 0; stopIndex < mergedStops.length; stopIndex++) {
    const stop = mergedStops[stopIndex];
    const isFirstStop = stopIndex === 0;
    const isLastStop = stopIndex === mergedStops.length - 1;
    const positionTokens = [...stop.positionTokens];

    if (isFirstStop && positionTokens[0] === '0%') {
      positionTokens.shift();
    }
    if (isLastStop && positionTokens[positionTokens.length - 1] === '100%') {
      positionTokens.pop();
    }
    if (isLastStop && positionTokens.length === 1 && positionTokens[0] === '100%') {
      positionTokens.pop();
    }
    if (positionTokens.length > 0 && positionTokens[0] === previousEndPosition) {
      positionTokens[0] = '0';
    }

    previousEndPosition = stop.effectiveEndPosition;
    result.push(serializeColorStop(stop.color, positionTokens));
  }

  return result;
}

/**
 * Serializes a parsed gradient stop back into normalized CSS text, ensuring a
 * separating space is preserved when a stop position is present.
 *
 * @param  {string} stop  The raw gradient stop string.
 * @return {string}       The normalized gradient stop string.
 */
function normalizeColorStop (stop) {
  const parsedStop = parseColorStop(stop);
  const normalizedColor = normalizeStopColorToken(parsedStop.color);
  if (parsedStop.position === null) {
    return normalizedColor;
  }

  return normalizedColor + ' ' + parsedStop.position;
}

/**
 * Groups consecutive gradient stops that share the same color value into
 * arrays. Each group contains one or more stops with an identical color.
 *
 * @param  {Array} stops  An array of parsed stop objects with `color` and `position`.
 * @return {Array}        An array of groups, each being an array of stop objects with the same color.
 */
function groupConsecutiveIdenticalStops (stops) {
  const groups = [];
  let currentGroup = [stops[0]];
  for (let index = 1; index < stops.length; index++) {
    if (stops[index].color === currentGroup[0].color) {
      currentGroup.push(stops[index]);
    } else {
      groups.push(currentGroup);
      currentGroup = [stops[index]];
    }
  }
  groups.push(currentGroup);
  return groups;
}

/**
 * Combines groups of identical adjacent color stops into single stops with
 * merged position ranges. Also removes implied 0% at the start and 100%
 * at the end, and replaces a start position with unitless `0` when it
 * matches the previous group's end position.
 *
 * @param  {Array} args  The gradient stop strings (already split by comma).
 * @return {Array}       The optimized gradient stop strings.
 */
function combineAdjacentIdenticalStops (args) {
  const stops = args.map((arg) => {
    return parseColorStop(arg);
  });
  const hasPositions = stops.some((stop) => {
    return stop.position !== null;
  });
  if (!hasPositions) {
    return args;
  }

  const groups = groupConsecutiveIdenticalStops(stops);
  const mergedStops = groups.map((group) => {
    return mergeIdenticalStopGroup(group);
  });

  return normalizeBoundaryPositionTokens(mergedStops);
}

/**
 * The `to <side>` linear-gradient directions that are shorter to write as an
 * angle, keyed by the normalized keyword form. Corner directions are listed
 * under both keyword orders, since either spells the same corner.
 *
 * @type {Map<string, string>}
 */
const LINEAR_DIRECTION_ANGLES = new Map([
  ['to top', '0deg'],
  ['to right', '90deg'],
  ['to left', '270deg'],
  ['to top right', '45deg'],
  ['to right top', '45deg'],
  ['to bottom right', '135deg'],
  ['to right bottom', '135deg'],
  ['to bottom left', '225deg'],
  ['to left bottom', '225deg'],
  ['to top left', '315deg'],
  ['to left top', '315deg']
]);

/**
 * The linear-gradient directions that are already the default, so writing them
 * out adds nothing.
 *
 * @type {Set<string>}
 */
const DEFAULT_LINEAR_DIRECTIONS = new Set(['to bottom', '180deg']);

/**
 * The radial-gradient shapes that are already the default.
 *
 * @type {Set<string>}
 */
const DEFAULT_RADIAL_SHAPES = new Set(['ellipse at center', 'circle at center']);

/**
 * Rewrites the leading direction argument of a linear gradient into its
 * shortest form, dropping it when it is the default.
 *
 * @param  {Array}  args  The gradient arguments, rewritten in place.
 * @return {number}       The number of leading arguments that are not color stops.
 */
function normalizeLinearGradientDirection (args) {
  const firstDirection = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
  if (DEFAULT_LINEAR_DIRECTIONS.has(firstDirection)) {
    args.shift();
    return 0;
  }
  const angle = LINEAR_DIRECTION_ANGLES.get(firstDirection);
  if (angle) {
    args[0] = angle;
    return 1;
  }
  // Check if first arg looks like a direction (angle or "to ..." keyword)
  const looksLikeDirection = /^\d+(\.\d+)?deg$/i.test(firstDirection) || firstDirection.startsWith('to ');
  if (looksLikeDirection) {
    return 1;
  }
  return 0;
}

/**
 * Drops the leading shape argument of a radial gradient when it is the default.
 *
 * @param  {Array}  args  The gradient arguments, rewritten in place.
 * @return {number}       The number of leading arguments that are not color stops.
 */
function normalizeRadialGradientShape (args) {
  const firstShape = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
  if (DEFAULT_RADIAL_SHAPES.has(firstShape)) {
    args.shift();
    return 0;
  }
  // Check if first arg is a radial shape/size descriptor
  const looksLikeShape = /\b(circle|ellipse|closest|farthest|at)\b/i.test(firstShape);
  if (looksLikeShape) {
    return 1;
  }
  return 0;
}

/**
 * Optimizes gradient arguments by removing default direction or shape keywords, combining adjacent identical color stops, and trimming redundant 0% or 100% stop positions from the first and last stops.
 *
 * @param  {string} func     The gradient function name (e.g. "linear-gradient").
 * @param  {string} argsStr  The raw comma-separated gradient arguments string.
 * @return {string}          The optimized gradient arguments string.
 */
function processGradientArgs (func, argsStr) {
  const args = splitGradientArgs(argsStr);
  const functionLower = func.toLowerCase();

  let directionArgCount = 0;

  if (args.length > 1) {
    if (functionLower.includes('linear')) {
      directionArgCount = normalizeLinearGradientDirection(args);
    } else if (functionLower.includes('radial')) {
      directionArgCount = normalizeRadialGradientShape(args);
    }
  }

  // Extract color stop args (everything after the direction/shape argument)
  const colorStopArgs = args.slice(directionArgCount).map((arg) => {
    return normalizeColorStop(arg);
  });
  if (colorStopArgs.length > 0) {
    const normalizedStops = colorStopArgs.length >= 2 ?
      combineAdjacentIdenticalStops(colorStopArgs) :
      colorStopArgs;
    args.splice(directionArgCount, colorStopArgs.length, ...normalizedStops);
  }

  if (args.length > directionArgCount) {
    const firstStopIndex = directionArgCount;
    const lastStopIndex = args.length - 1;
    // Remove default 0% stop position from the first gradient stop
    args[firstStopIndex] = args[firstStopIndex].replace(/^(.*\S)\s+0%$/, '$1');
    // Remove default 100% stop position from the last gradient stop
    args[lastStopIndex] = args[lastStopIndex].replace(/^(.*\S)\s+100%$/, '$1');
  }

  return args.join(',');
}

/**
 * Finds and minifies all gradient function calls within a CSS value string, applying argument optimization to each one.
 *
 * @param  {string} value  The CSS value string potentially containing gradient functions.
 * @return {string}        The value string with all gradient calls minified.
 */
function minifyGradients (value) {
  let result = '';
  let position = 0;
  while (position < value.length) {
    const rest = value.slice(position);
    // Match gradient function names: linear-gradient, radial-gradient, conic-gradient, and their repeating- variants
    const gradientMatch = rest.match(/^((?:repeating-)?(?:linear|radial|conic)-gradient)\(/i);
    if (gradientMatch) {
      const func = gradientMatch[1];
      let depth = 1;
      let end = position + func.length + 1;
      while (end < value.length && depth > 0) {
        if (value[end] === '(') {
          depth++;
        } else if (value[end] === ')') {
          depth--;
        }
        end++;
      }
      const argsStr = value.slice(position + func.length + 1, end - 1);
      result += func + '(' + processGradientArgs(func, argsStr) + ')';
      position = end;
    } else {
      result += value[position];
      position++;
    }
  }
  return result;
}

export { minifyGradients };
