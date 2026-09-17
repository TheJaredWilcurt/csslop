/**
 * @file Simplifies CSS light-dark functions whose light and dark values are equivalent.
 */

import {
  findMatchingParenthesis,
  skipQuotedString,
  splitTopLevelCommaList,
  startsUrlToken
} from '../parser/source-search.js';

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
 * Simplifies `light-dark(a,b)` to `a` when both top-level arguments are identical
 * after prior minification has normalized them.
 *
 * @param  {string} value  The CSS value to simplify.
 * @return {string}        The value with redundant light-dark functions removed.
 */
function simplifyEquivalentLightDarkFunctions (value) {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] === '"' || value[index] === '\'') {
      const end = skipQuotedString(value, index);
      result += value.slice(index, end);
      index = end;
      continue;
    }

    if (startsUrlToken(value, index)) {
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
      const argumentsList = splitTopLevelCommaList(argumentString);
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
