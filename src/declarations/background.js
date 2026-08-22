/**
 * @file Classifies background shorthand tokens and rebuilds the `background` shorthand from its component values.
 */

import { minifyValue } from '../value/minify.js';

import { shorthandMap } from './config.js';

const BACKGROUND_POSITION_KEYWORDS = new Set(['left', 'center', 'right', 'top', 'bottom']);
const BACKGROUND_REPEAT_KEYWORDS = new Set(['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round']);
const BACKGROUND_ATTACHMENT_KEYWORDS = new Set(['scroll', 'fixed', 'local']);
const BACKGROUND_BOX_KEYWORDS = new Set(['border-box', 'padding-box', 'content-box']);

/**
 * Functions that produce a value other than an image, so a token calling one of
 * them is never a background image even though it looks like a function call.
 *
 * @type {Set<string>}
 */
const NON_IMAGE_FUNCTION_NAMES = new Set([
  'calc',
  'min',
  'max',
  'clamp',
  'var',
  'env',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color'
]);

/**
 * Resolves the background position from a value map. Prefers the combined
 * `background-position` property if present, otherwise combines
 * `background-position-x` and `background-position-y` into a single value.
 *
 * @param  {Map}         valueMap  A map of property names to their minified values.
 * @return {string|null}           The resolved position string, or null if no position data is available.
 */
function resolveBackgroundPosition (valueMap) {
  const position = valueMap.get('background-position');
  if (position) {
    return position;
  }
  const positionX = valueMap.get('background-position-x');
  const positionY = valueMap.get('background-position-y');
  if (positionX && positionY) {
    return positionX + ' ' + positionY;
  }
  return null;
}

/**
 * Determines whether a token is a background image component such as `none`,
 * `url(...)`, or an image-producing function like `linear-gradient(...)`.
 *
 * @param  {string}  token  The token to classify.
 * @return {boolean}        Whether the token is a background image token.
 */
function isBackgroundImageToken (token) {
  if (token === 'none' || token.startsWith('url(')) {
    return true;
  }
  if (!token.endsWith(')')) {
    return false;
  }
  const functionNameMatch = token.match(/^([a-z-]+)\(/i);
  if (!functionNameMatch) {
    return false;
  }
  const functionName = functionNameMatch[1].toLowerCase();
  return !NON_IMAGE_FUNCTION_NAMES.has(functionName);
}

/**
 * Determines whether a token can participate in a background-position value.
 *
 * @param  {string}  token  The token to classify.
 * @return {boolean}        Whether the token is a valid background-position token.
 */
function isBackgroundPositionToken (token) {
  const lowercaseToken = token.toLowerCase();
  if (BACKGROUND_POSITION_KEYWORDS.has(lowercaseToken)) {
    return true;
  }
  if (/^[+-]?(?:\d+|\d*\.\d+)(?:%|[a-z]+)?$/i.test(token)) {
    return true;
  }
  return /^(?:calc|min|max|clamp|var|env)\(/i.test(token);
}

/**
 * Determines whether a token is a background color component after excluding
 * known image, position, repeat, attachment, and box tokens.
 *
 * @param  {string}  token  The token to classify.
 * @return {boolean}        Whether the token is a background color token.
 */
function isBackgroundColorToken (token) {
  if (token === '/' || isBackgroundImageToken(token) || isBackgroundPositionToken(token)) {
    return false;
  }
  const lowercaseToken = token.toLowerCase();
  if (BACKGROUND_REPEAT_KEYWORDS.has(lowercaseToken) || BACKGROUND_ATTACHMENT_KEYWORDS.has(lowercaseToken) || BACKGROUND_BOX_KEYWORDS.has(lowercaseToken)) {
    return false;
  }
  return /^#/i.test(token) || /^[a-z-]+$/i.test(token) || /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(token);
}

/**
 * Splits a token like `linear-gradient(...)100%` into separate image and
 * position tokens when the function output is immediately followed by a
 * background-position token.
 *
 * @param  {string} token  The token to inspect.
 * @return {Array}         The original token, or separate image/position tokens.
 */
function splitAttachedBackgroundImageToken (token) {
  const lastCloseParenthesis = token.lastIndexOf(')');
  if (lastCloseParenthesis === -1 || lastCloseParenthesis === token.length - 1) {
    return [token];
  }
  const imageToken = token.slice(0, lastCloseParenthesis + 1);
  const followingToken = token.slice(lastCloseParenthesis + 1);
  if (!isBackgroundImageToken(imageToken) || !isBackgroundPositionToken(followingToken)) {
    return [token];
  }
  return [imageToken, followingToken];
}

/**
 * Splits a single-layer background shorthand into top-level tokens while
 * respecting nested parentheses and preserving `/` as its own token.
 *
 * @param  {string} value  The background shorthand value.
 * @return {Array}         The extracted top-level tokens.
 */
function splitBackgroundTokens (value) {
  const tokens = [];
  let currentToken = '';
  let parenthesisDepth = 0;

  for (const character of value) {
    if (character === '(') {
      parenthesisDepth++;
    } else if (character === ')') {
      parenthesisDepth--;
    }

    if (parenthesisDepth === 0 && character === '/') {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
      tokens.push('/');
      continue;
    }

    if (parenthesisDepth === 0 && /\s/.test(character)) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
      continue;
    }

    currentToken += character;
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  const normalizedTokens = [];
  for (const token of tokens) {
    normalizedTokens.push(...splitAttachedBackgroundImageToken(token));
  }
  return normalizedTokens;
}

/**
 * Extracts the simple image/color base from an existing background shorthand.
 * Returns null for shorthands that already contain size, position, or any
 * token that cannot be safely reconstructed by the background builder.
 *
 * @param  {string}   value  The background shorthand value.
 * @return {Map|null}        A component map for safe reconstruction, or null.
 */
function extractSimpleBackgroundBase (value) {
  const tokens = splitBackgroundTokens(value);
  const componentMap = new Map();

  for (const token of tokens) {
    if (token === '/') {
      return null;
    }
    if (isBackgroundImageToken(token)) {
      if (componentMap.has('background-image')) {
        return null;
      }
      componentMap.set('background-image', token);
      continue;
    }
    if (isBackgroundColorToken(token)) {
      if (componentMap.has('background-color')) {
        return null;
      }
      componentMap.set('background-color', token);
      continue;
    }
    return null;
  }

  return componentMap;
}

/**
 * Serializes normalized background components into a minified background
 * shorthand value while omitting default sub-values.
 *
 * @param  {Map}         valueMap         The normalized background component map.
 * @param  {string}      importantSuffix  A trailing `!important` suffix, if needed.
 * @return {string|null}                  The minified background shorthand, or null.
 */
function buildBackgroundShorthandValue (valueMap, importantSuffix) {
  const color = valueMap.get('background-color');
  const image = valueMap.get('background-image');
  const repeat = valueMap.get('background-repeat');
  const attachment = valueMap.get('background-attachment');
  const size = valueMap.get('background-size');
  const origin = valueMap.get('background-origin');
  const clip = valueMap.get('background-clip');
  const position = resolveBackgroundPosition(valueMap);

  const result = [];
  if (color && color !== 'transparent') {
    result.push(color);
  }
  if (image && image !== 'none') {
    result.push(image);
  }
  if (position && position !== '0 0' && position !== '0% 0%') {
    result.push(position);
  }
  if (size && size !== 'auto') {
    if (position && position !== '0 0' && position !== '0% 0%') {
      result.push('/' + size);
    } else {
      result.push('0 0/' + size);
    }
  }
  if (repeat && repeat !== 'repeat') {
    result.push(repeat);
  }
  if (attachment && attachment !== 'scroll') {
    result.push(attachment);
  }
  const hasNonDefaultOrigin = origin && origin !== 'padding-box';
  const hasNonDefaultClip = clip && clip !== 'border-box';
  if (hasNonDefaultOrigin && hasNonDefaultClip) {
    result.push(origin);
    result.push(clip);
  } else if (hasNonDefaultOrigin || hasNonDefaultClip) {
    if (origin) {
      result.push(origin);
    }
    if (clip) {
      result.push(clip);
    }
  }
  if (!result.length) {
    return null;
  }
  return result.join(' ') + importantSuffix;
}

/**
 * Merges later background longhands into an earlier simple background shorthand
 * when their combined value can be reconstructed without changing semantics.
 *
 * @param  {Array} declarations  The declarations in source order.
 * @return {Array}               The updated declarations with absorbed longhands.
 */
function absorbBackgroundLonghandsIntoShorthand (declarations) {
  const backgroundIndex = declarations.findIndex((declaration) => {
    return declaration.property === 'background';
  });
  if (backgroundIndex === -1) {
    return declarations;
  }

  const backgroundDeclaration = declarations[backgroundIndex];
  const backgroundValue = minifyValue(backgroundDeclaration);
  const backgroundIsImportant = backgroundValue.includes('!important');
  const simpleBase = extractSimpleBackgroundBase(backgroundValue.replace('!important', '').trim());
  if (!simpleBase) {
    return declarations;
  }

  const absorbableProperties = new Set(shorthandMap.background.filter((property) => {
    return property !== 'background';
  }));
  const relevantDeclarations = declarations.filter((declaration, index) => {
    return index > backgroundIndex && absorbableProperties.has(declaration.property);
  });
  if (!relevantDeclarations.length) {
    return declarations;
  }

  const sharesImportance = relevantDeclarations.every((declaration) => {
    return minifyValue(declaration).includes('!important') === backgroundIsImportant;
  });
  if (!sharesImportance) {
    return declarations;
  }

  for (const declaration of relevantDeclarations) {
    simpleBase.set(declaration.property, minifyValue(declaration).replace('!important', '').trim());
  }

  const mergedValue = buildBackgroundShorthandValue(simpleBase, backgroundIsImportant ? '!important' : '');
  if (!mergedValue) {
    return declarations;
  }

  return declarations.flatMap((declaration, index) => {
    if (index === backgroundIndex) {
      return [{ ...declaration, value: mergedValue }];
    }
    if (index > backgroundIndex && absorbableProperties.has(declaration.property)) {
      return [];
    }
    return [declaration];
  });
}

export {
  absorbBackgroundLonghandsIntoShorthand,
  buildBackgroundShorthandValue
};
