/**
 * @file Evaluates and minifies CSS relative color syntax.
 */

import {
  parseColor,
  rgbaToHex,
  shortestColor
} from './colors.js';
import { parseAlphaString } from './shared.js';

/**
 * Handle color(from ...) relative color syntax for simple identity cases.
 *
 * @param  {string}      expr  The color(from ...) expression string.
 * @return {string|null}       A hex color string if the relative color is a simple identity transform, or null otherwise.
 */
function evaluateRelativeColor (expr) {
  // Match: color(from <base-color> srgb r g b [/ <alpha>]) identity transform pattern
  const match = expr.match(/^color\(\s*from\s+(.+?)\s+srgb\s+r\s+g\s+b(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (!match) {
    return null;
  }
  const baseColor = parseColor(match[1]);
  if (!baseColor) {
    return null;
  }
  const alpha = parseAlphaString(match[2], baseColor[3]);
  return rgbaToHex(baseColor[0], baseColor[1], baseColor[2], alpha);
}

/**
 * Canonical channel keyword order for each relative-color function. When the
 * channel expressions in a `<func>(from <color> ...)` match this order exactly,
 * the function reproduces the base color unchanged (an identity transform).
 *
 * @type {{[key: string]: Array<string>}}
 */
const RELATIVE_COLOR_CHANNELS = {
  rgb: ['r', 'g', 'b'],
  rgba: ['r', 'g', 'b'],
  hsl: ['h', 's', 'l'],
  hsla: ['h', 's', 'l'],
  hwb: ['h', 'w', 'b'],
  lab: ['l', 'a', 'b'],
  oklab: ['l', 'a', 'b'],
  lch: ['l', 'c', 'h'],
  oklch: ['l', 'c', 'h']
};

/**
 * Finds the closing parenthesis matching the opening one at the given index,
 * accounting for nested parentheses.
 *
 * @param  {string} value      The string being scanned.
 * @param  {number} openIndex  Index of the opening parenthesis.
 * @return {number}            Index of the matching close parenthesis, or -1.
 */
function findClosingParenthesis (value, openIndex) {
  let depth = 1;
  let index = openIndex + 1;
  while (index < value.length) {
    const character = value[index];
    if (character === '(') {
      depth++;
    } else if (character === ')') {
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
 * Splits a string on top-level whitespace while treating each parenthesized
 * group as part of a single token, keeping nested function arguments intact.
 *
 * @param  {string} text  The text to split.
 * @return {Array}        The list of top-level tokens.
 */
function splitTopLevelWhitespace (text) {
  const tokens = [];
  let current = '';
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '(') {
      depth++;
      current += character;
    } else if (character === ')') {
      if (depth > 0) {
        depth--;
      }
      current += character;
      // Match any single whitespace character at the top level
    } else if (depth === 0 && /\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Splits a relative-color body into its channel portion and its optional alpha
 * portion at the top-level `/` separator.
 *
 * @param  {string} body  The body of a relative color, after the base color.
 * @return {Array}        A two-element array of [channelsPart, alphaPart|null].
 */
function splitRelativeAlpha (body) {
  let depth = 0;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      if (depth > 0) {
        depth--;
      }
    } else if (character === '/' && depth === 0) {
      return [body.slice(0, index).trim(), body.slice(index + 1).trim()];
    }
  }
  return [body.trim(), null];
}

/**
 * Removes redundant leading zeros from a plain numeric token (e.g. `0.6` → `.6`).
 *
 * @param  {string} token  A candidate numeric token.
 * @return {string}        The token with redundant leading zeros stripped.
 */
function stripLeadingZeroFromNumber (token) {
  // Match an optional sign, redundant leading zeros, then a decimal fraction
  const match = token.match(/^(-?)0*(\.\d+)$/);
  if (match) {
    return match[1] + match[2];
  }
  return token;
}

/**
 * Determines whether a channel expression is a single value that can safely
 * leave a surrounding calc() wrapper: a channel keyword or a plain number.
 *
 * @param  {string}  token  The simplified channel expression.
 * @return {boolean}        Whether the token can stand alone without calc().
 */
function isBareChannelToken (token) {
  // A run of letters (a channel keyword) or a plain signed number
  return (/^[a-z]+$/i).test(token) || (/^-?(?:\d*\.\d+|\d+)$/).test(token);
}

/**
 * Simplifies a single relative-color channel expression by resolving arithmetic
 * identities inside calc() and unwrapping calc() when it holds a lone value.
 *
 * @param  {string} channel  The raw channel expression.
 * @return {string}          The simplified channel expression.
 */
function simplifyRelativeChannel (channel) {
  const calcMatch = channel.match(/^calc\((.*)\)$/is);
  if (!calcMatch) {
    return channel;
  }
  let inner = calcMatch[1].trim();
  let previous;
  do {
    previous = inner;
    // Drop multiply-by-one on the right, e.g. "s*1" → "s"
    inner = inner.replace(/\*\s*1(?![\d.])/g, '');
    // Drop multiply-by-one on the left, e.g. "1*s" → "s"
    inner = inner.replace(/(?<![\d.])1\s*\*/g, '');
    // Drop divide-by-one, e.g. "l/1" → "l"
    inner = inner.replace(/\/\s*1(?![\d.])/g, '');
    // Drop an additive or subtractive zero, e.g. "l + 0" or "l - 0" → "l"
    inner = inner.replace(/\s*[+-]\s*0(?![\d.])/g, '');
    // Drop a leading additive zero, e.g. "0 + l" → "l"
    inner = inner.replace(/^0\s*\+\s*/g, '');
    inner = inner.trim();
  } while (inner !== previous);
  if (isBareChannelToken(inner)) {
    return inner;
  }
  return 'calc(' + inner + ')';
}

/**
 * Determines whether simplified channel expressions match the canonical channel
 * keyword order, indicating an identity transform.
 *
 * @param  {Array}   channels   The simplified channel expressions.
 * @param  {Array}   canonical  The canonical channel keyword order.
 * @return {boolean}            Whether the channels are an identity pass-through.
 */
function channelsMatchCanonical (channels, canonical) {
  if (channels.length !== canonical.length) {
    return false;
  }
  for (let index = 0; index < channels.length; index++) {
    if (channels[index].toLowerCase() !== canonical[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves an identity relative color to its shortest concrete representation
 * when the base color can be parsed to concrete channel values.
 *
 * @param  {string}      baseColor  The base color token.
 * @param  {string|null} alpha      The alpha token, or null when absent.
 * @return {string|null}            The shortest color string, or null when unresolvable.
 */
function resolveRelativeIdentity (baseColor, alpha) {
  const parsed = parseColor(baseColor);
  if (!parsed) {
    return null;
  }
  let alphaValue = parsed[3];
  if (alpha !== null) {
    alphaValue = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha);
    if (Number.isNaN(alphaValue)) {
      return null;
    }
  }
  return shortestColor(parsed[0], parsed[1], parsed[2], alphaValue);
}

/**
 * Joins the parts of a relative color back together, omitting whitespace after a
 * closing parenthesis (which already delimits adjacent tokens) and appending the
 * alpha value after a `/` when present.
 *
 * @param  {Array}       parts  The ordered parts, starting with the `from` keyword.
 * @param  {string|null} alpha  The alpha token, or null when absent.
 * @return {string}             The joined relative-color body.
 */
function joinRelativeColorParts (parts, alpha) {
  let result = parts[0];
  for (let index = 1; index < parts.length; index++) {
    if (result.endsWith(')')) {
      result += parts[index];
    } else {
      result += ' ' + parts[index];
    }
  }
  if (alpha !== null) {
    result += '/' + alpha;
  }
  return result;
}

/**
 * Rewrites a single relative-color function body to its shortest form, resolving
 * identity transforms to a concrete color and otherwise minifying whitespace and
 * numeric tokens.
 *
 * @param  {string} functionName  The lowercased color function name.
 * @param  {string} inner         The text between the function parentheses.
 * @return {string}               The minified relative-color function string.
 */
function rewriteRelativeColor (functionName, inner) {
  // Strip the leading `from` keyword, allowing it to abut the base color
  const body = inner.replace(/^\s*from\b\s*/i, '').trim();
  const [channelsPart, alphaRaw] = splitRelativeAlpha(body);
  const tokens = splitTopLevelWhitespace(channelsPart);
  if (tokens.length < 2) {
    return functionName + '(' + inner + ')';
  }
  const baseColor = tokens[0];
  const channels = tokens.slice(1).map(simplifyRelativeChannel);
  const alpha = alphaRaw === null ? null : stripLeadingZeroFromNumber(alphaRaw);

  const canonicalChannels = RELATIVE_COLOR_CHANNELS[functionName];
  if (canonicalChannels && channelsMatchCanonical(channels, canonicalChannels)) {
    const identity = resolveRelativeIdentity(baseColor, alpha);
    if (identity) {
      return identity;
    }
  }

  const parts = ['from', baseColor, ...channels];
  return functionName + '(' + joinRelativeColorParts(parts, alpha) + ')';
}

/**
 * Minifies every relative-color function (`<func>(from ...)`) in a CSS value,
 * resolving identity transforms and collapsing redundant whitespace. The
 * `color(from ...)` form is intentionally left to `evaluateRelativeColor`.
 *
 * @param  {string} value  The CSS value string potentially containing relative colors.
 * @return {string}        The value with relative colors minified.
 */
function minifyRelativeColorSyntax (value) {
  let result = '';
  let index = 0;
  while (index < value.length) {
    // Match a relative-color function name immediately followed by "(from"
    const match = value.slice(index).match(/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*from\b/i);
    const previousCharacter = index > 0 ? value[index - 1] : '';
    // Skip matches that are part of a longer identifier (e.g. the "lch" in "oklch")
    const precededByIdentifier = (/[a-z0-9-]/i).test(previousCharacter);
    if (match && !precededByIdentifier) {
      const functionName = match[1].toLowerCase();
      const openParenIndex = index + match[1].length;
      const closingParenIndex = findClosingParenthesis(value, openParenIndex);
      if (closingParenIndex !== -1) {
        const inner = value.slice(openParenIndex + 1, closingParenIndex);
        result += rewriteRelativeColor(functionName, inner);
        index = closingParenIndex + 1;
        continue;
      }
    }
    result += value[index];
    index++;
  }
  return result;
}

export {
  evaluateRelativeColor,
  minifyRelativeColorSyntax
};
