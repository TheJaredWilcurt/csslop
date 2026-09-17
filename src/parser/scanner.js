/**
 * @file Reads a CSS source string one token at a time, keeping track of how far into the text the parser has gotten.
 */

/**
 * The character codes the parser compares against while scanning. Comparing
 * numeric codes avoids building a one-character string for every character of
 * the stylesheet.
 */
const CHARACTER_CODE = {
  tab: 9,
  lineFeed: 10,
  formFeed: 12,
  carriageReturn: 13,
  space: 32,
  asterisk: 42,
  comma: 44,
  slash: 47,
  colon: 58,
  semicolon: 59,
  atSign: 64,
  openBrace: 123,
  closeBrace: 125
};

/**
 * Determines whether a character code is one of the five characters CSS counts
 * as whitespace.
 *
 * @param  {number}  characterCode  The character code to test.
 * @return {boolean}                Whether the character is CSS whitespace.
 */
function isWhitespaceCode (characterCode) {
  return (
    characterCode === CHARACTER_CODE.space ||
    characterCode === CHARACTER_CODE.lineFeed ||
    characterCode === CHARACTER_CODE.tab ||
    characterCode === CHARACTER_CODE.carriageReturn ||
    characterCode === CHARACTER_CODE.formFeed
  );
}

/**
 * Creates the reader the parser advances through the stylesheet with.
 *
 * @param  {string} source  The raw CSS text to read.
 * @return {object}         The scanner, positioned at the start of the text.
 */
function createScanner (source) {
  return {
    source,
    index: 0
  };
}

/**
 * Determines whether the scanner has any text left to read.
 *
 * @param  {object}  scanner  The scanner to check.
 * @return {boolean}          Whether text remains.
 */
function hasMoreInput (scanner) {
  return scanner.index < scanner.source.length;
}

/**
 * Reads the character code at an offset from the scanner's position without
 * advancing it. Reading past the end of the text reports `NaN`, which fails
 * every comparison, so the end of input needs no separate check.
 *
 * @param  {object} scanner  The scanner to read from.
 * @param  {number} offset   How far ahead of the current position to read.
 * @return {number}          The character code at that position.
 */
function characterCodeAt (scanner, offset = 0) {
  return scanner.source.charCodeAt(scanner.index + offset);
}

/**
 * Advances the scanner past any run of whitespace.
 *
 * @param {object} scanner  The scanner to advance.
 */
function skipWhitespace (scanner) {
  while (isWhitespaceCode(scanner.source.charCodeAt(scanner.index))) {
    scanner.index++;
  }
}

/**
 * Advances the scanner past the semicolons and whitespace that separate a
 * declaration from whatever follows it.
 *
 * @param {object} scanner  The scanner to advance.
 */
function skipSemicolonsAndWhitespace (scanner) {
  let characterCode = scanner.source.charCodeAt(scanner.index);
  while (isWhitespaceCode(characterCode) || characterCode === CHARACTER_CODE.semicolon) {
    scanner.index++;
    characterCode = scanner.source.charCodeAt(scanner.index);
  }
}

/**
 * Advances the scanner to an absolute index, returning the text that was
 * passed over.
 *
 * @param  {object} scanner   The scanner to advance.
 * @param  {number} endIndex  The index to stop at.
 * @return {string}           The text between the old and the new position.
 */
function consumeTo (scanner, endIndex) {
  const text = scanner.source.slice(scanner.index, endIndex);
  scanner.index = endIndex;
  return text;
}

/**
 * Applies a sticky pattern at the scanner's position without advancing it, so
 * the parser can decide what it is looking at before committing to reading it.
 *
 * @param  {object}             scanner  The scanner to read from.
 * @param  {RegExp}             pattern  A sticky pattern to apply at the current position.
 * @return {Array<string>|null}          The match, or null when the pattern does not apply.
 */
function peekPattern (scanner, pattern) {
  pattern.lastIndex = scanner.index;
  return pattern.exec(scanner.source);
}

/**
 * Applies a sticky pattern at the scanner's position, advancing past whatever
 * it matched.
 *
 * @param  {object}             scanner  The scanner to read from.
 * @param  {RegExp}             pattern  A sticky pattern to apply at the current position.
 * @return {Array<string>|null}          The match, or null when the pattern does not apply.
 */
function consumePattern (scanner, pattern) {
  const match = peekPattern(scanner, pattern);
  if (match) {
    scanner.index += match[0].length;
  }
  return match;
}

/**
 * Consumes a single expected character, reporting whether it was there.
 *
 * @param  {object}  scanner        The scanner to advance.
 * @param  {number}  characterCode  The character code that is expected.
 * @return {boolean}                Whether the character was found and consumed.
 */
function consumeCharacter (scanner, characterCode) {
  if (scanner.source.charCodeAt(scanner.index) !== characterCode) {
    return false;
  }
  scanner.index++;
  return true;
}

/**
 * Consumes an opening brace along with the whitespace that follows it.
 *
 * @param  {object}  scanner  The scanner to advance.
 * @return {boolean}          Whether a block was opened.
 */
function consumeOpenBrace (scanner) {
  if (!consumeCharacter(scanner, CHARACTER_CODE.openBrace)) {
    return false;
  }
  skipWhitespace(scanner);
  return true;
}

/**
 * Consumes a closing brace.
 *
 * @param  {object}  scanner  The scanner to advance.
 * @return {boolean}          Whether a block was closed.
 */
function consumeCloseBrace (scanner) {
  return consumeCharacter(scanner, CHARACTER_CODE.closeBrace);
}

/**
 * Consumes a colon along with the whitespace that follows it.
 *
 * @param  {object}  scanner  The scanner to advance.
 * @return {boolean}          Whether a colon was found and consumed.
 */
function consumeColon (scanner) {
  if (!consumeCharacter(scanner, CHARACTER_CODE.colon)) {
    return false;
  }
  skipWhitespace(scanner);
  return true;
}

/**
 * Consumes a comma along with the whitespace that follows it.
 *
 * @param  {object}  scanner  The scanner to advance.
 * @return {boolean}          Whether a comma was found and consumed.
 */
function consumeComma (scanner) {
  if (!consumeCharacter(scanner, CHARACTER_CODE.comma)) {
    return false;
  }
  skipWhitespace(scanner);
  return true;
}

export {
  CHARACTER_CODE,
  characterCodeAt,
  consumeCharacter,
  consumeCloseBrace,
  consumeColon,
  consumeComma,
  consumeOpenBrace,
  consumePattern,
  consumeTo,
  createScanner,
  hasMoreInput,
  peekPattern,
  skipSemicolonsAndWhitespace,
  skipWhitespace
};
