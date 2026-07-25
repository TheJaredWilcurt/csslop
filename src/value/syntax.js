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

export { findMatchingParenthesis };
