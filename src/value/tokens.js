/**
 * @file Tokenizes a CSS value the way the CSS Syntax tokenizer does, so that the whitespace which only separated two tokens that already end themselves can be told apart from the whitespace that holds two tokens apart.
 */

/**
 * Matches one CSS whitespace character. CSS counts a form feed and a carriage
 * return as whitespace, so the shorter `\s` class would be too broad.
 *
 * @type {RegExp}
 */
const WHITESPACE_CHARACTER = /[ \t\n\r\f]/;

/**
 * Matches one decimal digit, which is what starts the numeric tokens.
 *
 * @type {RegExp}
 */
const DIGIT_CHARACTER = /[0-9]/;

/**
 * Matches one hexadecimal digit, which is what a unicode escape holds.
 *
 * @type {RegExp}
 */
const HEX_DIGIT_CHARACTER = /[0-9a-fA-F]/;

/**
 * Matches one character that may start an identifier: a letter, an underscore,
 * or anything outside ASCII.
 *
 * @type {RegExp}
 */
const IDENT_START_CHARACTER = /[a-zA-Z_\u0080-\uFFFF]/;

/**
 * Matches one character that may continue an identifier, which is everything an
 * identifier may start with plus the digits and the hyphen.
 *
 * @type {RegExp}
 */
const NAME_CHARACTER = /[-a-zA-Z0-9_\u0080-\uFFFF]/;

/**
 * @typedef  {object} CssToken
 * @property {string} type      The kind of token, such as `ident`, `number`, or `whitespace`.
 * @property {string} text      The exact slice of the value that the token spans.
 */

/**
 * Reports whether the two characters at an index form a valid escape sequence.
 * A backslash escapes the character after it, unless that character is the
 * newline that ends the line.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the possible backslash.
 * @return {boolean}        Whether an escape sequence starts at the index.
 */
function startsEscape (text, index) {
  return text[index] === '\\' && text[index + 1] !== '\n';
}

/**
 * Reads past an escape sequence, which is either up to six hexadecimal digits
 * and the single whitespace character that may end them, or one escaped
 * character.
 *
 * @param  {string} text   The CSS value being read.
 * @param  {number} index  The index of the backslash that starts the escape.
 * @return {number}        The index just past the escape sequence.
 */
function readPastEscape (text, index) {
  let end = index + 1;
  let hexDigitCount = 0;
  while (end < text.length && hexDigitCount < 6 && HEX_DIGIT_CHARACTER.test(text[end])) {
    end++;
    hexDigitCount++;
  }
  if (!hexDigitCount) {
    return Math.min(end + 1, text.length);
  }
  if (end < text.length && WHITESPACE_CHARACTER.test(text[end])) {
    end++;
  }
  return end;
}

/**
 * Reads past a name, the run of identifier characters and escapes that makes up
 * an identifier, the body of a hash token, or the unit of a dimension.
 *
 * @param  {string} text   The CSS value being read.
 * @param  {number} index  The index the name starts at.
 * @return {number}        The index just past the name.
 */
function readPastName (text, index) {
  let end = index;
  while (end < text.length) {
    if (NAME_CHARACTER.test(text[end])) {
      end++;
      continue;
    }
    if (startsEscape(text, end)) {
      end = readPastEscape(text, end);
      continue;
    }
    break;
  }
  return end;
}

/**
 * Reports whether an identifier starts at an index. A hyphen starts one only
 * when a second hyphen, an identifier character, or an escape follows it, which
 * is what makes `--custom` an identifier and a lone `-` a delimiter.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index to test.
 * @return {boolean}        Whether an identifier starts at the index.
 */
function startsIdent (text, index) {
  const character = text[index];
  if (character === undefined) {
    return false;
  }
  if (character === '-') {
    const nextCharacter = text[index + 1];
    if (nextCharacter === '-') {
      return true;
    }
    return Boolean(nextCharacter) && (IDENT_START_CHARACTER.test(nextCharacter) || startsEscape(text, index + 1));
  }
  if (IDENT_START_CHARACTER.test(character)) {
    return true;
  }
  return startsEscape(text, index);
}

/**
 * Reports whether a number starts at an index. A sign or a decimal point only
 * starts one when a digit follows close enough behind it.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index to test.
 * @return {boolean}        Whether a number starts at the index.
 */
function startsNumber (text, index) {
  const character = text[index];
  if (character === undefined) {
    return false;
  }
  if (character === '+' || character === '-') {
    const nextCharacter = text[index + 1] || '';
    const followingCharacter = text[index + 2] || '';
    return DIGIT_CHARACTER.test(nextCharacter) || (nextCharacter === '.' && DIGIT_CHARACTER.test(followingCharacter));
  }
  if (character === '.') {
    return DIGIT_CHARACTER.test(text[index + 1] || '');
  }
  return DIGIT_CHARACTER.test(character);
}

/**
 * Reads past the run of digits that starts at an index.
 *
 * @param  {string} text   The CSS value being read.
 * @param  {number} index  The index the digits start at.
 * @return {number}        The index just past the digits.
 */
function readPastDigits (text, index) {
  let end = index;
  while (end < text.length && DIGIT_CHARACTER.test(text[end])) {
    end++;
  }
  return end;
}

/**
 * Reads past a number: an optional sign, an integer part, an optional fraction,
 * and an optional scientific exponent.
 *
 * @param  {string} text   The CSS value being read.
 * @param  {number} index  The index the number starts at.
 * @return {number}        The index just past the number.
 */
function readPastNumber (text, index) {
  let end = index;
  if (text[end] === '+' || text[end] === '-') {
    end++;
  }
  end = readPastDigits(text, end);
  if (text[end] === '.' && DIGIT_CHARACTER.test(text[end + 1] || '')) {
    end = readPastDigits(text, end + 1);
  }
  const exponentCharacter = text[end];
  if (exponentCharacter === 'e' || exponentCharacter === 'E') {
    let exponentEnd = end + 1;
    if (text[exponentEnd] === '+' || text[exponentEnd] === '-') {
      exponentEnd++;
    }
    if (DIGIT_CHARACTER.test(text[exponentEnd] || '')) {
      end = readPastDigits(text, exponentEnd);
    }
  }
  return end;
}

/**
 * Reads the numeric token at an index. A number takes a unit when an identifier
 * follows it and becomes a percentage when a percent sign does.
 *
 * @param  {string}   text   The CSS value being read.
 * @param  {number}   index  The index the number starts at.
 * @return {CssToken}        The dimension, percentage, or number token.
 */
function readNumericToken (text, index) {
  const numberEnd = readPastNumber(text, index);
  if (startsIdent(text, numberEnd)) {
    const unitEnd = readPastName(text, numberEnd);
    return { type: 'dimension', text: text.slice(index, unitEnd) };
  }
  if (text[numberEnd] === '%') {
    return { type: 'percentage', text: text.slice(index, numberEnd + 1) };
  }
  return { type: 'number', text: text.slice(index, numberEnd) };
}

/**
 * Reports whether the contents of a `url()` are quoted, which makes it an
 * ordinary function token holding a string rather than a single url token.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index just past the opening parenthesis.
 * @return {boolean}        Whether a quoted string opens the parentheses.
 */
function holdsQuotedUrl (text, index) {
  let end = index;
  while (end < text.length && WHITESPACE_CHARACTER.test(text[end])) {
    end++;
  }
  return text[end] === '"' || text[end] === '\'';
}

/**
 * Reads past the body of an unquoted url token, which runs to the parenthesis
 * that closes it. An unquoted url holds no nested parentheses, so the first
 * closing one ends the token.
 *
 * @param  {string} text   The CSS value being read.
 * @param  {number} index  The index just past the opening parenthesis.
 * @return {number}        The index just past the closing parenthesis.
 */
function readPastUrlBody (text, index) {
  let end = index;
  while (end < text.length) {
    if (startsEscape(text, end)) {
      end = readPastEscape(text, end);
      continue;
    }
    if (text[end] === ')') {
      return end + 1;
    }
    end++;
  }
  return end;
}

/**
 * Reads the token that an identifier starts. An identifier directly followed by
 * an opening parenthesis is a function token instead, and the `url()` written
 * without quotes is a single token that swallows its own contents.
 *
 * @param  {string}   text   The CSS value being read.
 * @param  {number}   index  The index the identifier starts at.
 * @return {CssToken}        The ident, function, or url token.
 */
function readIdentLikeToken (text, index) {
  const nameEnd = readPastName(text, index);
  const name = text.slice(index, nameEnd);
  if (text[nameEnd] !== '(') {
    return { type: 'ident', text: name };
  }
  if (name.toLowerCase() === 'url' && !holdsQuotedUrl(text, nameEnd + 1)) {
    const urlEnd = readPastUrlBody(text, nameEnd + 1);
    return { type: 'url', text: text.slice(index, urlEnd) };
  }
  return { type: 'function', text: text.slice(index, nameEnd + 1) };
}

/**
 * Reads the string token at an index, which runs to the matching quote and
 * takes escaped quotes in its stride.
 *
 * @param  {string}   text   The CSS value being read.
 * @param  {number}   index  The index of the opening quote.
 * @return {CssToken}        The string token.
 */
function readStringToken (text, index) {
  const quote = text[index];
  let end = index + 1;
  while (end < text.length) {
    if (startsEscape(text, end)) {
      end = readPastEscape(text, end);
      continue;
    }
    if (text[end] === quote) {
      end++;
      break;
    }
    if (text[end] === '\n') {
      break;
    }
    end++;
  }
  return { type: 'string', text: text.slice(index, end) };
}

/**
 * Reads the run of whitespace at an index as the single token that CSS treats
 * it as.
 *
 * @param  {string}   text   The CSS value being read.
 * @param  {number}   index  The index the whitespace starts at.
 * @return {CssToken}        The whitespace token.
 */
function readWhitespaceToken (text, index) {
  let end = index;
  while (end < text.length && WHITESPACE_CHARACTER.test(text[end])) {
    end++;
  }
  return { type: 'whitespace', text: text.slice(index, end) };
}

/**
 * The characters that stand on their own as structural punctuation, none of
 * which can ever merge with the token beside it.
 *
 * @type {Set<string>}
 */
const PUNCTUATION_CHARACTERS = new Set(['(', ')', '[', ']', '{', '}', ',', ':', ';']);

/**
 * Reads the single token that starts at an index.
 *
 * @param  {string}   text   The CSS value being read.
 * @param  {number}   index  The index the token starts at.
 * @return {CssToken}        The token found at the index.
 */
function readToken (text, index) {
  const character = text[index];

  if (WHITESPACE_CHARACTER.test(character)) {
    return readWhitespaceToken(text, index);
  }
  if (character === '"' || character === '\'') {
    return readStringToken(text, index);
  }
  if (PUNCTUATION_CHARACTERS.has(character)) {
    return { type: 'punctuation', text: character };
  }
  if (character === '#') {
    const startsHash = NAME_CHARACTER.test(text[index + 1] || '') || startsEscape(text, index + 1);
    if (startsHash) {
      return { type: 'hash', text: text.slice(index, readPastName(text, index + 1)) };
    }
  }
  if (character === '@' && startsIdent(text, index + 1)) {
    return { type: 'at-keyword', text: text.slice(index, readPastName(text, index + 1)) };
  }
  if (startsNumber(text, index)) {
    return readNumericToken(text, index);
  }
  if (startsIdent(text, index)) {
    return readIdentLikeToken(text, index);
  }
  return { type: 'delim', text: character };
}

/**
 * Splits a CSS value into the tokens that the CSS Syntax tokenizer would read
 * out of it.
 *
 * @param  {string} value  The CSS value to tokenize.
 * @return {Array}         The tokens the value holds, in the order they appear.
 */
function tokenizeCssValue (value) {
  const tokens = [];
  let index = 0;
  while (index < value.length) {
    const token = readToken(value, index);
    tokens.push(token);
    index += Math.max(token.text.length, 1);
  }
  return tokens;
}

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

export { elideRedundantSeparators };
