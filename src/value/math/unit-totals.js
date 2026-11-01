/**
 * @file Represents the value of a CSS calculation as totals keyed by unit, and works out the sums, products, and quotients of such values.
 */

import { convertAbsoluteLengthToPx } from '../shared.js';

/**
 * The unit a plain number is totalled under. A number carries no unit, and the
 * empty string is the unit it does not carry.
 *
 * @type {string}
 */
const UNITLESS = '';

/**
 * The unit a percentage is totalled under. A percentage is only resolved
 * against its basis once the element is laid out, so it is totalled as a unit
 * of its own rather than as the number it is written from.
 *
 * @type {string}
 */
const PERCENTAGE = '%';

/**
 * Creates the totals of a value that states a single quantity, holding the
 * number it is written from under the unit it is written with. An absolute
 * length is held as the pixels it measures, since every length stating the
 * same measurement then totals under the same unit.
 *
 * @param  {number}  number                   The number the quantity is written from.
 * @param  {string}  unit                     The unit the quantity is written with, or the empty string when it is a plain number.
 * @param  {boolean} preserveWrittenQuantity  Whether to retain the original spelling for a standalone quantity.
 * @return {Map}                              The unit totals the quantity states.
 */
function createUnitTotals (number, unit, preserveWrittenQuantity = false) {
  const lowercasedUnit = unit.toLowerCase();
  const pixels = convertAbsoluteLengthToPx(number, lowercasedUnit);
  let totals;
  if (pixels === null) {
    totals = new Map([[lowercasedUnit, number]]);
  } else {
    totals = new Map([['px', pixels]]);
  }
  if (preserveWrittenQuantity) {
    totals.writtenQuantity = {
      number,
      unit: lowercasedUnit,
      canonicalUnit: pixels === null ? lowercasedUnit : 'px',
      canonicalNumber: pixels === null ? number : pixels
    };
  }
  return totals;
}

/**
 * Reports whether a value states a plain number, which is what an operand has
 * to be to scale or divide the quantity it is written against.
 *
 * @param  {Map}     value  The unit totals the value holds.
 * @return {boolean}        Whether the value states a plain number.
 */
function isPlainNumber (value) {
  return value.size === 1 && value.has(UNITLESS);
}

/**
 * Reads a value as the single quantity it states, which is what a function
 * comparing its arguments needs each of them to be. A value totalling more
 * than one unit is only resolved once its units are resolved against the
 * element, so it states no single number to read.
 *
 * @param  {Map}         value  The unit totals the value holds.
 * @return {object|null}        The number and the unit the value states, or null when it states more than one quantity.
 */
function readSingleQuantity (value) {
  if (value.size !== 1) {
    return null;
  }
  const [[unit, number]] = [...value];
  return { number, unit };
}

/**
 * Scales every quantity a value states by a plain number, which is how a
 * multiplication and a division are worked out.
 *
 * @param  {Map}    value   The unit totals the value holds.
 * @param  {number} factor  The number every total is scaled by.
 * @return {Map}            The scaled unit totals.
 */
function scaleUnitTotals (value, factor) {
  const scaled = new Map();
  for (const [unit, coefficient] of value) {
    scaled.set(unit, coefficient * factor);
  }
  return scaled;
}

/**
 * Adds one value to another, totalling the quantities they state under the
 * units they are written with. A sum of a plain number and a quantity carrying
 * a unit states nothing a stylesheet can hold, so such a sum has no total to
 * give.
 *
 * @param  {Map}      left   The unit totals the value on the left holds.
 * @param  {Map}      right  The unit totals the value on the right holds.
 * @param  {number}   sign   The direction the right value is added in: 1 to add it, -1 to subtract it.
 * @return {Map|null}        The totals of the sum, or null when the two cannot be added.
 */
function addUnitTotals (left, right, sign) {
  const totals = new Map(left);
  for (const [unit, coefficient] of right) {
    totals.set(unit, (totals.get(unit) || 0) + (coefficient * sign));
  }
  const addsNumberToQuantity = totals.has(UNITLESS) && totals.size > 1;
  if (addsNumberToQuantity) {
    return null;
  }
  return totals;
}

/**
 * Multiplies two values, which CSS only allows when one of them is a plain
 * number: the product of two quantities carrying units measures an area or a
 * rate, and no CSS property takes one.
 *
 * @param  {Map}      left   The unit totals the value on the left holds.
 * @param  {Map}      right  The unit totals the value on the right holds.
 * @return {Map|null}        The totals of the product, or null when neither side is a plain number.
 */
function multiplyUnitTotals (left, right) {
  if (isPlainNumber(right)) {
    return scaleUnitTotals(left, right.get(UNITLESS));
  }
  if (isPlainNumber(left)) {
    return scaleUnitTotals(right, left.get(UNITLESS));
  }
  const leftQuantity = readSingleQuantity(left);
  const rightQuantity = readSingleQuantity(right);
  if (leftQuantity && rightQuantity) {
    if (leftQuantity.unit.startsWith('reciprocal:') && leftQuantity.unit.slice('reciprocal:'.length) === rightQuantity.unit) {
      return createUnitTotals(leftQuantity.number * rightQuantity.number, UNITLESS);
    }
    if (rightQuantity.unit.startsWith('reciprocal:') && rightQuantity.unit.slice('reciprocal:'.length) === leftQuantity.unit) {
      return createUnitTotals(leftQuantity.number * rightQuantity.number, UNITLESS);
    }
  }
  return null;
}

/**
 * Divides a value by another, which CSS only allows when the divisor is a
 * plain number. A division by zero resolves to an infinity that no property
 * takes, so it is left for the stylesheet to state as written.
 *
 * @param  {Map}      left   The unit totals of the value being divided.
 * @param  {Map}      right  The unit totals of the value dividing it.
 * @return {Map|null}        The totals of the quotient, or null when the division cannot be worked out.
 */
function divideUnitTotals (left, right) {
  if (isPlainNumber(right)) {
    const divisor = right.get(UNITLESS);
    if (divisor === 0) {
      return null;
    }
    return scaleUnitTotals(left, 1 / divisor);
  }
  const dividendQuantity = readSingleQuantity(left);
  const divisorQuantity = readSingleQuantity(right);
  if (!dividendQuantity || !divisorQuantity || divisorQuantity.number === 0) {
    return null;
  }
  if (dividendQuantity.unit === divisorQuantity.unit) {
    return createUnitTotals(dividendQuantity.number / divisorQuantity.number, UNITLESS);
  }
  if (dividendQuantity.unit === UNITLESS) {
    return createUnitTotals(
      dividendQuantity.number / divisorQuantity.number,
      'reciprocal:' + divisorQuantity.unit
    );
  }
  return null;
}

export {
  addUnitTotals,
  createUnitTotals,
  divideUnitTotals,
  multiplyUnitTotals,
  PERCENTAGE,
  readSingleQuantity,
  scaleUnitTotals,
  UNITLESS
};
