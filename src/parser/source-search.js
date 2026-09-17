/**
 * @file Locates the delimiters, groups, and tokens of raw CSS text, ignoring the delimiters that sit inside strings, escapes, or the parentheses and brackets of a group.
 */

/**
 * The characters that separate the top-level components of a CSS value: the
 * five characters CSS counts as whitespace, and the hash that always begins a
 * token of its own.
 *
 * @type {string}
 */
const COMPONENT_SEPARATORS = ' \t\n\r\f#';

/**
 * Determines whether a character opens a quoted string.
 *
 * @param  {string}  character  The character to test.
 * @return {boolean}            Whether a quoted string starts here.
 */
function isQuote (character) {
  return character === '"' || character === '\'';
}

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
 * Finds the character that closes the group opened at the given index, so that
 * the delimiters written inside a group such as `url(a;b)` stay part of it.
 * Strings, escapes, and groups of the same kind nested within it are read past
 * on the way.
 *
 * @param  {string} source          The raw CSS text being scanned.
 * @param  {number} openIndex       The index of the character that opens the group.
 * @param  {string} closeCharacter  The character that closes the group.
 * @return {number}                 The index of the closing character, or -1 when the group never closes.
 */
function findGroupClose (source, openIndex, closeCharacter) {
  const openCharacter = source[openIndex];
  let depth = 1;
  let index = openIndex + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (isQuote(character)) {
      index = skipQuotedString(source, index);
      continue;
    }
    if (character === openCharacter) {
      depth++;
    } else if (character === closeCharacter) {
      depth--;
      if (!depth) {
        return index;
      }
    }
    index++;
  }
  return -1;
}

/**
 * Finds the parenthesis closing the one at the given index.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the matching closing parenthesis, or -1 when it never closes.
 */
function findMatchingParenthesis (source, openIndex) {
  return findGroupClose(source, openIndex, ')');
}

/**
 * Finds the bracket closing the one at the given index.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening bracket.
 * @return {number}            The index of the matching closing bracket, or -1 when it never closes.
 */
function findMatchingBracket (source, openIndex) {
  return findGroupClose(source, openIndex, ']');
}

/**
 * Reads past a group, starting at the character that opens it. A group that
 * never closes runs to the end of the text.
 *
 * @param  {string} source          The raw CSS text being scanned.
 * @param  {number} openIndex       The index of the character that opens the group.
 * @param  {string} closeCharacter  The character that closes the group.
 * @return {number}                 The index just past the end of the group.
 */
function skipGroup (source, openIndex, closeCharacter) {
  const closeIndex = findGroupClose(source, openIndex, closeCharacter);
  if (closeIndex === -1) {
    return source.length;
  }
  return closeIndex + 1;
}

/**
 * Reads past a parenthesized group, such as the arguments of a function.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index just past the matching closing parenthesis.
 */
function skipParenthesizedGroup (source, openIndex) {
  return skipGroup(source, openIndex, ')');
}

/**
 * Reads past a bracketed group, which in a selector is an attribute selector
 * and in a value is a set of grid line names.
 *
 * @param  {string} source     The raw CSS text being scanned.
 * @param  {number} openIndex  The index of the opening bracket.
 * @return {number}            The index just past the matching closing bracket.
 */
function skipBracketedGroup (source, openIndex) {
  return skipGroup(source, openIndex, ']');
}

/**
 * Determines whether a `url()` token begins at the given index. The contents
 * of one are a URL rather than CSS syntax, so a pass that rewrites a value
 * reads past a `url()` instead of into it.
 *
 * @param  {string}  source  The raw CSS text being scanned.
 * @param  {number}  index   The index to test.
 * @return {boolean}         Whether a `url()` token starts here.
 */
function startsUrlToken (source, index) {
  return source.slice(index, index + 4).toLowerCase() === 'url(';
}

/**
 * Finds the first of several delimiter characters that is written at the top
 * level of the text, meaning it is not escaped, quoted, or nested inside a
 * group.
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
    if (isQuote(character)) {
      index = skipQuotedString(source, index);
      continue;
    }
    if (character === '(') {
      index = skipParenthesizedGroup(source, index);
      continue;
    }
    if (character === '[') {
      index = skipBracketedGroup(source, index);
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
 * Splits text on every top-level occurrence of any of the delimiters, keeping
 * the delimiters that are escaped, quoted, or nested inside a group within
 * their part.
 *
 * @param  {string} text        The text to split.
 * @param  {string} delimiters  The delimiter characters to split on.
 * @return {Array}              The parts of the text, without the delimiters.
 */
function splitTopLevel (text, delimiters) {
  const parts = [];
  let partStart = 0;
  let index = findTopLevelDelimiter(text, delimiters, 0);
  while (index !== -1) {
    parts.push(text.slice(partStart, index));
    partStart = index + 1;
    index = findTopLevelDelimiter(text, delimiters, partStart);
  }
  parts.push(text.slice(partStart));
  return parts;
}

/**
 * Splits a comma-separated list, such as the arguments of a function or the
 * selectors of a rule, into its trimmed parts. A list with nothing in it has
 * no parts at all.
 *
 * @param  {string} text  The comma-separated text to split.
 * @return {Array}        The parts of the list, trimmed of the whitespace written around them.
 */
function splitTopLevelCommaList (text) {
  if (!text.trim()) {
    return [];
  }
  return splitTopLevel(text, ',').map((part) => {
    return part.trim();
  });
}

/**
 * Splits a CSS value into its top-level components, keeping the arguments of a
 * function and the contents of a quoted string intact. Components are
 * separated by whitespace, or by a `#`, which always starts a hash token and
 * therefore ends any component already in progress.
 *
 * For example, `rgb(0 0 0) red` yields `["rgb(0 0 0)", "red"]`, and the
 * minified `red#00f` yields `["red", "#00f"]`.
 *
 * @param  {string} value  The CSS value to split.
 * @return {Array}         The top-level components of the value.
 */
function splitTopLevelComponents (value) {
  const components = [];
  let componentStart = 0;
  let separatorIndex = findTopLevelDelimiter(value, COMPONENT_SEPARATORS, 0);
  while (separatorIndex !== -1) {
    const component = value.slice(componentStart, separatorIndex);
    if (component) {
      components.push(component);
    }
    // A hash belongs to the token it starts, so it is not consumed as a separator
    if (value[separatorIndex] === '#') {
      componentStart = separatorIndex;
    } else {
      componentStart = separatorIndex + 1;
    }
    separatorIndex = findTopLevelDelimiter(value, COMPONENT_SEPARATORS, separatorIndex + 1);
  }
  const lastComponent = value.slice(componentStart);
  if (lastComponent) {
    components.push(lastComponent);
  }
  return components;
}

export {
  findMatchingBracket,
  findMatchingParenthesis,
  findTopLevelDelimiter,
  skipBracketedGroup,
  skipParenthesizedGroup,
  skipQuotedString,
  splitTopLevel,
  splitTopLevelCommaList,
  splitTopLevelComponents,
  startsUrlToken
};
