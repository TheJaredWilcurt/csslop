/**
 * @file Resolves the CSS math functions whose arguments are arithmetic, such as `min()`, `clamp()`, and `round()`, once their arguments are known.
 */

import {
  createUnitTotals,
  readSingleQuantity,
  UNITLESS
} from './unit-totals.js';

/**
 * How each rounding strategy of `round()` turns the number of intervals it is
 * given into the whole number of them it keeps.
 *
 * @type {Map<string, function(number): number>}
 */
const ROUNDING_STRATEGIES = new Map([
  ['nearest', Math.round],
  ['up', Math.ceil],
  ['down', Math.floor],
  ['to-zero', Math.trunc]
]);

/**
 * Reads the arguments of a function as the numbers of one shared unit, which
 * is what a function comparing or rounding its arguments needs them to be.
 * Arguments carrying different units are only comparable once they are
 * resolved against the element, which is long after minification.
 *
 * @param  {Array}       argumentList  The arguments the function was called with.
 * @return {object|null}               The shared unit and the numbers the arguments state, or null when they do not share one.
 */
function readComparableArguments (argumentList) {
  const numbers = [];
  let sharedUnit = null;
  for (const argument of argumentList) {
    if (!argument.value) {
      return null;
    }
    const quantity = readSingleQuantity(argument.value);
    if (!quantity) {
      return null;
    }
    if (sharedUnit !== null && quantity.unit !== sharedUnit) {
      return null;
    }
    sharedUnit = quantity.unit;
    numbers.push(quantity.number);
  }
  if (!numbers.length) {
    return null;
  }
  return { numbers, unit: sharedUnit };
}

/**
 * Reads the single value argument a function takes, which no keyword may
 * stand in for.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the lone argument, or null when the function was called with anything else.
 */
function readLoneArgument (argumentList) {
  if (argumentList.length !== 1) {
    return null;
  }
  return argumentList[0].value;
}

/**
 * Resolves `calc()`, which states the value its one argument works out to.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals the calculation states, or null when it cannot be resolved.
 */
function evaluateCalculation (argumentList) {
  return readLoneArgument(argumentList);
}

/**
 * Resolves `min()`, which states the smallest of the values it compares.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the smallest argument, or null when the arguments are not comparable.
 */
function evaluateMinimum (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable) {
    return null;
  }
  const winningIndex = comparable.numbers.indexOf(Math.min(...comparable.numbers));
  return argumentList[winningIndex].value;
}

/**
 * Resolves `max()`, which states the largest of the values it compares.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the largest argument, or null when the arguments are not comparable.
 */
function evaluateMaximum (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable) {
    return null;
  }
  const winningIndex = comparable.numbers.indexOf(Math.max(...comparable.numbers));
  return argumentList[winningIndex].value;
}

/**
 * Reports whether an end of a `clamp()` range is left open, which the `none`
 * keyword does, leaving that end to bound nothing.
 *
 * @param  {object}  argument  The argument written at that end of the range.
 * @return {boolean}           Whether that end of the range is open.
 */
function boundsNothing (argument) {
  return argument.keyword === 'none';
}

/**
 * Resolves `clamp()`, which holds its preferred value inside the range its
 * other two arguments bound. The smallest value wins a range written back to
 * front, since the preferred value is held below the maximum before it is
 * held above the minimum.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the clamped value, or null when the arguments are not comparable.
 */
function evaluateClamp (argumentList) {
  if (argumentList.length !== 3) {
    return null;
  }
  const [lowerBound, preferred, upperBound] = argumentList;
  const boundedArguments = argumentList.filter((argument) => {
    return !boundsNothing(argument);
  });
  const comparable = readComparableArguments(boundedArguments);
  if (!comparable || !preferred.value) {
    return null;
  }
  let clamped = readSingleQuantity(preferred.value).number;
  if (!boundsNothing(upperBound)) {
    clamped = Math.min(clamped, readSingleQuantity(upperBound.value).number);
  }
  if (!boundsNothing(lowerBound)) {
    clamped = Math.max(clamped, readSingleQuantity(lowerBound.value).number);
  }
  return createUnitTotals(clamped, comparable.unit);
}

/**
 * Resolves `abs()`, which states its argument's distance from zero.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the absolute value, or null when the argument states more than one quantity.
 */
function evaluateAbsolute (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable || comparable.numbers.length !== 1) {
    return null;
  }
  return createUnitTotals(Math.abs(comparable.numbers[0]), comparable.unit);
}

/**
 * Resolves `sign()`, which states which side of zero its argument lies on as
 * a plain number.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the sign, or null when the argument states more than one quantity.
 */
function evaluateSign (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable || comparable.numbers.length !== 1) {
    return null;
  }
  return createUnitTotals(Math.sign(comparable.numbers[0]), UNITLESS);
}

/**
 * Resolves `hypot()`, which states the length of the vector its arguments
 * measure the sides of.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the hypotenuse, or null when the arguments are not comparable.
 */
function evaluateHypotenuse (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable) {
    return null;
  }
  return createUnitTotals(Math.hypot(...comparable.numbers), comparable.unit);
}

/**
 * Reads the two comparable numbers a function divides one of by the other,
 * refusing a divisor of zero, which no division resolves against.
 *
 * @param  {Array}       argumentList  The arguments the function was called with.
 * @return {object|null}               The shared unit with the dividend and the divisor, or null when the arguments cannot be divided.
 */
function readDivisionArguments (argumentList) {
  const comparable = readComparableArguments(argumentList);
  if (!comparable || comparable.numbers.length !== 2 || comparable.numbers[1] === 0) {
    return null;
  }
  return {
    dividend: comparable.numbers[0],
    divisor: comparable.numbers[1],
    unit: comparable.unit
  };
}

/**
 * Resolves `mod()`, which states what is left of its first argument after
 * taking out whole multiples of its second, carrying the sign of the divisor.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the modulus, or null when the arguments cannot be divided.
 */
function evaluateModulus (argumentList) {
  const division = readDivisionArguments(argumentList);
  if (!division) {
    return null;
  }
  const { dividend, divisor, unit } = division;
  return createUnitTotals(((dividend % divisor) + divisor) % divisor, unit);
}

/**
 * Resolves `rem()`, which states what is left of its first argument after
 * taking out whole multiples of its second, carrying the sign of the dividend.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the remainder, or null when the arguments cannot be divided.
 */
function evaluateRemainder (argumentList) {
  const division = readDivisionArguments(argumentList);
  if (!division) {
    return null;
  }
  const { dividend, divisor, unit } = division;
  return createUnitTotals(dividend % divisor, unit);
}

/**
 * Resolves `round()`, which states the multiple of its rounding interval that
 * the strategy it is given rounds its value to. A call written without a
 * strategy rounds to the nearest multiple.
 *
 * @param  {Array}    argumentList  The arguments the function was called with.
 * @return {Map|null}               The unit totals of the rounded value, or null when the arguments cannot be rounded.
 */
function evaluateRound (argumentList) {
  let strategyName = 'nearest';
  let valueArguments = argumentList;
  if (argumentList.length === 3) {
    strategyName = argumentList[0].keyword;
    valueArguments = argumentList.slice(1);
  }
  const roundIntervals = ROUNDING_STRATEGIES.get(strategyName);
  const division = readDivisionArguments(valueArguments);
  if (!roundIntervals || !division) {
    return null;
  }
  const { dividend, divisor, unit } = division;
  return createUnitTotals(roundIntervals(dividend / divisor) * divisor, unit);
}

/**
 * How each math function resolves the arguments it is called with. The
 * functions listed here are the ones whose arguments are arithmetic, so that
 * `*` and `/` between them are operators rather than characters of some other
 * syntax.
 *
 * @type {Map<string, function(Array): (Map|null)>}
 */
const MATH_FUNCTION_EVALUATORS = new Map([
  ['abs', evaluateAbsolute],
  ['calc', evaluateCalculation],
  ['clamp', evaluateClamp],
  ['hypot', evaluateHypotenuse],
  ['max', evaluateMaximum],
  ['min', evaluateMinimum],
  ['mod', evaluateModulus],
  ['rem', evaluateRemainder],
  ['round', evaluateRound],
  ['sign', evaluateSign]
]);

/**
 * The names of the functions whose arguments are a math expression.
 *
 * @type {Set<string>}
 */
const MATH_FUNCTION_NAMES = new Set(MATH_FUNCTION_EVALUATORS.keys());

export {
  MATH_FUNCTION_EVALUATORS,
  MATH_FUNCTION_NAMES
};
