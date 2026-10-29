/**
 * @file Drops the whitespace of a minified CSS value that only separates two tokens which already mark the boundary between them.
 */

import { tokenizeCssValue } from '../parser/tokenizer.js';

import { shortenNumericText } from './numbers.js';

/**
 * One token of a value, as the tokenizer reads it.
 *
 * @typedef {import('../parser/tokenizer.js').CssToken} CssToken
 */

/**
 * The operators that a math function requires whitespace on both sides of. Both
 * of them double as the sign of a number, so an unseparated one is read as part
 * of the term that follows it and the expression silently breaks.
 *
 * @type {Set<string>}
 */
const MATH_OPERATOR_DELIMITERS = new Set(['+', '-']);

/**
 * Reports whether a token is an operator that a math function needs kept apart
 * from the terms around it.
 *
 * @param  {CssToken} token  The token to test.
 * @return {boolean}         Whether the token is a `+` or a `-` operator.
 */
function isMathOperator (token) {
  return token.type === 'delim' && MATH_OPERATOR_DELIMITERS.has(token.text);
}

/**
 * Reports whether two tokens written side by side still read as those same two
 * tokens. Writing them together and tokenizing the result answers this for
 * every pair at once: a pair that merges comes back as one token, such as the
 * `4px` and `solid` of `4pxsolid`, while a pair that holds its own comes back
 * unchanged, such as the `solid` and `#0000` of `solid#0000`.
 *
 * @param  {CssToken} leftToken   The token before the separator.
 * @param  {CssToken} rightToken  The token after the separator.
 * @return {boolean}              Whether the two tokens survive being written together.
 */
function canJoinTokens (leftToken, rightToken) {
  const rejoinedTokens = tokenizeCssValue(leftToken.text + rightToken.text);
  return (
    rejoinedTokens.length === 2 &&
    rejoinedTokens[0].text === leftToken.text &&
    rejoinedTokens[1].text === rightToken.text
  );
}

/**
 * The characters that close a token and can never continue one. A token that
 * ends with one of them, such as a `url()` or a quoted string, marks where it
 * ends without any help from the whitespace behind it.
 *
 * @type {Set<string>}
 */
const TOKEN_CLOSING_CHARACTERS = new Set([')', ']', '}', '"', '\'']);

/**
 * The characters that can only ever open a token, never continue one. A token
 * that starts with one of them, such as a hash color or a quoted string, marks
 * where it starts without any help from the whitespace in front of it.
 *
 * @type {Set<string>}
 */
const TOKEN_OPENING_CHARACTERS = new Set(['#', '!', '"', '\'', '(', ')', '[', ']', '{', '}', ',', ':', ';']);

/**
 * Reports whether a token spells out its own end, so that the token after it
 * reads as a separate one even with nothing written between them.
 *
 * @param  {CssToken} token  The token to test.
 * @return {boolean}         Whether the token's last character closes it.
 */
function marksItsOwnEnd (token) {
  return TOKEN_CLOSING_CHARACTERS.has(token.text.slice(-1));
}

/**
 * Reports whether a token spells out its own start, so that the token before it
 * reads as a separate one even with nothing written between them.
 *
 * @param  {CssToken} token  The token to test.
 * @return {boolean}         Whether the token's first character opens it.
 */
function marksItsOwnStart (token) {
  return TOKEN_OPENING_CHARACTERS.has(token.text.slice(0, 1));
}

/**
 * Reports whether the whitespace between two tokens carries nothing. That takes
 * three things: one of the two tokens has to spell out the boundary the
 * whitespace would otherwise be drawing, the pair has to survive being written
 * together as the same two tokens, and neither of them may be a math operator,
 * which reads the whitespace around it as part of the expression's grammar.
 *
 * @param  {CssToken} [previousToken]              The token before the whitespace, when the whitespace does not lead the value.
 * @param  {CssToken} [nextToken]                  The token after the whitespace, when the whitespace does not trail the value.
 * @param  {boolean}  elidesAfterSelfEndingTokens  Whether a token that marks its own end is allowed to absorb the whitespace behind it.
 * @return {boolean}                               Whether the whitespace may be dropped.
 */
function isRedundantSeparator (previousToken, nextToken, elidesAfterSelfEndingTokens) {
  if (!previousToken || !nextToken) {
    return true;
  }
  if (isMathOperator(previousToken) || isMathOperator(nextToken)) {
    return false;
  }
  const marksTheBoundary = (
    (elidesAfterSelfEndingTokens && marksItsOwnEnd(previousToken)) ||
    marksItsOwnStart(nextToken)
  );
  if (!marksTheBoundary) {
    return false;
  }
  return canJoinTokens(previousToken, nextToken);
}

/**
 * Removes every run of whitespace in a CSS value that separates two tokens
 * already marking the boundary between them, leaving the runs that keep their
 * neighbours from being read as a single different token.
 *
 * @param  {string}  value                        The minified CSS value.
 * @param  {boolean} elidesAfterSelfEndingTokens  Whether the whitespace that follows a token marking its own end, such as a `url()` or a function call, may go. A grammar that reads a component by where it sits relative to a function, such as the `<position>` that may follow the image of a `background` layer, keeps those separators and drops only the ones the token after them marks.
 * @return {string}                               The value without its redundant separators.
 */
function elideRedundantSeparators (value, elidesAfterSelfEndingTokens = true) {
  const tokens = tokenizeCssValue(value);
  return tokens.map((token, index) => {
    if (token.type !== 'whitespace') {
      return token.text;
    }
    if (isRedundantSeparator(tokens[index - 1], tokens[index + 1], elidesAfterSelfEndingTokens)) {
      return '';
    }
    return token.text;
  }).join('');
}

/**
 * Properties whose whole value is a unitless `<number>` rather than an
 * `<integer>`, so a number written directly in them may use scientific
 * notation.
 *
 * @type {Set<string>}
 */
const NUMBER_VALUED_PROPERTIES = new Set([
  'animation-iteration-count',
  'fill-opacity',
  'flex-grow',
  'flex-shrink',
  'flood-opacity',
  'opacity',
  'stop-opacity',
  'stroke-miterlimit',
  'stroke-opacity',
  'tab-size'
]);

/**
 * Functions whose arguments are unitless `<number>`s rather than `<integer>`s,
 * so the numbers written directly inside them may use scientific notation.
 *
 * @type {Set<string>}
 */
const NUMBER_ARGUMENT_FUNCTIONS = new Set([
  'matrix',
  'matrix3d',
  'scale',
  'scale3d',
  'scalex',
  'scaley',
  'scalez'
]);

/**
 * Reports whether a unitless number token sits where only a `<number>` is
 * accepted, either directly in a number-valued property or directly inside a
 * function that takes number arguments.
 *
 * @param  {string|null} enclosingFunction  The lowercased name of the innermost function holding the token, or null at the top level.
 * @param  {string}      property           The lowercased property the value belongs to.
 * @return {boolean}                        Whether the number may use scientific notation.
 */
function isNumberTypedPosition (enclosingFunction, property) {
  if (enclosingFunction === null) {
    return NUMBER_VALUED_PROPERTIES.has(property);
  }
  return NUMBER_ARGUMENT_FUNCTIONS.has(enclosingFunction);
}

/**
 * Shortens the numeric tokens of a value into their shortest spelling,
 * including scientific notation. Dimensions and percentages are always
 * `<number>` based, but a unitless number is only shortened where its grammar
 * is known to take a `<number>`, because `<integer>` grammars reject
 * scientific notation.
 *
 * @param  {string} value       The CSS value.
 * @param  {string} [property]  The property the value belongs to.
 * @return {string}             The value with shorter numeric spellings.
 */
function shortenDimensionNumbers (value, property = '') {
  const normalizedProperty = property.toLowerCase();
  const functionStack = [];
  return tokenizeCssValue(value).map((token) => {
    if (token.type === 'function') {
      functionStack.push(token.text.slice(0, -1).toLowerCase());
      return token.text;
    }
    if (token.text === '(') {
      functionStack.push('');
      return token.text;
    }
    if (token.text === ')') {
      functionStack.pop();
      return token.text;
    }
    if (token.type === 'dimension' || token.type === 'percentage') {
      return shortenNumericText(token.text, true);
    }
    const enclosingFunction = functionStack.length ? functionStack[functionStack.length - 1] : null;
    if (token.type === 'number' && isNumberTypedPosition(enclosingFunction, normalizedProperty)) {
      return shortenNumericText(token.text, true);
    }
    return token.text;
  }).join('');
}

export {
  elideRedundantSeparators,
  shortenDimensionNumbers
};
