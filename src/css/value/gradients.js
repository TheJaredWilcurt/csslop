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
 * Optimizes gradient arguments by removing default direction or shape keywords and trimming redundant 0% or 100% stop positions from the first and last stops.
 *
 * @param  {string} func     The gradient function name (e.g. "linear-gradient").
 * @param  {string} argsStr  The raw comma-separated gradient arguments string.
 * @return {string}          The optimized gradient arguments string.
 */
function processGradientArgs (func, argsStr) {
  const args = splitGradientArgs(argsStr);
  const functionLower = func.toLowerCase();

  if (functionLower.includes('linear')) {
    if (args.length > 1) {
      const firstDirection = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
      if (firstDirection === 'to bottom' || firstDirection === '180deg') {
        args.shift();
      } else if (firstDirection === 'to top') {
        args[0] = '0deg';
      } else if (firstDirection === 'to right') {
        args[0] = '90deg';
      } else if (firstDirection === 'to left') {
        args[0] = '270deg';
      } else if (firstDirection === 'to top right' || firstDirection === 'to right top') {
        args[0] = '45deg';
      } else if (firstDirection === 'to bottom right' || firstDirection === 'to right bottom') {
        args[0] = '135deg';
      } else if (firstDirection === 'to bottom left' || firstDirection === 'to left bottom') {
        args[0] = '225deg';
      } else if (firstDirection === 'to top left' || firstDirection === 'to left top') {
        args[0] = '315deg';
      }
    }
  } else if (functionLower.includes('radial')) {
    if (args.length > 1) {
      const firstShape = args[0].toLowerCase().replace(/\s+/g, ' ').trim();
      if (firstShape === 'ellipse at center' || firstShape === 'circle at center') {
        args.shift();
      }
    }
  }

  if (args.length > 0) {
    args[0] = args[0].replace(/^(.*\S)\s+0%$/, '$1');
    args[args.length - 1] = args[args.length - 1].replace(/^(.*\S)\s+100%$/, '$1');
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
