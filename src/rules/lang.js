/**
 * @file Minifies the `:lang()` pseudo-class, by writing each language-code in
 * its shortest valid form and by combining selectors that differ only in the
 * language-code they ask for.
 */

import {
  findMatchingParenthesis,
  skipParenthesizedGroup,
  splitTopLevel
} from '../parser/source-search.js';

import { findNextFunctionCallOutsideStrings } from './selectors.js';

/**
 * The `:lang()` pseudo-class opening, as it is written in minified output.
 * Pseudo-class names are case-insensitive, so the scan that looks for this
 * token ignores case, while everything written back out uses this spelling.
 *
 * @type {string}
 */
const LANGUAGE_FUNCTION = ':lang(';

/**
 * Matches a backslash escape of a character that cannot be read as the start
 * of a hexadecimal code point escape, and captures the character it escapes.
 *
 * @type {RegExp}
 */
const SINGLE_CHARACTER_ESCAPE = /\\([^0-9a-fA-F])/g;

/**
 * Matches a backslash followed by a hexadecimal digit, which starts a code
 * point escape whose meaning cannot be judged without decoding it.
 *
 * @type {RegExp}
 */
const CODE_POINT_ESCAPE = /\\[0-9a-fA-F]/;

/**
 * Matches a language-code holding a character that would end the code, or the
 * selector, if the code were written without quotes or escapes.
 *
 * @type {RegExp}
 */
const UNWRITABLE_CHARACTER = /[\s"'()\\]/;

/**
 * Matches a language-code whose first characters read as the beginning of a
 * number, which no unquoted identifier may do.
 *
 * @type {RegExp}
 */
const NUMERIC_START = /^-?[0-9]/;

/**
 * Matches a single character an identifier may hold as written.
 *
 * @type {RegExp}
 */
const IDENTIFIER_CHARACTER = /[a-zA-Z0-9_-]/;

/**
 * The first code point that is an identifier character in its own right, so
 * that letters beyond ASCII never need escaping.
 *
 * @type {number}
 */
const FIRST_NON_ASCII_CODE_POINT = 0x80;

/**
 * Reports whether a character has to be escaped to survive in an unquoted
 * language-code.
 *
 * @param  {string}  character  A single character of a language-code.
 * @return {boolean}            True when the character needs a backslash in front of it.
 */
function requiresEscape (character) {
  return (
    character.codePointAt(0) < FIRST_NON_ASCII_CODE_POINT &&
    !IDENTIFIER_CHARACTER.test(character)
  );
}

/**
 * Reads the plain language-code out of one `:lang()` argument, stripping the
 * quotes or escapes that were only there to let it be written. Arguments this
 * minifier cannot read with certainty, such as one holding a code point
 * escape, report no code so they are left exactly as their author wrote them.
 *
 * @param  {string}      argument  One argument of a `:lang()`, as written.
 * @return {string|null}           The language-code itself, or null when it cannot be read.
 */
function readLanguageCode (argument) {
  const text = argument.trim();
  if (!text || CODE_POINT_ESCAPE.test(text)) {
    return null;
  }
  const firstCharacter = text[0];
  const isQuoted = (
    (firstCharacter === '"' || firstCharacter === '\'') &&
    text.length > 1 &&
    text.endsWith(firstCharacter)
  );
  let code = text;
  if (isQuoted) {
    code = text.slice(1, -1);
  }
  code = code.replace(SINGLE_CHARACTER_ESCAPE, '$1');
  if (!code || UNWRITABLE_CHARACTER.test(code)) {
    return null;
  }
  return code;
}

/**
 * Writes a language-code in the shortest form a browser still reads as that
 * same code. A code of plain identifier characters needs nothing around it; a
 * code holding others is either escaped character by character or wrapped in
 * quotes once, whichever costs fewer characters.
 *
 * @param  {string} code  The language-code itself.
 * @return {string}       The shortest way to write the code inside a `:lang()`.
 */
function formatLanguageCode (code) {
  const quoted = '"' + code + '"';
  // A leading digit can only be escaped as a code point, which is never short
  if (NUMERIC_START.test(code)) {
    return quoted;
  }
  const escaped = [...code].map((character) => {
    if (requiresEscape(character)) {
      return '\\' + character;
    }
    return character;
  }).join('');
  if (escaped.length <= quoted.length) {
    return escaped;
  }
  return quoted;
}

/**
 * Rewrites the argument list of one `:lang()`, lowercasing every code because
 * language-codes are matched case-insensitively (one casing throughout a
 * stylesheet compresses better), dropping repeated codes, and writing each
 * remaining code in its shortest form.
 *
 * @param  {string}      argumentList  The text between the parentheses of a `:lang()`.
 * @return {string|null}               The minified argument list, or null when an argument could not be read.
 */
function minifyLanguageArguments (argumentList) {
  const codes = [];
  for (const argument of splitTopLevel(argumentList, ',')) {
    const code = readLanguageCode(argument);
    if (code === null) {
      return null;
    }
    codes.push(code.toLowerCase());
  }
  return [...new Set(codes)].map(formatLanguageCode).join(',');
}

/**
 * Locates every `:lang()` of a selector, reporting where each one starts,
 * where its argument list starts, and where it ends.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {Array}            One entry per `:lang()`, holding its `startIndex`, `openIndex`, and `closeIndex`.
 */
function findLanguageFunctions (selector) {
  const languageFunctions = [];
  let position = 0;
  while (position < selector.length) {
    const startIndex = findNextFunctionCallOutsideStrings(selector, LANGUAGE_FUNCTION, position);
    if (startIndex === -1) {
      break;
    }
    const openIndex = startIndex + LANGUAGE_FUNCTION.length - 1;
    const closeIndex = findMatchingParenthesis(selector, openIndex);
    if (closeIndex === -1) {
      break;
    }
    languageFunctions.push({
      closeIndex,
      openIndex,
      startIndex
    });
    position = closeIndex + 1;
  }
  return languageFunctions;
}

/**
 * Minifies every `:lang()` a selector holds.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {string}           The selector with each `:lang()` written in its shortest form.
 */
function minifyLanguageSelector (selector) {
  const languageFunctions = findLanguageFunctions(selector);
  if (!languageFunctions.length) {
    return selector;
  }
  let result = '';
  let index = 0;
  for (const languageFunction of languageFunctions) {
    const {
      closeIndex,
      openIndex,
      startIndex
    } = languageFunction;
    const minifiedArguments = minifyLanguageArguments(selector.slice(openIndex + 1, closeIndex));
    result += selector.slice(index, startIndex);
    if (minifiedArguments === null) {
      result += selector.slice(startIndex, closeIndex + 1);
    } else {
      result += LANGUAGE_FUNCTION + minifiedArguments + ')';
    }
    index = closeIndex + 1;
  }
  return result + selector.slice(index);
}

/**
 * Reports whether a position in a selector sits inside a functional
 * pseudo-class, such as the `:lang()` of `:not(:lang(en))`.
 *
 * @param  {string}  selector  A minified CSS selector string.
 * @param  {number}  index     The position to judge.
 * @return {boolean}           True when an enclosing parenthesis is still open at that position.
 */
function isInsideFunction (selector, index) {
  let position = 0;
  while (position < index) {
    if (selector[position] !== '(') {
      position++;
      continue;
    }
    const afterGroupIndex = skipParenthesizedGroup(selector, position);
    if (afterGroupIndex > index) {
      return true;
    }
    position = afterGroupIndex;
  }
  return false;
}

/**
 * Splits a selector into the text around its one and only `:lang()` and the
 * language-codes that `:lang()` asks for. A selector holding no `:lang()`, or
 * more than one, has no single list of codes to vary, and a `:lang()` nested
 * in another functional pseudo-class cannot have codes added to it without
 * changing what the pseudo-class it sits in means.
 *
 * @param  {string}      selector  A minified CSS selector string.
 * @return {object|null}           The `prefix`, `codes`, and `suffix` of the selector, or null when it has no lone top-level `:lang()`.
 */
function splitAroundLanguageCodes (selector) {
  const languageFunctions = findLanguageFunctions(selector);
  if (languageFunctions.length !== 1) {
    return null;
  }
  const {
    closeIndex,
    openIndex,
    startIndex
  } = languageFunctions[0];
  if (isInsideFunction(selector, startIndex)) {
    return null;
  }
  const codes = splitTopLevel(selector.slice(openIndex + 1, closeIndex), ',').map((code) => {
    return code.trim();
  });
  if (codes.some((code) => {
    return !code;
  })) {
    return null;
  }
  return {
    codes,
    prefix: selector.slice(0, startIndex),
    suffix: selector.slice(closeIndex + 1)
  };
}

/**
 * Combines the selectors of one rule that are identical but for the
 * language-codes of a single `:lang()`. A `:lang()` takes a comma-separated
 * list of codes and matches an element written in any of them, so the several
 * selectors say as one what they used to say apart, at the same specificity.
 *
 * @param  {Array} selectors  The rule's minified selector strings.
 * @return {Array}            The selector list with language-only variants combined.
 */
function combineLanguageSelectors (selectors) {
  const groupsBySurroundings = new Map();
  const result = [];
  for (const selector of selectors) {
    const parts = splitAroundLanguageCodes(selector);
    if (!parts) {
      result.push(selector);
      continue;
    }
    // The prefix and suffix are joined by a character no selector may hold, so
    // that text moving from one side to the other cannot look like a match
    const surroundings = parts.prefix + '\u0000' + parts.suffix;
    const existingGroup = groupsBySurroundings.get(surroundings);
    if (existingGroup) {
      existingGroup.codes.push(...parts.codes);
      continue;
    }
    groupsBySurroundings.set(surroundings, {
      codes: [...parts.codes],
      parts,
      position: result.length
    });
    result.push(selector);
  }
  for (const group of groupsBySurroundings.values()) {
    const codes = [...new Set(group.codes)];
    result[group.position] = group.parts.prefix + LANGUAGE_FUNCTION + codes.join(',') + ')' + group.parts.suffix;
  }
  return result;
}

export {
  combineLanguageSelectors,
  minifyLanguageSelector
};
