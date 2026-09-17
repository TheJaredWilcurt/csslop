/**
 * @file Locates delimiters in raw CSS text while ignoring the ones that sit inside strings, escapes, or parentheses.
 */

/**
 * Reads past a quoted string, starting at its opening quote, so that the
 * delimiters written inside the string are never mistaken for CSS syntax.
 * An unterminated string runs to the end of the text.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening quote character.
 * @return {number}            The index just past the closing quote.
 */
function skipQuotedString (source, openIndex) {
  const quoteCharacter = source[openIndex];
  let index = openIndex + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === quoteCharacter) {
      return index + 1;
    }
    index++;
  }
  return index;
}

/**
 * Reads past a parenthesized group, starting at its opening parenthesis, so
 * that the delimiters written inside a function such as `url(a;b)` stay part
 * of that function. An unclosed group runs to the end of the text.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index just past the matching closing parenthesis.
 */
function skipParenthesizedGroup (source, openIndex) {
  let index = openIndex + 1;
  let depth = 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '"' || character === '\'') {
      index = skipQuotedString(source, index);
      continue;
    }
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (!depth) {
        return index + 1;
      }
    }
    index++;
  }
  return index;
}

/**
 * Finds the first of several delimiter characters that is written at the top
 * level of the text, meaning it is not escaped, quoted, or nested inside a
 * function's parentheses.
 *
 * @param  {string} source      The raw CSS text being scanned.
 * @param  {string} delimiters  The delimiter characters to look for.
 * @param  {number} startIndex  The index to start scanning from.
 * @return {number}             The index of the first top-level delimiter, or -1 when there is none.
 */
function findTopLevelDelimiter (source, delimiters, startIndex) {
  let index = startIndex;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '"' || character === '\'') {
      index = skipQuotedString(source, index);
      continue;
    }
    if (character === '(') {
      index = skipParenthesizedGroup(source, index);
      continue;
    }
    if (delimiters.includes(character)) {
      return index;
    }
    index++;
  }
  return -1;
}

/**
 * Splits text on every top-level occurrence of a delimiter, keeping the
 * delimiters that are escaped, quoted, or parenthesized inside their part.
 *
 * @param  {string} text       The text to split.
 * @param  {string} delimiter  The delimiter character to split on.
 * @return {Array}             The parts of the text, without the delimiters.
 */
function splitTopLevel (text, delimiter) {
  const parts = [];
  let partStart = 0;
  let index = findTopLevelDelimiter(text, delimiter, 0);
  while (index !== -1) {
    parts.push(text.slice(partStart, index));
    partStart = index + 1;
    index = findTopLevelDelimiter(text, delimiter, partStart);
  }
  parts.push(text.slice(partStart));
  return parts;
}

export {
  findTopLevelDelimiter,
  splitTopLevel
};
