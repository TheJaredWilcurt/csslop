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
  const hasMergeableGroup = groups.some((group) => {
    return group.length > 1;
  });
  if (!hasMergeableGroup) {
    return args;
  }

  const result = [];
  let previousEndPosition = null;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    const color = group[0].color;
    const isFirstGroup = groupIndex === 0;
    const isLastGroup = groupIndex === groups.length - 1;

    if (group.length === 1) {
      let position = group[0].position;
      if (position === '0%' && isFirstGroup) {
        position = null;
      }
      if (position === '100%' && isLastGroup) {
        position = null;
      }
      if (position !== null && position === previousEndPosition) {
        position = '0';
      }
      previousEndPosition = group[0].position;
      result.push(position ? color + ' ' + position : color);
      continue;
    }

    const firstPosition = group[0].position;
    const lastPosition = group[group.length - 1].position;

    let startPart = firstPosition;
    let endPart = lastPosition;

    if (startPart === '0%' && isFirstGroup) {
      startPart = null;
    }
    if (endPart === '100%' && isLastGroup) {
      endPart = null;
    }
    if (startPart !== null && startPart === previousEndPosition) {
      startPart = '0';
    }

    previousEndPosition = lastPosition;

    const positionParts = [startPart, endPart].filter((part) => {
      return part !== null;
    });
    if (positionParts.length > 0) {
      result.push(color + ' ' + positionParts.join(' '));
    } else {
      result.push(color);
    }
  }

  return result;
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

  if (functionLower.includes('linear')) {
    if (args.length > 1) {
      const firstDirection = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
      if (firstDirection === 'to bottom' || firstDirection === '180deg') {
        args.shift();
      } else if (firstDirection === 'to top') {
        args[0] = '0deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to right') {
        args[0] = '90deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to left') {
        args[0] = '270deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to top right' || firstDirection === 'to right top') {
        args[0] = '45deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to bottom right' || firstDirection === 'to right bottom') {
        args[0] = '135deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to bottom left' || firstDirection === 'to left bottom') {
        args[0] = '225deg';
        directionArgCount = 1;
      } else if (firstDirection === 'to top left' || firstDirection === 'to left top') {
        args[0] = '315deg';
        directionArgCount = 1;
      } else {
        // Check if first arg looks like a direction (angle or "to ..." keyword)
        const looksLikeDirection = /^\d+(\.\d+)?deg$/i.test(firstDirection) || firstDirection.startsWith('to ');
        if (looksLikeDirection) {
          directionArgCount = 1;
        }
      }
    }
  } else if (functionLower.includes('radial')) {
    if (args.length > 1) {
      const firstShape = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
      if (firstShape === 'ellipse at center' || firstShape === 'circle at center') {
        args.shift();
      } else {
        // Check if first arg is a radial shape/size descriptor
        const looksLikeShape = /\b(circle|ellipse|closest|farthest|at)\b/i.test(firstShape);
        if (looksLikeShape) {
          directionArgCount = 1;
        }
      }
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
