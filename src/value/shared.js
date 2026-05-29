/**
 * @file Shared numeric formatting and unit conversion utilities used across CSS value minification.
 */

/**
 * Formats a number as a compact string, stripping leading zeros before decimal points (e.g. 0.5 becomes .5).
 *
 * @param  {number|string} value  The numeric value to format.
 * @return {string}               The compact string representation.
 */
function formatCompactNumber (value) {
  let result = String(Number(value));
  if (result.startsWith('0.')) {
    result = result.slice(1);
  }
  if (result.startsWith('-0.')) {
    result = '-' + result.slice(2);
  }
  return result;
}

/**
 * Converts a percentage scale component to its decimal equivalent (e.g. "150%" becomes "1.5"), or returns the value unchanged if it is not a percentage.
 *
 * @param  {string} value  The scale component string, possibly ending in %.
 * @return {string}        The normalized decimal string.
 */
function normalizeScaleComponent (value) {
  const trimmed = value.trim();
  // Match a percentage value (e.g. "150%", "-50%") and capture the numeric portion
  const percentMatch = trimmed.match(/^(-?(?:\d+|\d*\.\d+))%$/);
  if (!percentMatch) {
    return trimmed;
  }
  return formatCompactNumber(parseFloat(percentMatch[1]) / 100);
}

/**
 * Rounds a number to the given decimal precision and formats it compactly, removing trailing zeros and leading zeros before the decimal point.
 *
 * @param  {number|string} value      The numeric value to round and format.
 * @param  {number}        precision  The number of decimal places to keep.
 * @return {string}                   The rounded and compact string representation.
 */
function roundCompactNumber (value, precision = 3) {
  const number = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  // Strip trailing zeros and trailing decimal point from the fixed-precision string
  let result = number.toFixed(precision).replace(/0+$/, '').replace(/\.$/, '');
  if (result.startsWith('0.')) {
    result = result.slice(1);
  }
  if (result.startsWith('-0.')) {
    result = '-' + result.slice(2);
  }
  return result;
}

/**
 * Converts an absolute CSS length value (pt, pc, in, cm, mm, q) to its pixel equivalent using standard conversion factors.
 *
 * @param  {number|string} value  The numeric length value to convert.
 * @param  {string}        unit   The CSS length unit (e.g. "pt", "in", "cm").
 * @return {number|null}          The pixel equivalent, or null if the unit is unrecognized or the value is not finite.
 */
function convertAbsoluteLengthToPx (value, unit) {
  const numeric = typeof value === 'number' ? value : parseFloat(value);
  const conversionMap = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6
  };
  const factor = conversionMap[unit.toLowerCase()];
  if (!factor || !Number.isFinite(numeric)) {
    return null;
  }
  return numeric * factor;
}

/**
 * Formats a numeric value with its CSS unit as a compact string, rounding to the specified precision.
 *
 * @param  {number} value      The numeric dimension value.
 * @param  {string} unit       The CSS unit suffix (e.g. "px", "%").
 * @param  {number} precision  The number of decimal places to keep.
 * @return {string}            The formatted dimension string.
 */
function formatDimension (value, unit, precision = 3) {
  return roundCompactNumber(value, precision) + unit;
}

/**
 * Parses a CSS alpha string (e.g. "0.5", "50%") into a numeric 0–1 value.
 * If the string is undefined or null, returns the provided fallback.
 *
 * @param  {string|undefined} alphaStr  The alpha string, optionally ending in "%".
 * @param  {number}           fallback  The value to return when alphaStr is absent.
 * @return {number}                     The parsed alpha value in the 0–1 range.
 */
function parseAlphaString (alphaStr, fallback = 1) {
  if (alphaStr === undefined || alphaStr === null) {
    return fallback;
  }
  if (alphaStr.endsWith('%')) {
    return parseFloat(alphaStr) / 100;
  }
  return parseFloat(alphaStr);
}

/**
 * Collapses redundant CSS shorthand parts using the standard box-model
 * reduction rules: 4-value → 3-value → 2-value → 1-value.
 *
 * For example, `["10px", "5px", "10px", "5px"]` becomes `["10px", "5px"]`.
 *
 * @param  {Array} parts  The array of shorthand value strings to collapse in place.
 * @return {Array}        The same array, mutated with redundant entries removed.
 */
function collapseShorthandParts (parts) {
  if (parts.length === 4 && parts[1] === parts[3]) {
    parts.splice(3, 1);
  }
  if (parts.length === 3 && parts[0] === parts[2]) {
    parts.splice(2, 1);
  }
  if (parts.length === 2 && parts[0] === parts[1]) {
    parts.splice(1, 1);
  }
  return parts;
}

export {
  collapseShorthandParts,
  convertAbsoluteLengthToPx,
  formatCompactNumber,
  formatDimension,
  normalizeScaleComponent,
  parseAlphaString,
  roundCompactNumber
};
