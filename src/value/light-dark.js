/**
 * @file Simplifies CSS light-dark functions whose light and dark values are equivalent.
 */

import { findMatchingParenthesis } from './syntax.js';

/**
 * Determines whether a character can appear inside a CSS identifier.
 *
 * @param  {string}  character  A single character.
 * @return {boolean}            True when the character is identifier-like.
 */
function isIdentifierCharacter (character) {
  if (!character) {
    return false;
  }
  const codePoint = character.charCodeAt(0);
  const isUppercaseLetter = codePoint >= 65 && codePoint <= 90;
  const isLowercaseLetter = codePoint >= 97 && codePoint <= 122;
  const isDigit = codePoint >= 48 && codePoint <= 57;
  return isUppercaseLetter || isLowercaseLetter || isDigit || character === '_' || character === '-';
}

/**
 * Detects a `light-dark(` function call at the provided position.
 *
 * @param  {string}  value  The CSS value being scanned.
 * @param  {number}  index  The candidate start index.
 * @return {boolean}        True when a light-dark function starts at index.
 */
function startsLightDarkFunction (value, index) {
  if (value.slice(index, index + 11).toLowerCase() !== 'light-dark(') {
    return false;
  }
  return !isIdentifierCharacter(value[index - 1]);
}

/**
 * Splits a CSS function argument list at top-level commas while respecting
 * nested parentheses and quoted strings.
 *
 * @param  {string} argumentString  The raw content between function parentheses.
 * @return {Array}                  The top-level argument strings.
 */
function splitTopLevelFunctionArguments (argumentString) {
  const argumentsList = [];
  let currentArgument = '';
  let depth = 0;
  let index = 0;
  let activeQuote = '';

  while (index < argumentString.length) {
    const character = argumentString[index];
    if (activeQuote) {
      currentArgument += character;
      if (character === '\\') {
        if (index + 1 < argumentString.length) {
          currentArgument += argumentString[index + 1];
          index += 2;
          continue;
        }
      } else if (character === activeQuote) {
        activeQuote = '';
      }
      index++;
      continue;
    }

    if (character === '"' || character === '\'') {
      activeQuote = character;
      currentArgument += character;
      index++;
      continue;
    }

    if (character === '(') {
      depth++;
      currentArgument += character;
      index++;
      continue;
    }

    if (character === ')') {
      if (depth > 0) {
        depth--;
      }
      currentArgument += character;
      index++;
      continue;
    }

    if (character === ',' && depth === 0) {
      argumentsList.push(currentArgument.trim());
      currentArgument = '';
      index++;
      continue;
    }

    currentArgument += character;
    index++;
  }

  argumentsList.push(currentArgument.trim());
  return argumentsList;
}

/**
 * Simplifies `light-dark(a,b)` to `a` when both top-level arguments are identical
 * after prior minification has normalized them.
 *
 * @param  {string} value  The CSS value to simplify.
 * @return {string}        The value with redundant light-dark functions removed.
 */
function simplifyEquivalentLightDarkFunctions (value) {
  let result = '';
  let index = 0;

  const consumeQuoted = (start) => {
    const quote = value[start];
    let end = start + 1;
    while (end < value.length) {
      if (value[end] === '\\') {
        end += 2;
        continue;
      }
      if (value[end] === quote) {
        end++;
        break;
      }
      end++;
    }
    return end;
  };

  const startsUrl = (start) => {
    return value.slice(start, start + 4).toLowerCase() === 'url(';
  };

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = consumeQuoted(index);
      result += value.slice(index, end);
      index = end;
      continue;
    }

    if (startsUrl(index)) {
      const end = findMatchingParenthesis(value, index + 3);
      if (end === -1) {
        result += value.slice(index);
        break;
      }
      result += value.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (startsLightDarkFunction(value, index)) {
      const openParenIndex = index + 10;
      const closingParenIndex = findMatchingParenthesis(value, openParenIndex);
      if (closingParenIndex === -1) {
        result += value.slice(index);
        break;
      }

      const argumentString = value.slice(openParenIndex + 1, closingParenIndex);
      const argumentsList = splitTopLevelFunctionArguments(argumentString);
      if (argumentsList.length === 2) {
        const firstArgument = simplifyEquivalentLightDarkFunctions(argumentsList[0]);
        const secondArgument = simplifyEquivalentLightDarkFunctions(argumentsList[1]);
        if (firstArgument === secondArgument) {
          result += firstArgument;
        } else {
          result += value.slice(index, openParenIndex + 1) + firstArgument + ',' + secondArgument + ')';
        }
        index = closingParenIndex + 1;
        continue;
      }
    }

    result += value[index];
    index++;
  }

  return result;
}

export { simplifyEquivalentLightDarkFunctions };
