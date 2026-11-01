/**
 * @file Splits a CSS math function into the numbers, identifiers, function names, operators, and punctuation it is written from.
 */

import {
  PERCENTAGE,
  UNITLESS
} from './unit-totals.js';

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

export {
  tokenizeMathExpression
};
