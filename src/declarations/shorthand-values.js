/**
 * @file Serializes the collected longhand values of a shorthand into the shortest valid shorthand value, one builder per shorthand family.
 */

import { collapseShorthandParts } from '../value/shared.js';
import { splitTopLevelComponents } from '../value/syntax.js';

import { buildBackgroundShorthandValue } from './background.js';

/**
 * @typedef  {object} ShorthandComponents
 * @property {Array}  properties           The longhand property names being merged, in shorthand order.
 * @property {Map}    valueMap             A map of each longhand property name to its cleaned value.
 * @property {Array}  cleanValues          The cleaned longhand values, in the same order as `properties`.
 * @property {string} importantSuffix      A trailing `!important` suffix, or an empty string.
 */

/**
 * Builds a `position-try` value, which only collapses while the order component
 * is at its `normal` default.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildPositionTryValue ({ valueMap, importantSuffix }) {
  const order = valueMap.get('position-try-order');
  const fallbacks = valueMap.get('position-try-fallbacks');
  if (order === 'normal' && fallbacks) {
    return fallbacks + importantSuffix;
  }
  return null;
}

/**
 * Builds a `transition` value, omitting the trailing components that already
 * hold their initial value.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildTransitionValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds an `animation` value, omitting the components that already hold their
 * initial value.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildAnimationValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `background-position` value from its two axis longhands.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildBackgroundPositionValue ({ valueMap, importantSuffix }) {
  const positionX = valueMap.get('background-position-x');
  const positionY = valueMap.get('background-position-y');
  if (!positionX || !positionY) {
    return null;
  }
  return positionX + ' ' + positionY + importantSuffix;
}

/**
 * Builds a `background` value from its component longhands.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildBackgroundValue ({ valueMap, importantSuffix }) {
  return buildBackgroundShorthandValue(valueMap, importantSuffix);
}

/**
 * Builds a `mask` value, attaching the size after the position separator.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildMaskValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `border-image` value, which requires a source to be meaningful.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildBorderImageValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `text-decoration` value, omitting the default style and color.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildTextDecorationValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `columns` value, which keeps both components even when they match,
 * because the width and count are not interchangeable.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildColumnsValue ({ cleanValues, importantSuffix }) {
  return cleanValues.join(' ') + importantSuffix;
}

/**
 * Builds a `list-style` value, omitting default components and falling back to
 * `inside` when every component holds its initial value.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildListStyleValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `font` value, which requires both a size and a family, and attaches
 * any line height after the size separator.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildFontValue ({ valueMap, importantSuffix }) {
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

/**
 * Builds a `flex` value from its three required components.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildFlexValue ({ valueMap, importantSuffix }) {
  const grow = valueMap.get('flex-grow');
  const shrink = valueMap.get('flex-shrink');
  const basis = valueMap.get('flex-basis');
  if (!grow || !shrink || !basis) {
    return null;
  }
  return [grow, shrink, basis].join(' ') + importantSuffix;
}

/**
 * Determines whether a shorthand takes a single width, style, and color, as
 * `border` and `outline` do.
 *
 * @param  {Array}   properties  The longhand property names being merged.
 * @return {boolean}             Whether the longhands form a width/style/color trio.
 */
function isWidthStyleColorTrio (properties) {
  return (
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
}

/**
 * Builds the value of a shorthand whose components are positional: two-value
 * logical pairs, four-value box sides, and width/style/color trios.
 *
 * @param  {ShorthandComponents} components  The collected longhand values.
 * @return {string|null}                     The shorthand value, or null when it cannot be built.
 */
function buildPositionalShorthandValue ({ properties, cleanValues, importantSuffix }) {
  if (properties.length === 2) {
    // A logical pair collapses to one value when both sides match
    if (cleanValues[0] === cleanValues[1]) {
      return cleanValues[0] + importantSuffix;
    }
    return cleanValues.join(' ') + importantSuffix;
  }

  if (properties.length === 4) {
    // Box sides collapse from top/right/bottom/left down to as few values as possible
    return collapseShorthandParts([...cleanValues]).join(' ') + importantSuffix;
  }

  if (isWidthStyleColorTrio(properties)) {
    // Every component of a border/outline shorthand accepts a single value, so a
    // per-edge value such as `border-color:#0000 red` cannot be merged directly.
    const hasOnlySingleComponentValues = cleanValues.every((value) => {
      return splitTopLevelComponents(value).length === 1;
    });
    if (!hasOnlySingleComponentValues) {
      return null;
    }
    return cleanValues.join(' ') + importantSuffix;
  }

  return null;
}

/**
 * Builders for shorthands whose components are identified by name rather than by
 * position, keyed by shorthand property name.
 *
 * @type {{[key: string]: function(ShorthandComponents): (string|null)}}
 */
const NAMED_SHORTHAND_BUILDERS = {
  animation: buildAnimationValue,
  background: buildBackgroundValue,
  'background-position': buildBackgroundPositionValue,
  'border-image': buildBorderImageValue,
  columns: buildColumnsValue,
  flex: buildFlexValue,
  font: buildFontValue,
  'list-style': buildListStyleValue,
  mask: buildMaskValue,
  'position-try': buildPositionTryValue,
  'text-decoration': buildTextDecorationValue,
  transition: buildTransitionValue
};

/**
 * Serializes the collected longhand values of a shorthand into its minified
 * shorthand value, using the builder registered for that shorthand and falling
 * back to positional assembly for box-model style shorthands.
 *
 * @param  {string}              shorthandName  The target shorthand property name.
 * @param  {ShorthandComponents} components     The collected longhand values.
 * @return {string|null}                        The shorthand value, or null when it cannot be built.
 */
function buildShorthandValue (shorthandName, components) {
  const namedBuilder = NAMED_SHORTHAND_BUILDERS[shorthandName];
  if (namedBuilder) {
    return namedBuilder(components);
  }
  return buildPositionalShorthandValue(components);
}

export { buildShorthandValue };
