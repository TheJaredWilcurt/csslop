/**
 * @file Parses and minifies CSS gradient function calls by splitting arguments, normalizing default directions, and removing redundant stop positions.
 */

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
  return {
    color: trimmed,
    position: null
  };
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
  const colorStopArgs = args.slice(directionArgCount);
  if (colorStopArgs.length >= 2) {
    const combinedStops = combineAdjacentIdenticalStops(colorStopArgs);
    args.splice(directionArgCount, colorStopArgs.length, ...combinedStops);
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
