/**
 * @file Reads the arithmetic a CSS math function states and resolves it into the value it works out to, whenever every operand of it is a number already known at minification time.
 */

import {
  convertAbsoluteLengthToPx,
  formatResolvedNumber
} from './shared.js';

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
 * The numeric constants a calculation may name instead of writing out, as the
 * keywords section of the CSS Values specification defines them:
 * https://drafts.csswg.org/css-values/#calc-keywords.
 *
 * @type {Map<string, number>}
 */
const NUMERIC_CONSTANTS = new Map([
  ['e', Math.E],
  ['infinity', Infinity],
  ['nan', NaN],
  ['pi', Math.PI]
]);

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
 * The deepest a calculation may nest one set of parentheses inside another
 * before the evaluator gives up on it. Every level of nesting is a level of
 * recursion, and a stylesheet states nothing at a depth anywhere near this.
 *
 * @type {number}
 */
const MAXIMUM_NESTING_DEPTH = 32;

/**
 * Creates the totals of a value that states a single quantity, holding the
 * number it is written from under the unit it is written with. An absolute
 * length is held as the pixels it measures, since every length stating the
 * same measurement then totals under the same unit.
 *
 * @param  {number} number  The number the quantity is written from.
 * @param  {string} unit    The unit the quantity is written with, or the empty string when it is a plain number.
 * @return {Map}            The unit totals the quantity states.
 */
function createUnitTotals (number, unit) {
  const lowercasedUnit = unit.toLowerCase();
  const pixels = convertAbsoluteLengthToPx(number, lowercasedUnit);
  if (pixels === null) {
    return new Map([[lowercasedUnit, number]]);
  }
  return new Map([['px', pixels]]);
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
  if (!isPlainNumber(right)) {
    return null;
  }
  const divisor = right.get(UNITLESS);
  if (divisor === 0) {
    return null;
  }
  return scaleUnitTotals(left, 1 / divisor);
}

/**
 * Matches a CSS number where the scanner stands: the digits it is written
 * from, together with the fraction and the exponent it may be written with.
 * A sign is left to the parser, which tells the sign of a number from an
 * operator by whether whitespace stands between the two.
 *
 * @type {RegExp}
 */
const NUMBER_AT_INDEX = /(?:\d+\.\d+|\.\d+|\d+)(?:e[+-]?\d+)?/iy;

/**
 * Matches a CSS identifier where the scanner stands: a name of letters,
 * digits, underscores, and hyphens that does not begin with a digit. A numeric
 * constant, a function name, and a keyword argument are all written as
 * identifiers.
 *
 * @type {RegExp}
 */
const IDENTIFIER_AT_INDEX = /[a-z_][a-z0-9_-]*/iy;

/**
 * Matches the unit written against a number where the scanner stands. Every
 * CSS unit is named in letters alone, so a name holding anything else is a
 * token of its own that a number cannot carry.
 *
 * @type {RegExp}
 */
const UNIT_AT_INDEX = /[a-z]+/iy;

/**
 * The characters CSS counts as whitespace, which separates the tokens of a
 * calculation and tells an operator apart from the sign of a number.
 *
 * @type {Set<string>}
 */
const WHITESPACE_CHARACTERS = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * The characters that punctuate a calculation, and the kind of token each of
 * them stands for.
 *
 * @type {Map<string, string>}
 */
const PUNCTUATION_TOKEN_TYPES = new Map([
  ['(', 'open'],
  [')', 'close'],
  [',', 'comma']
]);

/**
 * The arithmetic operators a calculation is written with.
 *
 * @type {Set<string>}
 */
const OPERATOR_CHARACTERS = new Set(['+', '-', '*', '/']);

/**
 * Reads the unit written directly against the number that ends at the given
 * index, which is a percent sign or an identifier naming the unit. A number
 * with nothing written against it carries no unit.
 *
 * @param  {string} text   The math function being tokenized.
 * @param  {number} index  The index just past the number's digits.
 * @return {object}        The unit read and the index just past it.
 */
function readUnitAtIndex (text, index) {
  if (text[index] === PERCENTAGE) {
    return { unit: PERCENTAGE, nextIndex: index + 1 };
  }
  UNIT_AT_INDEX.lastIndex = index;
  const unitMatch = UNIT_AT_INDEX.exec(text);
  if (!unitMatch) {
    return { unit: UNITLESS, nextIndex: index };
  }
  return { unit: unitMatch[0], nextIndex: index + unitMatch[0].length };
}

/**
 * Splits a math function into the tokens it is written from: its numbers with
 * the units they carry, its identifiers, its function names, its operators,
 * and its punctuation. Each token records whether whitespace precedes it,
 * since that is what tells the sign of a number from an operator.
 *
 * @param  {string}     text  The math function as it is written.
 * @return {Array|null}       The tokens of the math function, or null when it holds a character no calculation is written with.
 */
function tokenizeMathExpression (text) {
  const tokens = [];
  let index = 0;
  let precededBySpace = false;

  while (index < text.length) {
    const character = text[index];

    if (WHITESPACE_CHARACTERS.has(character)) {
      precededBySpace = true;
      index++;
      continue;
    }

    NUMBER_AT_INDEX.lastIndex = index;
    const numberMatch = NUMBER_AT_INDEX.exec(text);
    if (numberMatch) {
      const { unit, nextIndex } = readUnitAtIndex(text, index + numberMatch[0].length);
      tokens.push({
        type: 'number',
        number: Number(numberMatch[0]),
        unit,
        precededBySpace
      });
      index = nextIndex;
      precededBySpace = false;
      continue;
    }

    if (OPERATOR_CHARACTERS.has(character) || PUNCTUATION_TOKEN_TYPES.has(character)) {
      tokens.push({
        type: PUNCTUATION_TOKEN_TYPES.get(character) || 'operator',
        operator: character,
        precededBySpace
      });
      index++;
      precededBySpace = false;
      continue;
    }

    IDENTIFIER_AT_INDEX.lastIndex = index;
    const identifierMatch = IDENTIFIER_AT_INDEX.exec(text);
    if (!identifierMatch) {
      return null;
    }
    index = index + identifierMatch[0].length;
    // A name written directly against an opening parenthesis calls a function
    const callsFunction = text[index] === '(';
    if (callsFunction) {
      index++;
    }
    tokens.push({
      type: callsFunction ? 'function' : 'identifier',
      name: identifierMatch[0].toLowerCase(),
      precededBySpace
    });
    precededBySpace = false;
  }

  return tokens;
}

/**
 * @typedef  {object} ExpressionReader
 * @property {Array}  tokens            The tokens of the math function, in the order they are written.
 * @property {number} index             The token the parser reads next.
 * @property {number} depth             How many sets of parentheses the parser is reading inside of.
 */

/**
 * Reads the token the parser stands on, or one of the tokens after it.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @param  {number}           offset  How many tokens past the current one to read.
 * @return {object|undefined}         The token read, or undefined past the end of the expression.
 */
function peekToken (reader, offset = 0) {
  return reader.tokens[reader.index + offset];
}

/**
 * Reports whether the parser stands on an operator that adds or subtracts what
 * follows it from what precedes it. A sign written directly against its number
 * is part of that number rather than an operator, so a value written with one
 * sits against the value before it with no operator between them, which is not
 * a calculation any browser reads.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {boolean}                  Whether an addition or a subtraction follows.
 */
function readsAdditiveOperator (reader) {
  const token = peekToken(reader);
  const isAdditive = token?.type === 'operator' && (token.operator === '+' || token.operator === '-');
  if (!isAdditive) {
    return false;
  }
  const operandToken = peekToken(reader, 1);
  const signsItsNumber = operandToken?.type === 'number' && !operandToken.precededBySpace;
  return !signsItsNumber;
}

/**
 * Reads a sum: the terms a calculation adds together, in the order they are
 * written.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Map|null}                 The unit totals the sum states, or null when it cannot be resolved.
 */
function parseSum (reader) {
  let value = parseProduct(reader);
  if (!value) {
    return null;
  }
  while (readsAdditiveOperator(reader)) {
    const subtracts = peekToken(reader).operator === '-';
    reader.index++;
    const term = parseProduct(reader);
    if (!term) {
      return null;
    }
    value = addUnitTotals(value, term, subtracts ? -1 : 1);
    if (!value) {
      return null;
    }
  }
  return value;
}

/**
 * Reads a product: the operands a calculation multiplies and divides, which
 * bind more tightly than the terms of a sum do.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Map|null}                 The unit totals the product states, or null when it cannot be resolved.
 */
function parseProduct (reader) {
  let value = parseOperand(reader);
  if (!value) {
    return null;
  }
  let token = peekToken(reader);
  while (token?.type === 'operator' && (token.operator === '*' || token.operator === '/')) {
    reader.index++;
    const operand = parseOperand(reader);
    if (!operand) {
      return null;
    }
    if (token.operator === '*') {
      value = multiplyUnitTotals(value, operand);
    } else {
      value = divideUnitTotals(value, operand);
    }
    if (!value) {
      return null;
    }
    token = peekToken(reader);
  }
  return value;
}

/**
 * Reads the number a sign is written against, which is the only place a
 * calculation states a sign: CSS has no operator that negates what follows it,
 * so a sign standing apart from its number, or a second sign written in front
 * of the first, is not a calculation any browser reads.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Map|null}                 The unit totals the signed number states, or null when the sign signs nothing.
 */
function parseSignedNumber (reader) {
  const signToken = peekToken(reader);
  const signedToken = peekToken(reader, 1);
  const signsItsValue = (
    (signedToken?.type === 'number' || signedToken?.type === 'identifier') &&
    !signedToken.precededBySpace
  );
  if (!signsItsValue) {
    return null;
  }
  reader.index++;
  const value = parseOperand(reader);
  if (!value) {
    return null;
  }
  if (signToken.operator === '-') {
    return scaleUnitTotals(value, -1);
  }
  return value;
}

/**
 * Reads a single operand: a signed number, a number, a numeric constant, a
 * parenthesized sum, or another math function.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Map|null}                 The unit totals the operand states, or null when it cannot be resolved.
 */
function parseOperand (reader) {
  const token = peekToken(reader);
  if (!token) {
    return null;
  }
  if (token.type === 'operator' && (token.operator === '+' || token.operator === '-')) {
    return parseSignedNumber(reader);
  }
  if (token.type === 'number') {
    reader.index++;
    return createUnitTotals(token.number, token.unit);
  }
  if (token.type === 'identifier') {
    reader.index++;
    const constant = NUMERIC_CONSTANTS.get(token.name);
    if (constant === undefined) {
      return null;
    }
    return createUnitTotals(constant, UNITLESS);
  }
  if (token.type === 'function') {
    reader.index++;
    return parseMathFunction(reader, token.name);
  }
  if (token.type === 'open') {
    reader.index++;
    return parseGroup(reader);
  }
  return null;
}

/**
 * Reads a sum written inside parentheses, which is read as one operand of the
 * calculation around it.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Map|null}                 The unit totals the group states, or null when it cannot be resolved.
 */
function parseGroup (reader) {
  if (reader.depth >= MAXIMUM_NESTING_DEPTH) {
    return null;
  }
  reader.depth++;
  const value = parseSum(reader);
  reader.depth--;
  if (!value || peekToken(reader)?.type !== 'close') {
    return null;
  }
  reader.index++;
  return value;
}

/**
 * Reads one argument of a math function, which is either a sum or a lone
 * keyword such as the rounding strategy of `round()` or the open end of a
 * `clamp()` range.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {object|null}              The argument read, or null when it cannot be resolved.
 */
function parseFunctionArgument (reader) {
  const token = peekToken(reader);
  const followingToken = peekToken(reader, 1);
  const standsAlone = followingToken?.type === 'comma' || followingToken?.type === 'close';
  const isKeyword = token?.type === 'identifier' && standsAlone && !NUMERIC_CONSTANTS.has(token.name);
  if (isKeyword) {
    reader.index++;
    return { keyword: token.name, value: null };
  }
  const value = parseSum(reader);
  if (!value) {
    return null;
  }
  return { keyword: null, value };
}

/**
 * Reads the comma-separated arguments a math function is called with, up to
 * the parenthesis that closes the call.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @return {Array|null}               The arguments read, or null when the call cannot be resolved.
 */
function parseFunctionArguments (reader) {
  const argumentList = [];
  while (reader.index < reader.tokens.length) {
    const argument = parseFunctionArgument(reader);
    if (!argument) {
      return null;
    }
    argumentList.push(argument);
    const token = peekToken(reader);
    if (token?.type === 'close') {
      reader.index++;
      return argumentList;
    }
    if (token?.type !== 'comma') {
      return null;
    }
    reader.index++;
  }
  return null;
}

/**
 * Reads the arguments of a math function and works out the value the function
 * resolves to.
 *
 * @param  {ExpressionReader} reader  The token reader.
 * @param  {string}           name    The lowercased name of the function being called.
 * @return {Map|null}                 The unit totals the function resolves to, or null when it cannot be resolved.
 */
function parseMathFunction (reader, name) {
  const resolveFunction = MATH_FUNCTION_EVALUATORS.get(name);
  if (!resolveFunction || reader.depth >= MAXIMUM_NESTING_DEPTH) {
    return null;
  }
  reader.depth++;
  const argumentList = parseFunctionArguments(reader);
  reader.depth--;
  if (!argumentList) {
    return null;
  }
  return resolveFunction(argumentList);
}

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
  return createUnitTotals(Math.min(...comparable.numbers), comparable.unit);
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
  return createUnitTotals(Math.max(...comparable.numbers), comparable.unit);
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

/**
 * The smallest total a term is written with. A term totalling less than this
 * is the rounding error binary floating point arithmetic leaves behind rather
 * than a quantity the stylesheet states.
 *
 * @type {number}
 */
const NEGLIGIBLE_TOTAL = 1e-12;

/**
 * The unit each kind of quantity is canonically stated in, and how much of
 * that unit one of the unit written measures. Absolute lengths are absent
 * because every length is already totalled in the pixels it measures.
 *
 * @type {Map<string, {unit: string, perUnit: number}>}
 */
const CANONICAL_UNITS = new Map([
  ['s', { unit: 's', perUnit: 1 }],
  ['ms', { unit: 's', perUnit: 1 / 1000 }],
  ['deg', { unit: 'deg', perUnit: 1 }],
  ['grad', { unit: 'deg', perUnit: 360 / 400 }],
  ['rad', { unit: 'deg', perUnit: 180 / Math.PI }],
  ['turn', { unit: 'deg', perUnit: 360 }],
  ['hz', { unit: 'hz', perUnit: 1 }],
  ['khz', { unit: 'hz', perUnit: 1000 }],
  ['dppx', { unit: 'dppx', perUnit: 1 }],
  ['x', { unit: 'dppx', perUnit: 1 }],
  ['dpi', { unit: 'dppx', perUnit: 1 / 96 }],
  ['dpcm', { unit: 'dppx', perUnit: 2.54 / 96 }]
]);

/**
 * Counts how many units of each kind of quantity a calculation totalled, so
 * that the kinds it states in more than one unit can be told from the ones it
 * states in a single unit.
 *
 * @param  {Map} totals  The unit totals the calculation resolved to.
 * @return {Map}         How many units each canonical unit was totalled from.
 */
function countUnitsByKind (totals) {
  const counts = new Map();
  for (const unit of totals.keys()) {
    const conversion = CANONICAL_UNITS.get(unit);
    if (!conversion) {
      continue;
    }
    counts.set(conversion.unit, (counts.get(conversion.unit) || 0) + 1);
  }
  return counts;
}

/**
 * Restates the totals of every kind of quantity a calculation measured in two
 * units of, so that terms measuring the same thing are totalled together
 * (`calc(1s - 200ms)` comes to `.8s`). A kind measured in a single unit keeps
 * that unit: restating `2ms` as `.002s` measures the same time in more
 * characters than it was written with.
 *
 * @param  {Map} totals  The unit totals the calculation resolved to.
 * @return {Map}         The totals, with each kind of quantity stated in one unit.
 */
function mergeUnitsOfSameKind (totals) {
  const unitCounts = countUnitsByKind(totals);
  const measuredInSeveralUnits = [...unitCounts.values()].some((count) => {
    return count > 1;
  });
  if (!measuredInSeveralUnits) {
    return totals;
  }
  const merged = new Map();
  for (const [unit, total] of totals) {
    const conversion = CANONICAL_UNITS.get(unit);
    const restatesUnit = conversion && unitCounts.get(conversion.unit) > 1;
    const mergedUnit = restatesUnit ? conversion.unit : unit;
    const mergedTotal = restatesUnit ? total * conversion.perUnit : total;
    merged.set(mergedUnit, (merged.get(mergedUnit) || 0) + mergedTotal);
  }
  return merged;
}

/**
 * Collects the terms a resolved calculation is written from, leaving out the
 * ones that totalled to nothing. A unit is totalled from where it is first
 * written, so the terms keep the order the calculation states them in, which
 * is both the order the author chose and one fewer difference between what
 * was written and what is written back out.
 *
 * @param  {Map}   totals  The unit totals the calculation resolved to.
 * @return {Array}         The terms to write, each holding its unit and its total.
 */
function collectOutputTerms (totals) {
  const terms = [];
  for (const [unit, total] of totals) {
    if (Math.abs(total) < NEGLIGIBLE_TOTAL) {
      continue;
    }
    terms.push({ total, unit });
  }
  return leadWithAddedTerm(terms);
}

/**
 * Moves an added term to the front of a calculation that a subtracted one
 * leads. Every term but the first is written after the operator adding or
 * subtracting it, so a term written first states its own sign, and the minus
 * sign of a subtracted one is a character the sum saves by being led by a
 * term that is added instead.
 *
 * @param  {Array} terms  The terms to write, in the order the calculation states them.
 * @return {Array}        The same terms, led by one that is added whenever any of them is.
 */
function leadWithAddedTerm (terms) {
  if (!terms.length || terms[0].total > 0) {
    return terms;
  }
  const leadingIndex = terms.findIndex((term) => {
    return term.total > 0;
  });
  if (leadingIndex === -1) {
    return terms;
  }
  const reordered = [...terms];
  const [addedTerm] = reordered.splice(leadingIndex, 1);
  reordered.unshift(addedTerm);
  return reordered;
}

/**
 * Reports whether writing only the terms collected would drop a percentage the
 * calculation was written with. A percentage that cancels out still ties the
 * value to the basis the percentage is resolved against, so a calculation
 * keeping other terms cannot be written without it.
 *
 * @param  {Map}     totals       The unit totals the calculation resolved to.
 * @param  {Array}   outputTerms  The terms that would be written.
 * @return {boolean}              Whether a percentage the calculation states would be lost.
 */
function dropsPercentageBasis (totals, outputTerms) {
  if (!totals.has(PERCENTAGE) || !outputTerms.length) {
    return false;
  }
  return !outputTerms.some((term) => {
    return term.unit === PERCENTAGE;
  });
}

/**
 * Writes the total of a term as the number a stylesheet states it with. A
 * total that no written number states faithfully — one that is infinite, one
 * beyond the integers a double holds exactly, and one that rounds away to
 * nothing — has no number to be written as.
 *
 * @param  {number}      total  The total the term resolved to.
 * @return {string|null}        The number as it is written into the stylesheet, or null when it cannot be written.
 */
function writeTermNumber (total) {
  if (!Number.isFinite(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const written = formatResolvedNumber(total);
  const roundsAwayToNothing = total !== 0 && parseFloat(written) === 0;
  if (roundsAwayToNothing) {
    return null;
  }
  return written;
}

/**
 * Writes the unit totals a calculation resolved to as the shortest value
 * stating them: the lone quantity they came to, or, when units that only
 * resolve against the element are left over, a `calc()` summing what remains.
 *
 * @param  {Map}         totals  The unit totals the calculation resolved to.
 * @return {string|null}         The value the calculation resolved to, or null when it cannot be written faithfully.
 */
function formatUnitTotals (totals) {
  const mergedTotals = mergeUnitsOfSameKind(totals);
  const outputTerms = collectOutputTerms(mergedTotals);
  if (dropsPercentageBasis(mergedTotals, outputTerms)) {
    return null;
  }
  if (!outputTerms.length) {
    return '0';
  }
  const [leadingTerm, ...trailingTerms] = outputTerms;
  const leadingNumber = writeTermNumber(leadingTerm.total);
  if (leadingNumber === null) {
    return null;
  }
  let written = leadingNumber + leadingTerm.unit;
  for (const term of trailingTerms) {
    const number = writeTermNumber(Math.abs(term.total));
    if (number === null) {
      return null;
    }
    // Both operators have to be surrounded by whitespace to be read as one
    written = written + (term.total < 0 ? ' - ' : ' + ') + number + term.unit;
  }
  if (trailingTerms.length) {
    return 'calc(' + written + ')';
  }
  return written;
}

/**
 * Resolves a CSS math function into the value its arithmetic works out to.
 * A function whose operands are not all known at minification time — one
 * referencing a custom property, an environment variable, or an element the
 * value is only resolved against once the page is laid out — states a value
 * that cannot be worked out here, and so resolves to nothing.
 *
 * @param  {string}      mathFunction  The math function as it is written, such as `calc(10 / 2)` or `min(10px, 20px)`.
 * @return {string|null}               The value the math function states, or null when it cannot be resolved.
 */
function simplifyCalc (mathFunction) {
  const tokens = tokenizeMathExpression(mathFunction);
  if (!tokens) {
    return null;
  }
  const reader = { tokens, index: 0, depth: 0 };
  const totals = parseSum(reader);
  // A token left unread means the expression states more than the arithmetic
  // that was resolved, so what was resolved is not the whole of its value
  if (!totals || reader.index !== tokens.length) {
    return null;
  }
  return formatUnitTotals(totals);
}

export {
  formatUnitTotals,
  MATH_FUNCTION_NAMES,
  simplifyCalc
};
