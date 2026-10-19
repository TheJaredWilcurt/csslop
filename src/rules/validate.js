/**
 * @file Rejects malformed selector syntax before rules can be merged.
 */

import {
  findMatchingBracket,
  findMatchingParenthesis,
  splitTopLevelCommaList
} from '../parser/source-search.js';
import { tokenizeCssValue } from '../parser/tokenizer.js';

/**
 * Reads an attribute name, optional matcher, value, and case flag.
 *
 * @param  {string}  attribute  The contents of the brackets.
 * @return {boolean}            Whether the attribute has a valid token sequence.
 */
function isValidAttribute (attribute) {
  const tokens = tokenizeCssValue(attribute).filter((token) => {
    return token.type !== 'whitespace';
  });
  let index = 0;
  if ((tokens[0]?.type === 'ident' || tokens[0]?.text === '*') && tokens[1]?.text === '|') {
    index = 2;
  } else if (tokens[0]?.text === '|') {
    index = 1;
  }
  if (tokens[index]?.type !== 'ident') {
    return false;
  }
  index++;
  if (index === tokens.length) {
    return true;
  }
  if (['~', '|', '^', '$', '*'].includes(tokens[index]?.text)) {
    index++;
  }
  if (tokens[index]?.text !== '=') {
    return false;
  }
  index++;
  if (tokens[index]?.type !== 'ident' && tokens[index]?.type !== 'string') {
    return false;
  }
  index++;
  if (tokens[index]?.type === 'ident' && ['i', 's'].includes(tokens[index].text.toLowerCase())) {
    index++;
  }
  return index === tokens.length;
}

/**
 * Checks that each language range is a single identifier or quoted string.
 *
 * @param  {string}  argumentsText  The language function's contents.
 * @return {boolean}                Whether every argument has valid syntax.
 */
function isValidLanguageList (argumentsText) {
  const argumentsList = splitTopLevelCommaList(argumentsText);
  return argumentsList.length > 0 && argumentsList.every((argument) => {
    const tokens = tokenizeCssValue(argument.trim());
    return tokens.length === 1 && (tokens[0].type === 'ident' || tokens[0].type === 'string');
  });
}

/**
 * Detects invalid tokens without interpreting data inside strings, escapes,
 * or forgiving selector lists as syntax of the surrounding selector.
 *
 * @param  {string}  selector  A single selector.
 * @return {boolean}           Whether its checked syntax is valid.
 */
function isValidSelector (selector) {
  const tokens = tokenizeCssValue(selector);
  let offset = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === '[' || token.type === 'function') {
      const isAttribute = token.text === '[';
      const openingIndex = isAttribute ? offset : offset + token.text.length - 1;
      const closingIndex = isAttribute ?
        findMatchingBracket(selector, openingIndex) :
        findMatchingParenthesis(selector, openingIndex);
      if (closingIndex === -1) {
        return false;
      }
      const inner = selector.slice(openingIndex + 1, closingIndex);
      const functionName = token.text.slice(0, -1).toLowerCase();
      if (isAttribute && !isValidAttribute(inner)) {
        return false;
      }
      if (functionName === 'lang' && !isValidLanguageList(inner)) {
        return false;
      }
      if (functionName === 'not' || functionName === 'has') {
        if (!splitTopLevelCommaList(inner).every(isValidSelector)) {
          return false;
        }
      }
      while (offset < closingIndex) {
        offset += tokens[index].text.length;
        index++;
      }
      offset += tokens[index].text.length;
      continue;
    }
    if (token.text === '|' && tokens[index + 1]?.text === '|') {
      return false;
    }
    if (token.text === ':') {
      let followingIndex = index + 1;
      if (tokens[followingIndex]?.text === ':') {
        followingIndex++;
      }
      const following = tokens[followingIndex];
      if (following?.type !== 'ident' && following?.type !== 'function') {
        return false;
      }
    }
    offset += token.text.length;
  }
  return true;
}

/**
 * Removes an entire unforgiving selector list if any branch is malformed.
 *
 * @param  {Array} rules  Stylesheet or nested body entries.
 * @return {Array}        Entries that cannot poison a valid rule during merging.
 */
function removeInvalidSelectorRules (rules) {
  return rules.filter((rule) => {
    return !rule.selectors || rule.selectors.every(isValidSelector);
  }).map((rule) => {
    if (rule.rules) {
      rule.rules = removeInvalidSelectorRules(rule.rules);
    }
    if (rule.declarations) {
      rule.declarations = removeInvalidSelectorRules(rule.declarations);
    }
    return rule;
  });
}

export { removeInvalidSelectorRules };
