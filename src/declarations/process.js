/**
 * @file Deduplicates, merges, and optimizes CSS declarations by collapsing longhand properties into shorthands and removing overridden values.
 */

import { minifyValue } from '../value/minify.js';
import { hasInvalidQuotesCount } from '../value/quotes.js';
import { collapseShorthandParts } from '../value/shared.js';

import {
  shorthandMap,
  shorthandOverrideMap
} from './config.js';

/**
 * Reorders declarations so that shorthands appear before any related longhands they would override, preventing cascade issues in the minified output.
 *
 * @param  {Array} declarations  The array of CSS declaration objects to reorder.
 * @return {Array}               A new array with declarations in the corrected order.
 */
function orderDeclarations (declarations) {
  const ordered = [...declarations];
  const moveBefore = (prop, beforeProp) => {
    const fromIndex = ordered.findIndex((declaration) => {
      return declaration?.property === prop;
    });
    const toIndex = ordered.findIndex((declaration) => {
      return declaration?.property === beforeProp;
    });
    if (fromIndex === -1 || toIndex === -1 || fromIndex < toIndex) {
      return;
    }
    const [item] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, item);
  };

  moveBefore('border', 'border-image');
  moveBefore('font', 'font-feature-settings');
  moveBefore('font', 'font-variant-ligatures');
  moveBefore('font', 'font-kerning');
  moveBefore('font', 'font-variation-settings');
  moveBefore('mask', 'mask-border');
  moveBefore('margin', 'margin-top');
  moveBefore('margin', 'margin-right');
  moveBefore('margin', 'margin-bottom');
  moveBefore('margin', 'margin-left');

  return ordered;
}

/**
 * Determines which longhand properties are present and eligible for merging into a given shorthand. Returns null when the required longhands for the shorthand are not all available.
 *
 * @param  {string}     shorthand     The CSS shorthand property name.
 * @param  {Array}      longhands     The expected longhand property names for this shorthand.
 * @param  {Array}      declarations  The current array of CSS declaration objects.
 * @return {Array|null}               The list of longhand names to merge, or null if merging is not possible.
 */
function getMergeProps (shorthand, longhands, declarations) {
  const presentLonghands = longhands.filter((longhand) => {
    return declarations.some((declaration) => {
      return declaration.property === longhand;
    });
  });
  if (presentLonghands.length === 0) {
    return null;
  }
  if (shorthand === 'font') {
    const hasRequiredFontProps = presentLonghands.includes('font-size') && presentLonghands.includes('font-family');
    if (hasRequiredFontProps) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'background-position') {
    const hasBothAxes = presentLonghands.includes('background-position-x') && presentLonghands.includes('background-position-y');
    if (hasBothAxes) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'background') {
    const hasBackgroundProp = presentLonghands.includes('background-color') || presentLonghands.includes('background-image');
    if (hasBackgroundProp) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'mask') {
    if (presentLonghands.includes('mask-image')) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'border-image') {
    if (presentLonghands.includes('border-image-source')) {
      return presentLonghands;
    }
    return null;
  }
  if (shorthand === 'border') {
    const hasAllBorderParts = (
      presentLonghands.includes('border-width') &&
      presentLonghands.includes('border-style') &&
      presentLonghands.includes('border-color')
    );
    if (hasAllBorderParts) {
      return ['border-width', 'border-style', 'border-color'];
    }
    return null;
  }
  if (shorthand === 'flex') {
    const hasAllFlexParts = (
      presentLonghands.includes('flex-grow') &&
      presentLonghands.includes('flex-shrink') &&
      presentLonghands.includes('flex-basis')
    );
    if (hasAllFlexParts) {
      return ['flex-grow', 'flex-shrink', 'flex-basis'];
    }
    return null;
  }
  if (presentLonghands.length === longhands.length) {
    return longhands;
  }
  return null;
}

/**
 * Get all longhands that a shorthand would override.
 *
 * @param  {string} shorthandProp  The CSS shorthand property name.
 * @return {Array}                 A deduplicated array of all longhand property names that the shorthand overrides, including nested longhands.
 */
function getOverriddenLonghands (shorthandProp) {
  const direct = shorthandMap[shorthandProp] || [];
  const overrides = shorthandOverrideMap[shorthandProp] || [];
  const all = [...direct, ...overrides];
  for (const prop of direct) {
    const nested = shorthandMap[prop] || [];
    all.push(...nested);
  }
  return [...new Set(all)];
}

/**
 * Check if a value contains var() - don't merge if it does (safest approach).
 *
 * @param  {string}  value  The minified CSS value string to check.
 * @return {boolean}        True if the value contains a var() with a fallback comma.
 */
function hasVarFallback (value) {
  // Match var() containing a comma (indicating a fallback value)
  return /var\([^)]*,/.test(value);
}

/**
 * Determines whether a value containing var() references can safely be merged into a shorthand. Values with fallback commas or unregistered custom properties are not mergeable.
 *
 * @param  {string}  value    The minified CSS value string to check.
 * @param  {object}  context  The minification context with registered custom property data.
 * @return {boolean}          True if the value is safe to merge into a shorthand.
 */
function canMergeVarValue (value, context) {
  // Check if the value contains any var() reference
  const containsVar = /var\(/.test(value);
  if (!containsVar || hasVarFallback(value)) {
    return !hasVarFallback(value);
  }
  // Extract all var() references with their custom property names
  const matches = [...value.matchAll(/var\((--[A-Za-z0-9_-]+)\)/g)];
  if (!matches.length) {
    return false;
  }
  return matches.every(([, propertyName]) => {
    return context.registeredCustomProperties.has(propertyName);
  });
}

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

const BACKGROUND_POSITION_KEYWORDS = new Set(['left', 'center', 'right', 'top', 'bottom']);
const BACKGROUND_REPEAT_KEYWORDS = new Set(['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round']);
const BACKGROUND_ATTACHMENT_KEYWORDS = new Set(['scroll', 'fixed', 'local']);
const BACKGROUND_BOX_KEYWORDS = new Set(['border-box', 'padding-box', 'content-box']);

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
  return !['calc', 'min', 'max', 'clamp', 'var', 'env', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color'].includes(functionName);
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

/**
 * Try to merge longhand properties into a shorthand.
 *
 * @param  {Array}       properties     The longhand property names to merge.
 * @param  {Array}       declarations   The CSS declaration objects to draw values from.
 * @param  {string}      shorthandName  The target shorthand property name.
 * @param  {object}      context        The minification context with registered custom property data.
 * @return {string|null}                The merged shorthand value string, or null if merging is not possible.
 */
function tryMergeToShorthand (properties, declarations, shorthandName = '', context) {
  if (properties.length < 2) {
    return null;
  }

  const values = properties.map((property) => {
    const declaration = declarations.find((candidate) => {
      return candidate.property === property;
    });
    if (declaration) {
      return minifyValue(declaration);
    }
    return null;
  });

  // If any value is null, can't merge
  const hasNullValue = values.some((value) => {
    return value === null;
  });
  if (hasNullValue) {
    return null;
  }

  // Don't merge if any value has var() with fallback or unknown custom properties
  const hasUnmergeableVar = values.some((value) => {
    return !canMergeVarValue(value, context);
  });
  if (hasUnmergeableVar) {
    return null;
  }

  // Check if all values have the same !important status
  const importantFlags = values.map((value) => {
    return value.includes('!important');
  });
  const allImportant = importantFlags.every((flag) => {
    return flag;
  });
  const noneImportant = importantFlags.every((flag) => {
    return !flag;
  });

  // Allow mixed important flags for margin/padding/inset - merge without !important on shorthand
  // For other properties, mixed important flags are not allowed
  const allowsMixedImportant = (
    shorthandName === 'margin' ||
    shorthandName === 'padding' ||
    shorthandName === 'inset' ||
    shorthandName === 'position-try'
  );
  if (!allImportant && !noneImportant && !allowsMixedImportant) {
    return null;
  }

  const cleanValues = values.map((value) => {
    return value
      .replace('!important', '')
      .trim();
  });
  const valueMap = new Map(properties.map((property, index) => {
    return [property, cleanValues[index]];
  }));

  // For margin/padding with mixed important, don't use !important on the shorthand
  // Only use !important if ALL values have it
  const useImportant = allImportant;
  const importantSuffix = useImportant ? '!important' : '';

  if (shorthandName === 'position-try') {
    const order = valueMap.get('position-try-order');
    const fallbacks = valueMap.get('position-try-fallbacks');
    if (order === 'normal' && fallbacks) {
      return fallbacks + importantSuffix;
    }
    return null;
  }

  if (shorthandName === 'transition') {
    const transitionProperty = valueMap.get('transition-property');
    const duration = valueMap.get('transition-duration');
    const timing = valueMap.get('transition-timing-function');
    const delay = valueMap.get('transition-delay');
    if (!transitionProperty || !duration) {
      return null;
    }
    const result = [transitionProperty, duration];
    if (timing && timing !== 'ease') {
      result.push(timing);
    }
    if (delay && delay !== '0' && delay !== '0s') {
      result.push(delay);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'animation') {
    const animationName = valueMap.get('animation-name');
    const duration = valueMap.get('animation-duration');
    if (!animationName || !duration) {
      return null;
    }
    const result = [animationName, duration];
    const timing = valueMap.get('animation-timing-function');
    const delay = valueMap.get('animation-delay');
    const iteration = valueMap.get('animation-iteration-count');
    const direction = valueMap.get('animation-direction');
    const fillMode = valueMap.get('animation-fill-mode');
    const playState = valueMap.get('animation-play-state');
    if (timing && timing !== 'ease') {
      result.push(timing);
    }
    if (delay && delay !== '0' && delay !== '0s') {
      result.push(delay);
    }
    if (iteration && iteration !== '1') {
      result.push(iteration);
    }
    if (direction && direction !== 'normal') {
      result.push(direction);
    }
    if (fillMode && fillMode !== 'none') {
      result.push(fillMode);
    }
    if (playState && playState !== 'running') {
      result.push(playState);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'background-position') {
    const positionX = valueMap.get('background-position-x');
    const positionY = valueMap.get('background-position-y');
    if (!positionX || !positionY) {
      return null;
    }
    return positionX + ' ' + positionY + importantSuffix;
  }

  if (shorthandName === 'background') {
    return buildBackgroundShorthandValue(valueMap, importantSuffix);
  }

  if (shorthandName === 'mask') {
    const image = valueMap.get('mask-image');
    const repeat = valueMap.get('mask-repeat');
    const size = valueMap.get('mask-size');
    if (!image) {
      return null;
    }
    let result = image;
    if (repeat) {
      result += ' ' + repeat;
    }
    if (size) {
      result += '/' + size;
    }
    return result + importantSuffix;
  }

  if (shorthandName === 'border-image') {
    const source = valueMap.get('border-image-source');
    const slice = valueMap.get('border-image-slice');
    const repeat = valueMap.get('border-image-repeat');
    if (!source) {
      return null;
    }
    const result = [source];
    if (slice) {
      result.push(slice);
    }
    if (repeat) {
      result.push(repeat);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'text-decoration') {
    const line = valueMap.get('text-decoration-line');
    const style = valueMap.get('text-decoration-style');
    const color = valueMap.get('text-decoration-color');
    if (!line) {
      return null;
    }
    const result = [line];
    if (style && style !== 'solid') {
      result.push(style);
    }
    if (color && color !== 'currentcolor') {
      result.push(color);
    }
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'columns') {
    return cleanValues.join(' ') + importantSuffix;
  }

  if (shorthandName === 'list-style') {
    const position = valueMap.get('list-style-position');
    const image = valueMap.get('list-style-image');
    const type = valueMap.get('list-style-type');
    const result = [];
    if (position && position !== 'outside') {
      result.push(position);
    }
    if (image && image !== 'none') {
      result.push(image);
    }
    if (type && type !== 'disc') {
      result.push(type);
    }
    const joined = result.join(' ') || 'inside';
    return joined + importantSuffix;
  }

  if (shorthandName === 'font') {
    const fontSize = valueMap.get('font-size');
    const fontFamily = valueMap.get('font-family');
    if (!fontSize || !fontFamily) {
      return null;
    }
    const result = [];
    const fontStyle = valueMap.get('font-style');
    const fontWeight = valueMap.get('font-weight');
    const lineHeight = valueMap.get('line-height');
    if (fontStyle && fontStyle !== 'normal') {
      result.push(fontStyle);
    }
    if (fontWeight && fontWeight !== '400' && fontWeight !== 'normal') {
      result.push(fontWeight);
    }
    if (lineHeight) {
      result.push(fontSize + '/' + lineHeight);
    } else {
      result.push(fontSize);
    }
    result.push(fontFamily);
    return result.join(' ') + importantSuffix;
  }

  if (shorthandName === 'flex') {
    const grow = valueMap.get('flex-grow');
    const shrink = valueMap.get('flex-shrink');
    const basis = valueMap.get('flex-basis');
    if (!grow || !shrink || !basis) {
      return null;
    }
    return [grow, shrink, basis].join(' ') + importantSuffix;
  }

  // Build shorthand value
  if (properties.length === 2) {
    // For 2-value shorthands (logical properties)
    if (cleanValues[0] === cleanValues[1]) {
      return cleanValues[0] + importantSuffix;
    }
    return cleanValues.join(' ') + importantSuffix;
  }

  if (properties.length === 4) {
    // For 4-value shorthands (margin, padding, inset, etc.)
    // Collapse redundant values: top right bottom left → fewer values when sides match
    return collapseShorthandParts([...cleanValues]).join(' ') + importantSuffix;
  }

  // For border shorthand (3 values: width, style, color)
  const isBorderLikeShorthand = (
    properties.length === 3 &&
    (properties.includes('border-width') || properties.includes('outline-width')) &&
    properties.some((property) => {
      // Check if one longhand ends with "-style" (e.g. border-style, outline-style)
      return /-style$/.test(property);
    }) &&
    properties.some((property) => {
      // Check if one longhand ends with "-color" (e.g. border-color, outline-color)
      return /-color$/.test(property);
    })
  );
  if (isBorderLikeShorthand) {
    return cleanValues.join(' ') + importantSuffix;
  }

  return null;
}

/**
 * Deduplicates, merges, and optimizes CSS declarations within a rule block. Removes overridden longhands, collapses longhands into shorthands, and preserves intentional fallbacks.
 *
 * @param  {Array}  declarations  The array of CSS declaration objects to process.
 * @param  {object} context       The minification context with registered custom property data.
 * @return {Array}                A new array of optimized and reordered declaration objects.
 */
function processDeclarations (declarations, context) {
  let result = [];

  for (let declaration of declarations) {
    if (declaration.type === 'rule' || declaration.type === 'media') {
      result.push(declaration);
      continue;
    }

    const propertyName = declaration.property;
    if (!propertyName) {
      continue;
    }

    if (propertyName === 'quotes' && hasInvalidQuotesCount(declaration.value)) {
      continue;
    }

    let minifiedValue = minifyValue(declaration);

    let previousIndex = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].property === propertyName) {
        previousIndex = i;
        break;
      }
    }

    // Also check if there's a prefixed version we can replace
    let prefixedIndex = -1;
    if (!propertyName.startsWith('-')) {
      for (let i = result.length - 1; i >= 0; i--) {
        const isPrefixedMatch = (
          result[i].property &&
          result[i].property.endsWith(propertyName) &&
          result[i].property.startsWith('-')
        );
        if (isPrefixedMatch) {
          prefixedIndex = i;
          break;
        }
      }
    }

    if (prefixedIndex !== -1) {
      let prefixedValue = minifyValue(result[prefixedIndex]);
      if (minifiedValue === prefixedValue) {
        result.splice(prefixedIndex, 1);
        // Re-adjust previousIndex if we removed an item before it
        if (previousIndex > prefixedIndex) {
          previousIndex--;
        }
      }
    }

    if (previousIndex !== -1) {
      const previousValue = minifyValue(result[previousIndex]);

      if (previousValue.includes('!important') && !minifiedValue.includes('!important')) {
        continue;
      }

      // Fallbacks for custom variables or older browser functions should be kept
      const currentUsesModernSyntax = (
        minifiedValue.includes('calc(') ||
        minifiedValue.includes('env(') ||
        minifiedValue.includes('var(') ||
        minifiedValue.includes('-webkit-')
      );
      const previousUsesModernSyntax = (
        previousValue.includes('calc(') ||
        previousValue.includes('env(') ||
        previousValue.includes('var(') ||
        previousValue.includes('-webkit-')
      );
      if (currentUsesModernSyntax && !previousUsesModernSyntax) {
        result.push(declaration);
        continue;
      }

      // Otherwise override previous identical property
      result.splice(previousIndex, 1);
    }

    result.push(declaration);
  }

  // Handle shorthand merging

  // First, remove longhand properties that are overridden by existing shorthands
  const propertiesToRemove = new Set();
  for (let i = 0; i < result.length; i++) {
    const declaration = result[i];
    if (declaration.property && shorthandMap[declaration.property]) {
      // This is a shorthand, check if any longhands come before it
      const overridden = getOverriddenLonghands(declaration.property);
      for (const longhandProperty of overridden) {
        const longhandIndex = result.findIndex((candidate, index) => {
          return candidate.property === longhandProperty && index < i;
        });
        if (longhandIndex !== -1) {
          propertiesToRemove.add(longhandProperty);
        }
      }
    }
  }

  result = result.filter((declaration) => {
    return !propertiesToRemove.has(declaration.property);
  });
  result = absorbBackgroundLonghandsIntoShorthand(result);

  // Try to merge remaining longhands into shorthands
  let changed = true;
  while (changed) {
    changed = false;
    const mergedProperties = new Set();
    const newDeclarations = [];

    for (const [shorthand, longhands] of Object.entries(shorthandMap)) {
      const shorthandAlreadyExists = result.some((declaration) => {
        return declaration.property === shorthand;
      });
      if (shorthandAlreadyExists) {
        continue;
      }

      const mergeableProperties = getMergeProps(shorthand, longhands, result);
      if (!mergeableProperties) {
        continue;
      }
      const relevantDeclarations = result.filter((declaration) => {
        return mergeableProperties.includes(declaration.property);
      });
      const mergedValue = tryMergeToShorthand(mergeableProperties, relevantDeclarations, shorthand, context);
      if (!mergedValue) {
        continue;
      }

      newDeclarations.push({ property: shorthand, value: mergedValue });
      const isMarginPaddingInset = (
        shorthand === 'margin' ||
        shorthand === 'padding' ||
        shorthand === 'inset'
      );
      const someAreImportant = relevantDeclarations.some((declaration) => {
        return minifyValue(declaration).includes('!important');
      });
      const allAreImportant = relevantDeclarations.every((declaration) => {
        return minifyValue(declaration).includes('!important');
      });
      const hasMixedImportant = someAreImportant && !allAreImportant;

      if (isMarginPaddingInset && hasMixedImportant) {
        for (const property of mergeableProperties) {
          const declaration = relevantDeclarations.find((candidate) => {
            return candidate.property === property;
          });
          if (declaration && !minifyValue(declaration).includes('!important')) {
            mergedProperties.add(property);
          }
        }
      } else {
        for (const property of mergeableProperties) {
          mergedProperties.add(property);
        }
      }
    }

    if (newDeclarations.length) {
      // Filter out intermediate shorthands whose longhands are entirely
      // consumed by a higher-level shorthand created in the same iteration.
      // For example, background-position (x + y) is redundant when
      // background already consumed those same longhands.
      const filteredDeclarations = newDeclarations.filter((declaration) => {
        const longhands = shorthandMap[declaration.property];
        if (!longhands) {
          return true;
        }
        const isSubsumedByOtherShorthand = newDeclarations.some((other) => {
          if (other === declaration) {
            return false;
          }
          const otherLonghands = shorthandMap[other.property];
          if (!otherLonghands) {
            return false;
          }
          return longhands.every((longhand) => {
            return otherLonghands.includes(longhand);
          });
        });
        return !isSubsumedByOtherShorthand;
      });

      result = result.filter((declaration) => {
        return !mergedProperties.has(declaration.property);
      });
      result = [...result, ...filteredDeclarations];
      changed = true;
    }
  }

  return orderDeclarations(result);
}

export { processDeclarations };
