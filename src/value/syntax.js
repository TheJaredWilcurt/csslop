/**
 * @file Provides syntax-aware CSS string scanning utilities.
 */

/**
 * Finds the closing parenthesis for an opening parenthesis while respecting
 * nested parentheses and quoted strings.
 *
 * @param  {string} value           The CSS text being scanned.
 * @param  {number} openParenIndex  The index of the opening `(` character.
 * @return {number}                 The closing `)` index, or -1 if unmatched.
 */
function findMatchingParenthesis (value, openParenIndex) {
  let depth = 1;
  let index = openParenIndex + 1;
  let activeQuote = '';

  while (index < value.length) {
    const character = value[index];
    if (activeQuote) {
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === activeQuote) {
        activeQuote = '';
      }
      index++;
      continue;
    }

    if (character === '"' || character === '\'') {
      activeQuote = character;
      index++;
      continue;
    }

    if (character === '(') {
      depth++;
      index++;
      continue;
    }

    if (character === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
    index++;
  }

  return -1;
}

/**
 * Splits a CSS value into its top-level components, keeping parenthesized
 * function arguments and quoted strings intact. Components are separated by
 * whitespace, or by a `#`, which always starts a hash token and therefore ends
 * any component already in progress.
 *
 * For example, `rgb(0 0 0) red` yields `["rgb(0 0 0)", "red"]`, and the
 * minified `red#00f` yields `["red", "#00f"]`.
 *
 * @param  {string} value  The CSS value to split.
 * @return {Array}         The top-level components of the value.
 */
function splitTopLevelComponents (value) {
  const components = [];
  let current = '';
  let depth = 0;
  let activeQuote = '';
  let index = 0;

  while (index < value.length) {
    const character = value[index];

    if (activeQuote) {
      current += character;
      if (character === '\\') {
        current += value[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (character === activeQuote) {
        activeQuote = '';
      }
      index++;
      continue;
    }

    if (character === '"' || character === '\'') {
      activeQuote = character;
      current += character;
      index++;
      continue;
    }

    if (character === '(') {
      depth++;
    }
    if (character === ')' && depth > 0) {
      depth--;
    }

    // Match any whitespace character, which separates components at depth zero
    const isSeparator = depth === 0 && /\s/.test(character);
    if (isSeparator) {
      if (current) {
        components.push(current);
        current = '';
      }
      index++;
      continue;
    }

    const startsHashToken = character === '#' && depth === 0 && current !== '';
    if (startsHashToken) {
      components.push(current);
      current = '';
    }

    current += character;
    index++;
  }

  if (current) {
    components.push(current);
  }

  return components;
}

export {
  findMatchingParenthesis,
  splitTopLevelComponents
};
