/**
 * @file Reads a CSS value as the sequence of tokens that the CSS Syntax tokenizer reads out of it, so that what a value is made of can be judged token by token rather than character by character.
 */

import { isWhitespaceCode } from './scanner.js';

/**
 * The character codes the tokenizer classifies characters by. Every value is
 * read one character at a time, so comparing numeric codes avoids running a
 * regular expression once per character.
 */
const CHARACTER_CODE = {
  hyphen: 45,
  digitZero: 48,
  digitNine: 57,
  uppercaseA: 65,
  uppercaseF: 70,
  uppercaseZ: 90,
  underscore: 95,
  lowercaseA: 97,
  lowercaseF: 102,
  lowercaseZ: 122,
  firstNonAscii: 128
};

/**
 * Reports whether the character at an index is one of the five characters CSS
 * counts as whitespace. CSS counts a form feed and a carriage return as
 * whitespace, so the shorter `\s` class would be too broad. An index past the
 * end of the text reads as `NaN`, which is never whitespace.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the character to test.
 * @return {boolean}        Whether the character is CSS whitespace.
 */
function isWhitespaceAt (text, index) {
  return isWhitespaceCode(text.charCodeAt(index));
}

/**
 * Reports whether a character code is a decimal digit, which is what starts
 * the numeric tokens.
 *
 * @param  {number}  characterCode  The UTF-16 code unit of the character.
 * @return {boolean}                True for `0`-`9`.
 */
function isDigitCode (characterCode) {
  return characterCode >= CHARACTER_CODE.digitZero && characterCode <= CHARACTER_CODE.digitNine;
}

/**
 * Reports whether the character at an index is a decimal digit. An index past
 * the end of the text is never a digit.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the character to test.
 * @return {boolean}        Whether the character is a decimal digit.
 */
function isDigitAt (text, index) {
  return isDigitCode(text.charCodeAt(index));
}

/**
 * Reports whether the character at an index is a hexadecimal digit, which is
 * what a unicode escape holds.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the character to test.
 * @return {boolean}        True for `0`-`9`, `a`-`f`, and `A`-`F`.
 */
function isHexDigitAt (text, index) {
  const characterCode = text.charCodeAt(index);
  return (
    isDigitCode(characterCode) ||
    (characterCode >= CHARACTER_CODE.lowercaseA && characterCode <= CHARACTER_CODE.lowercaseF) ||
    (characterCode >= CHARACTER_CODE.uppercaseA && characterCode <= CHARACTER_CODE.uppercaseF)
  );
}

/**
 * Reports whether a character code may start an identifier: a letter, an
 * underscore, or anything outside ASCII.
 *
 * @param  {number}  characterCode  The UTF-16 code unit of the character.
 * @return {boolean}                Whether the character may start an identifier.
 */
function isIdentStartCode (characterCode) {
  return (
    (characterCode >= CHARACTER_CODE.lowercaseA && characterCode <= CHARACTER_CODE.lowercaseZ) ||
    (characterCode >= CHARACTER_CODE.uppercaseA && characterCode <= CHARACTER_CODE.uppercaseZ) ||
    characterCode === CHARACTER_CODE.underscore ||
    characterCode >= CHARACTER_CODE.firstNonAscii
  );
}

/**
 * Reports whether the character at an index may start an identifier. An index
 * past the end of the text never does.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the character to test.
 * @return {boolean}        Whether the character may start an identifier.
 */
function isIdentStartAt (text, index) {
  return isIdentStartCode(text.charCodeAt(index));
}

/**
 * Reports whether the character at an index may continue an identifier, which
 * is everything an identifier may start with plus the digits and the hyphen.
 * An index past the end of the text never does.
 *
 * @param  {string}  text   The CSS value being read.
 * @param  {number}  index  The index of the character to test.
 * @return {boolean}        Whether the character may continue an identifier.
 */
function isNameCharacterAt (text, index) {
  const characterCode = text.charCodeAt(index);
  return (
    isIdentStartCode(characterCode) ||
    isDigitCode(characterCode) ||
    characterCode === CHARACTER_CODE.hyphen
  );
}

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
  while (end < text.length && hexDigitCount < 6 && isHexDigitAt(text, end)) {
    end++;
    hexDigitCount++;
  }
  if (!hexDigitCount) {
    return Math.min(end + 1, text.length);
  }
  if (end < text.length && isWhitespaceAt(text, end)) {
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
    if (isNameCharacterAt(text, end)) {
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
    return Boolean(nextCharacter) && (isIdentStartAt(text, index + 1) || startsEscape(text, index + 1));
  }
  if (isIdentStartAt(text, index)) {
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
    return isDigitAt(text, index + 1) || (nextCharacter === '.' && isDigitAt(text, index + 2));
  }
  if (character === '.') {
    return isDigitAt(text, index + 1);
  }
  return isDigitAt(text, index);
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
  while (end < text.length && isDigitAt(text, end)) {
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
  if (text[end] === '.' && isDigitAt(text, end + 1)) {
    end = readPastDigits(text, end + 1);
  }
  const exponentCharacter = text[end];
  if (exponentCharacter === 'e' || exponentCharacter === 'E') {
    let exponentEnd = end + 1;
    if (text[exponentEnd] === '+' || text[exponentEnd] === '-') {
      exponentEnd++;
    }
    if (isDigitAt(text, exponentEnd)) {
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
  while (end < text.length && isWhitespaceAt(text, end)) {
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
  while (end < text.length && isWhitespaceAt(text, end)) {
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

  if (isWhitespaceAt(text, index)) {
    return readWhitespaceToken(text, index);
  }
  if (character === '"' || character === '\'') {
    return readStringToken(text, index);
  }
  if (PUNCTUATION_CHARACTERS.has(character)) {
    return { type: 'punctuation', text: character };
  }
  if (character === '#') {
    const startsHash = isNameCharacterAt(text, index + 1) || startsEscape(text, index + 1);
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

export { tokenizeCssValue };
