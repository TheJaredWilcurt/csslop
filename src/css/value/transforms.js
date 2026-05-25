/**
 * @file Minifies CSS transform values by simplifying individual transform functions, collapsing axes, and removing identity components.
 */

import {
  normalizeScaleComponent,
  roundCompactNumber
} from './shared.js';

/**
 * Checks if a transform function argument represents a zero value, regardless of what CSS unit is attached.
 *
 * @param  {string}  value  The transform argument string to test.
 * @return {boolean}        True if the value is zero with any unit.
 */
function isZeroTransformValue (value) {
  return /^[-+]?0(?:[a-z%]+)?$/i.test(value.trim());
}

/**
 * Splits a CSS function's comma-separated argument string into an array, correctly handling nested parentheses.
 *
 * @param  {string} value  The raw arguments string inside the function parentheses.
 * @return {Array}         An array of trimmed argument strings.
 */
function splitFunctionArguments (value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') {
      depth++;
    }
    if (character === ')') {
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
 * Parses a CSS transform value string into an array of objects, each containing a function name and its raw arguments string.
 *
 * @param  {string}     value  The full CSS transform value string.
 * @return {Array|null}        An array of { name, args } objects, or null if the string cannot be parsed.
 */
function splitTransformFunctions (value) {
  const parts = [];
  let position = 0;
  while (position < value.length) {
    while (position < value.length && /\s/.test(value[position])) {
      position++;
    }
    if (position >= value.length) {
      break;
    }
    const nameStart = position;
    while (position < value.length && /[A-Za-z0-9-]/.test(value[position])) {
      position++;
    }
    if (nameStart === position || value[position] !== '(') {
      return null;
    }
    const name = value.slice(nameStart, position);
    let depth = 1;
    let end = position + 1;
    while (end < value.length && depth > 0) {
      if (value[end] === '(') {
        depth++;
      }
      if (value[end] === ')') {
        depth--;
      }
      end++;
    }
    if (depth !== 0) {
      return null;
    }
    parts.push({ name, args: value.slice(position + 1, end - 1) });
    position = end;
  }
  return parts;
}

/**
 * Minifies a single CSS transform function by simplifying 3D functions to 2D equivalents, collapsing redundant axes, and normalizing scale percentages.
 *
 * @param  {string} name  The transform function name (e.g. "translate3d", "scale").
 * @param  {string} args  The raw comma-separated arguments string.
 * @return {string}       The minified transform function call string.
 */
function minifyTransformFunction (name, args) {
  const lowerName = name.toLowerCase();
  const parts = splitFunctionArguments(args);

  if (lowerName === 'rotate' && parts.length === 1) {
    // Convert turn units to degrees (e.g. 0.5turn → 180deg)
    const angle = parts[0].replace(/^(-?(?:\d+|\d*\.\d+))turn$/i, (_, turns) => {
      return roundCompactNumber(parseFloat(turns) * 360) + 'deg';
    });
    return 'rotate(' + angle + ')';
  }

  if (lowerName === 'translate3d' && parts.length === 3) {
    const [x, y, z] = parts;
    if (isZeroTransformValue(y) && isZeroTransformValue(z)) {
      return 'translate(' + x + ')';
    }
    if (isZeroTransformValue(x) && isZeroTransformValue(z)) {
      return 'translateY(' + y + ')';
    }
    if (isZeroTransformValue(x) && isZeroTransformValue(y)) {
      return 'translateZ(' + z + ')';
    }
    return name + '(' + parts.join(',') + ')';
  }

  if (lowerName === 'translate' && parts.length === 2) {
    const [x, y] = parts;
    if (isZeroTransformValue(x)) {
      return 'translateY(' + y + ')';
    }
    if (isZeroTransformValue(y)) {
      return 'translate(' + x + ')';
    }
    return name + '(' + parts.join(',') + ')';
  }

  if (lowerName === 'scale') {
    const normalized = parts.map(normalizeScaleComponent);
    if (normalized.length === 1) {
      return 'scale(' + normalized[0] + ')';
    }
    if (normalized.length === 2) {
      const [x, y] = normalized;
      if (x === y) {
        return 'scale(' + x + ')';
      }
      if (y === '1') {
        return 'scaleX(' + x + ')';
      }
      if (x === '1') {
        return 'scaleY(' + y + ')';
      }
      return 'scale(' + normalized.join(',') + ')';
    }
  }

  if (lowerName === 'scale3d' && parts.length === 3) {
    const normalized = parts.map(normalizeScaleComponent);
    const [x, y, z] = normalized;
    if (z === '1') {
      return minifyTransformFunction('scale', x + ',' + y);
    }
    if (y === '1' && z === '1') {
      return 'scaleX(' + x + ')';
    }
    if (x === '1' && z === '1') {
      return 'scaleY(' + y + ')';
    }
    if (x === '1' && y === '1') {
      return 'scaleZ(' + z + ')';
    }
    return 'scale3d(' + normalized.join(',') + ')';
  }

  if (lowerName === 'rotatez' && parts.length === 1) {
    return 'rotate(' + parts[0] + ')';
  }

  if (lowerName === 'rotate3d' && parts.length === 4) {
    const [x, y, z, angle] = parts;
    if (x === '1' && y === '0' && z === '0') {
      return 'rotateX(' + angle + ')';
    }
    if (x === '0' && y === '1' && z === '0') {
      return 'rotateY(' + angle + ')';
    }
    if (x === '0' && y === '0' && z === '1') {
      return 'rotate(' + angle + ')';
    }
    return name + '(' + parts.join(',') + ')';
  }

  if (lowerName.startsWith('scale')) {
    return name + '(' + parts.map(normalizeScaleComponent).join(',') + ')';
  }

  return name + '(' + parts.join(',') + ')';
}

/**
 * Minifies an entire CSS transform value by parsing each function call and applying per-function optimizations.
 *
 * @param  {string} value  The full CSS transform value string.
 * @return {string}        The minified transform value, or the original value if parsing fails.
 */
function minifyTransformValue (value) {
  if (!value || value === 'none') {
    return value;
  }
  const functions = splitTransformFunctions(value);
  if (!functions) {
    return value;
  }
  return functions.map(({ name, args }) => {
    return minifyTransformFunction(name, args);
  }).join(' ');
}

export { minifyTransformValue };
