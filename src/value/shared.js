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
  // Strip the zeros trailing the fraction, then the decimal point they leave
  // behind. Only zeros written after a decimal point are droppable, so the
  // match has to start at one: the zeros of a whole number are digits.
  let result = number.toFixed(precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (result.startsWith('0.')) {
    result = result.slice(1);
  }
  if (result.startsWith('-0.')) {
    result = '-' + result.slice(2);
  }
  return result;
}

/**
 * The most characters the result of a resolved calculation is written with,
 * counting the digits and the decimal point but not the sign. A calculation is
 * only replaced by its result to save characters, and a result that repeats
 * can always be written out longer, so its digits are cut off where the
 * accuracy they add stops paying for the characters they cost.
 *
 * @type {number}
 */
const MAXIMUM_RESOLVED_NUMBER_CHARACTERS = 7;

/**
 * Formats what a calculation resolved to as the number a stylesheet states it
 * with: rounded to however many decimal places are left over once the whole
 * part and the decimal point have taken their share of the character budget a
 * resolved number is written within.
 *
 * @param  {number|string} value              The number the calculation resolved to.
 * @param  {number}        maximumCharacters  The most characters the written number may take.
 * @return {string}                           The number as it is written into the stylesheet.
 */
function formatResolvedNumber (value, maximumCharacters = MAXIMUM_RESOLVED_NUMBER_CHARACTERS) {
  const number = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  const wholePart = Math.floor(Math.abs(number));
  // A magnitude below one is written without its leading zero, so nothing of
  // its whole part is spent from the budget
  let wholeDigitCount = 0;
  if (wholePart !== 0) {
    wholeDigitCount = String(wholePart).length;
  }
  // The decimal point itself takes one of the characters the digits could have
  const decimalPlaces = Math.max(maximumCharacters - wholeDigitCount - 1, 0);
  return roundCompactNumber(number, decimalPlaces);
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
 * Formats what a calculation resolved to as the dimension a stylesheet states
 * it with, rounding the number into the character budget a resolved number is
 * written within.
 *
 * @param  {number} value  The numeric result of the calculation.
 * @param  {string} unit   The CSS unit suffix the result carries (e.g. "px", "%").
 * @return {string}        The dimension as it is written into the stylesheet.
 */
function formatResolvedDimension (value, unit) {
  return formatResolvedNumber(value) + unit;
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
 * Conversion factors from each CSS angle unit to degrees.
 *
 * @type {{[key: string]: number}}
 */
const ANGLE_UNIT_TO_DEGREES = {
  deg: 1,
  grad: 360 / 400,
  rad: 180 / Math.PI,
  turn: 360
};

/**
 * Parses a CSS angle token (e.g. "90", "90deg", ".25turn") into degrees.
 * Unitless values are treated as degrees, per the CSS Color specification's
 * handling of hue components.
 *
 * @param  {string}      angleToken  The angle token, with or without a unit suffix.
 * @return {number|null}             The angle in degrees, or null if the token is not a valid angle.
 */
function parseAngleToDegrees (angleToken) {
  // Capture the numeric portion and an optional CSS angle unit suffix
  const match = String(angleToken).trim().match(/^(-?(?:\d+|\d*\.\d+))(deg|grad|rad|turn)?$/i);
  if (!match) {
    return null;
  }
  const unit = match[2] ? match[2].toLowerCase() : 'deg';
  return parseFloat(match[1]) * ANGLE_UNIT_TO_DEGREES[unit];
}

/**
 * The substitution functions whose result is only known at computed-value time.
 * Each of them may stand in for any number of components, so a shorthand part
 * that holds one cannot be counted as the single value it looks like.
 *
 * @type {RegExp}
 */
const SUBSTITUTION_FUNCTION_PATTERN = /\b(?:var|env|attr|if)\(/i;

/**
 * Reports whether a shorthand part stands in for an unknown number of
 * components. `margin: 1px 1px` reduces to `margin: 1px`, but the same
 * reduction across two `var()` references is unsafe: a custom property that
 * expands to two values makes the doubled form a valid four-component margin,
 * while the reduced form is a two-component one.
 *
 * @param  {Array}   parts  The shorthand value strings to test.
 * @return {boolean}        Whether any part substitutes a value of unknown length.
 */
function hasSubstitutedParts (parts) {
  return parts.some((part) => {
    return SUBSTITUTION_FUNCTION_PATTERN.test(part);
  });
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
  if (hasSubstitutedParts(parts)) {
    return parts;
  }
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
  formatResolvedDimension,
  formatResolvedNumber,
  hasSubstitutedParts,
  normalizeScaleComponent,
  parseAlphaString,
  parseAngleToDegrees,
  roundCompactNumber
};
