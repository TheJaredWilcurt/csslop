/**
 * @file Rewrites CSS times in whichever of seconds or milliseconds spells them shortest.
 */

import { tokenizeCssValue } from '../parser/tokenizer.js';

import {
  formatShortestNumber,
  parseNumericParts,
  scaleByPowerOfTen,
  shortenNumericText
} from './numbers.js';

/**
 * The power of ten that separates a time in seconds from the same time in
 * milliseconds, keyed by the lowercased time unit.
 *
 * @type {{[unit: string]: number}}
 */
const TIME_UNIT_POWERS = {
  s: 0,
  ms: -3
};

/**
 * Rewrites one time token in whichever of seconds or milliseconds spells it
 * shortest, scientific notation included. Every conversion moves the exponent
 * of the exact digits, so no precision is lost however large the time is.
 * Seconds win a tie, and a zero time becomes `0s`.
 *
 * @param  {string} text  The text of a dimension token.
 * @return {string}       The shortest spelling of the same time.
 */
function shortenTimeToken (text) {
  const parts = parseNumericParts(text);
  const writtenUnit = parts?.unit.toLowerCase();
  if (!parts || !(writtenUnit in TIME_UNIT_POWERS)) {
    return text;
  }
  if (!parts.digits) {
    return '0s';
  }
  const writtenSpelling = shortenNumericText(text, true);
  const secondsSpelling = formatShortestNumber(
    scaleByPowerOfTen(parts, TIME_UNIT_POWERS[writtenUnit], 's'),
    true
  );
  const millisecondsSpelling = formatShortestNumber(
    scaleByPowerOfTen(parts, TIME_UNIT_POWERS[writtenUnit] - TIME_UNIT_POWERS.ms, 'ms'),
    true
  );
  // Seconds are the conventional unit, so they win a tie with milliseconds
  const convertedSpelling = millisecondsSpelling.length < secondsSpelling.length ? millisecondsSpelling : secondsSpelling;
  return convertedSpelling.length <= writtenSpelling.length ? convertedSpelling : writtenSpelling;
}

/**
 * Converts each time in a value between seconds and milliseconds, whichever
 * is the shorter string.
 *
 * @param  {string} value  The CSS value string potentially containing time values.
 * @return {string}        The value with each time in its shortest unit.
 */
function convertTimesToShortestUnit (value) {
  return tokenizeCssValue(value).map((token) => {
    if (token.type !== 'dimension') {
      return token.text;
    }
    return shortenTimeToken(token.text);
  }).join('');
}

export {
  convertTimesToShortestUnit
};
