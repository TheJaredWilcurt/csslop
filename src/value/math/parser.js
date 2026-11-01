/**
 * @file Reads the tokens of a CSS math function as sums, products, and operands, resolving each into the unit totals it states.
 */

import { MATH_FUNCTION_EVALUATORS } from './functions.js';
import {
  addUnitTotals,
  createUnitTotals,
  divideUnitTotals,
  multiplyUnitTotals,
  scaleUnitTotals,
  UNITLESS
} from './unit-totals.js';

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
 * The deepest a calculation may nest one set of parentheses inside another
 * before the evaluator gives up on it. Every level of nesting is a level of
 * recursion, and a stylesheet states nothing at a depth anywhere near this.
 *
 * @type {number}
 */
const MAXIMUM_NESTING_DEPTH = 32;

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
    return createUnitTotals(token.number, token.unit, true);
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

export {
  parseSum
};
