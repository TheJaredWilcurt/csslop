/**
 * @file Reads the numbers of numeric CSS tokens as exact digits and an exponent, so they can be rewritten in their shortest decimal or scientific spelling without any floating point rounding.
 */

/**
 * A number taken apart into the pieces its spelling is built from. The digits
 * never start or end with a zero, so the same value always has the same parts.
 *
 * @typedef  {object}  NumericParts
 * @property {string}  sign          The sign as written, kept so a `+` that tells the number apart from a neighboring token survives, or an empty string for zero.
 * @property {string}  digits        The significant digits, or an empty string for zero.
 * @property {number}  exponent      The power of ten the digits, read as an integer, are multiplied by.
 * @property {string}  unit          The unit or percent sign that follows the number.
 * @property {boolean} hasExponent   Whether the original spelling used scientific notation.
 */

/**
 * Matches the text of a numeric token, capturing its sign, its coefficient,
 * the exponent of its scientific notation when it has one, and the unit or
 * percent sign written after it. An exponent needs digits after the `e`, so the
 * `e` that starts a unit such as `em` is left to the unit.
 *
 * @type {RegExp}
 */
const NUMERIC_TOKEN_PATTERN = /^([+-]?)(\d*\.\d+|\d+)(?:[eE]([+-]?\d+))?(%|[a-zA-Z_-][\w-]*)?$/;

/**
 * Takes the text of a numeric token apart into its sign, significant digits,
 * exponent, and unit.
 *
 * @param  {string}            text  The text of a number, percentage, or dimension token.
 * @return {NumericParts|null}       The parts of the number, or null when the text is not a plain number.
 */
function parseNumericParts (text) {
  const match = text.match(NUMERIC_TOKEN_PATTERN);
  if (!match) {
    return null;
  }
  const [, sign, coefficient, writtenExponent, unit = ''] = match;
  const decimalIndex = coefficient.indexOf('.');
  const fractionalDigitCount = decimalIndex === -1 ? 0 : coefficient.length - decimalIndex - 1;
  // Leading zeros carry no magnitude, so only the digits after them count
  const unpaddedDigits = coefficient.replace('.', '').replace(/^0+/, '');
  // Trailing zeros only scale the digits before them, so they move into the exponent
  const digits = unpaddedDigits.replace(/0+$/, '');
  const trailingZeroCount = unpaddedDigits.length - digits.length;
  return {
    sign: digits ? sign : '',
    digits,
    exponent: Number(writtenExponent || 0) + trailingZeroCount - fractionalDigitCount,
    unit,
    hasExponent: writtenExponent !== undefined
  };
}

/**
 * Spells a number out in plain decimal notation, without a leading zero before
 * its decimal point.
 *
 * @param  {NumericParts} parts  The parts of a non-zero number.
 * @return {string}              The decimal spelling, without the unit.
 */
function formatDecimal (parts) {
  const { sign, digits, exponent } = parts;
  if (exponent >= 0) {
    return sign + digits + '0'.repeat(exponent);
  }
  const decimalIndex = digits.length + exponent;
  if (decimalIndex > 0) {
    return sign + digits.slice(0, decimalIndex) + '.' + digits.slice(decimalIndex);
  }
  return sign + '.' + '0'.repeat(-decimalIndex) + digits;
}

/**
 * Spells a number out in scientific notation, keeping every significant digit
 * in an integer mantissa so no decimal point is ever needed.
 *
 * @param  {NumericParts} parts  The parts of a non-zero number.
 * @return {string}              The scientific spelling, without the unit.
 */
function formatScientific (parts) {
  if (parts.exponent === 0) {
    return parts.sign + parts.digits;
  }
  return parts.sign + parts.digits + 'e' + parts.exponent;
}

/**
 * Spells a number in the shortest way its grammar allows. Plain decimal
 * notation wins a tie, since it is the more familiar spelling.
 *
 * @param  {NumericParts} parts             The parts of a non-zero number.
 * @param  {boolean}      allowsScientific  Whether the number may be written in scientific notation.
 * @return {string}                         The shortest spelling, unit included.
 */
function formatShortestNumber (parts, allowsScientific) {
  const decimal = formatDecimal(parts);
  if (!allowsScientific) {
    return decimal + parts.unit;
  }
  const scientific = formatScientific(parts);
  const shortest = scientific.length < decimal.length ? scientific : decimal;
  return shortest + parts.unit;
}

/**
 * Rewrites the text of a numeric token in its shortest spelling. A number
 * written without an exponent only changes when the new spelling is shorter,
 * while one written with an exponent is always normalized, which lowercases
 * the `e`, drops a `+` sign, and folds trailing zeros into the exponent.
 *
 * @param  {string}  text              The text of a number, percentage, or dimension token.
 * @param  {boolean} allowsScientific  Whether the number may be written in scientific notation.
 * @return {string}                    The shortest equivalent text.
 */
function shortenNumericText (text, allowsScientific) {
  const parts = parseNumericParts(text);
  if (!parts || !parts.digits) {
    return text;
  }
  if (parts.hasExponent && !allowsScientific) {
    return text;
  }
  const shortest = formatShortestNumber(parts, allowsScientific);
  if (parts.hasExponent || shortest.length < text.length) {
    return shortest;
  }
  return text;
}

/**
 * Scales a number by a power of ten by moving its exponent, which is exact for
 * any number of digits.
 *
 * @param  {NumericParts} parts  The parts of the number.
 * @param  {number}       power  The power of ten to multiply by.
 * @param  {string}       unit   The unit the scaled number is written with.
 * @return {NumericParts}        The parts of the scaled number.
 */
function scaleByPowerOfTen (parts, power, unit) {
  return {
    ...parts,
    exponent: parts.exponent + power,
    unit
  };
}

export {
  formatShortestNumber,
  parseNumericParts,
  scaleByPowerOfTen,
  shortenNumericText
};
