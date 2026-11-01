/**
 * @file Applies the optimizations specific to individual properties, such as shortening timing functions, collapsing shorthand components, and reordering `border` and `flex-flow` values.
 */

import { isUnicodeCharset } from '../context.js';
import { splitTopLevelComponents } from '../parser/source-search.js';
import { isCustomProperty } from '../utilities.js';

import {
  removeDefaultBorderWidth,
  reorderBorderWidthBeforeStyle,
  separateOutlineStyleFromColor
} from './border.js';
import { rgbaToHex } from './color/conversion.js';
import { shortenColorValues } from './color/shorten.js';
import { minifyFontShorthand } from './font.js';
import { collapseHyphenateLimitChars } from './hyphenate-limit-chars.js';
import { resolveInitialKeyword } from './initial-keywords.js';
import { convertAbsoluteLengthsToPx } from './lengths.js';
import {
  convertBackgroundPositionKeywords,
  normalizeImagePositionSeparator
} from './positions.js';
import { replaceOutsideStringsAndUrls } from './segments.js';
import {
  collapseShorthandParts,
  normalizeScaleComponent,
  parseAlphaString
} from './shared.js';
import { convertTimesToShortestUnit } from './time.js';
import { minifyTransformValue } from './transforms.js';
import { removeDefaultBackgroundPositionsAfterUrlTokens } from './urls.js';
import { restoreSpaceBeforeMathOperators } from './whitespace.js';

/**
 * Properties whose value is a time, where a millisecond amount may be worth
 * rewriting in seconds.
 *
 * @type {Set<string>}
 */
const TIME_PROPERTIES = new Set([
  'transition',
  'transition-duration',
  'transition-delay',
  'animation',
  'animation-duration',
  'animation-delay'
]);

/**
 * Properties whose grammar delimits its own components, either with punctuation
 * (the `/` and `,` of the `background`, `mask`, and `src` layers) or by taking
 * nothing but functions (`transform`). Their components stay readable without
 * the whitespace that follows a closing parenthesis, so that whitespace is left
 * elided and each of them restores only the separators its grammar still needs.
 *
 * @type {Set<string>}
 */
const PUNCTUATED_COMPONENT_PROPERTIES = new Set([
  'background',
  'mask',
  'src',
  'transform'
]);

/**
 * Properties whose one to four box-model components collapse to the fewest
 * that state the same edges (4 → 3 → 2 → 1 values).
 *
 * @type {Set<string>}
 */
const COLLAPSIBLE_BOX_SHORTHAND_PROPERTIES = new Set([
  'margin',
  'padding',
  'inset',
  'border-width',
  'border-style',
  'border-color',
  'gap',
  'overflow'
]);

/**
 * Whole values that have a shorter keyword stating the same thing, keyed by
 * the property they are declared on.
 *
 * @type {Map<string, Map<string, string>>}
 */
const SHORTER_EQUIVALENT_VALUES = new Map([
  ['background', new Map([
    ['none', '0 0']
  ])],
  ['display', new Map([
    ['block flow', 'block'],
    ['inline flow-root', 'inline-block']
  ])],
  ['background-repeat', new Map([
    ['no-repeat no-repeat', 'no-repeat'],
    ['repeat no-repeat', 'repeat-x'],
    ['no-repeat repeat', 'repeat-y']
  ])]
]);

/**
 * Replaces a whole value with the shorter keyword that states the same thing
 * for its property, when there is one.
 *
 * @param  {string} value     The CSS value string.
 * @param  {string} property  The CSS property name.
 * @return {string}           The shorter equivalent value, or the value unchanged.
 */
function replaceWithShorterEquivalentValue (value, property) {
  return SHORTER_EQUIVALENT_VALUES.get(property)?.get(value) ?? value;
}

/**
 * Replaces the `bold` and `normal` keywords of `font-weight` with their
 * numeric equivalents.
 *
 * @param  {string} value  The `font-weight` value.
 * @return {string}        The value with its weight keywords written as numbers.
 */
function convertFontWeightKeywords (value) {
  // Replace font-weight keyword "bold" with its numeric equivalent
  const withBold = value.replace(/\bbold\b/gi, '700');
  // Replace font-weight keyword "normal" with its numeric equivalent
  return withBold.replace(/\bnormal\b/gi, '400');
}

/**
 * Minifies a `transition` value by removing zero durations and replacing
 * `cubic-bezier()` curves with the timing keywords they are equivalent to
 * (transition: all 0s -> transition: all).
 *
 * @param  {string} value  The `transition` value.
 * @return {string}        The minified value.
 */
function minifyTransitionValue (value) {
  // Remove zero-second duration from transition shorthand
  value = value.replace(/\s+0s/g, ' ');
  // Remove leading zero-pixel value from transition shorthand
  value = value.replace(/^0px\s*/, '');
  // Replace cubic-bezier functions with their equivalent named timing-function keywords
  value = value.replace(/cubic-bezier\(0,0,1,1\)/g, 'linear');
  value = value.replace(/cubic-bezier\(\.25,\.1,\.25,1\)/g, 'ease');
  value = value.replace(/cubic-bezier\(\.42,0,1,1\)/g, 'ease-in');
  value = value.replace(/cubic-bezier\(0,0,\.58,1\)/g, 'ease-out');
  return value.trim();
}

/**
 * Minifies an `animation` value by replacing `steps()` functions with the
 * timing keywords they are equivalent to.
 *
 * @param  {string} value  The `animation` value.
 * @return {string}        The minified value.
 */
function minifyAnimationValue (value) {
  // Replace steps() functions with their equivalent named timing-function keywords
  value = value.replace(/steps\(1,start\)/g, 'step-start');
  value = value.replace(/steps\(1,end\)/g, 'step-end');
  // Restore space between step-start/step-end keyword and following token
  // (the parenthesis whitespace stripping removes the space before replacement)
  return value.replace(/(step-start|step-end)(?=[a-zA-Z0-9#-])/g, '$1 ');
}

/**
 * Minifies a `flex` value by removing the zero basis that the shorthand
 * already reads an unwritten basis as (flex: 0 0 0px -> flex: 0 0).
 *
 * @param  {string} value  The `flex` value.
 * @return {string}        The minified value.
 */
function minifyFlexValue (value) {
  // Remove trailing zero-pixel basis value
  value = value.replace(/\s+0px/g, ' ');
  // Remove leading zero-pixel value
  value = value.replace(/^0px\s*/, '');
  // Remove an explicit zero basis: a trailing zero is only a basis when grow
  // and shrink precede it, and the shorthand already reads an unwritten basis
  // as 0. In `0 0` the trailing zero is the shrink, which the shorthand
  // defaults to 1 instead, so dropping it would size the element differently.
  value = value.replace(/^(\S+\s+\S+)\s+0$/, '$1');
  // Remove standalone zero-pixel value
  value = value.replace(/^0px$/, '');
  return value.trim();
}

/**
 * Rewrites a `flex-flow` value from wrap-direction to the canonical
 * direction-wrap order.
 *
 * @param  {string} value  The `flex-flow` value.
 * @return {string}        The value in canonical order.
 */
function reorderFlexFlowValue (value) {
  // Reorder flex-flow from wrap-direction to direction-wrap (canonical order)
  return value.replace(/^(nowrap|wrap|wrap-reverse)\s+(row|row-reverse|column|column-reverse)$/i, '$2 $1');
}

/**
 * Minifies a `font-family` list by unquoting the multi-word family names that
 * do not need quotes and dropping every repeat of a family already listed.
 *
 * @param  {string} value  The `font-family` value.
 * @return {string}        The minified family list.
 */
function minifyFontFamilyValue (value) {
  // Strip quotes from simple multi-word font family names that don't require quoting
  const unquoted = value.replace(/"([A-Za-z0-9-]+(?: [A-Za-z0-9-]+)+)"/g, '$1');
  const seenFamilies = new Set();
  return unquoted.split(',').map((part) => {
    return part.trim();
  }).filter(Boolean).filter((part) => {
    const lowercaseName = part.toLowerCase();
    if (seenFamilies.has(lowercaseName)) {
      return false;
    }
    seenFamilies.add(lowercaseName);
    return true;
  }).join(',');
}

/**
 * Normalizes each quoted row string of a `grid-template-areas` value.
 *
 * @param  {string} value  The `grid-template-areas` value.
 * @return {string}        The value with every row's whitespace and null cells collapsed.
 */
function normalizeGridTemplateAreas (value) {
  // Normalize each quoted grid-template-areas row string
  return value.replace(/"([^"]*)"/g, (match, inner) => {
    // Collapse whitespace to single space within grid row
    let normalized = inner.replace(/\s+/g, ' ').trim();
    // Collapse consecutive dots (null cell tokens) to a single dot
    normalized = normalized.replace(/(^| )\.{2,}(?= |$)/g, '$1.');
    return '"' + normalized + '"';
  });
}

/**
 * Converts `display-p3` neutral grays to sRGB hex, since a gray with equal
 * channels is the same color in either gamut.
 *
 * @param  {string} value  The CSS value string.
 * @return {string}        The value with display-p3 grays written as hex.
 */
function convertDisplayP3GraysToHex (value) {
  // Match color(display-p3 X X X) with three identical channels and an optional slash-delimited alpha
  return value.replace(/\bcolor\(display-p3\s+([\d.]+)\s+\1\s+\1(?:\s*\/\s*(-?(?:\d+|\d*\.\d+)%?))?\s*\)/gi, (match, channelText, alphaText) => {
    const channelValue = parseFloat(channelText);
    const channel = Math.round(channelValue * 255);
    return rgbaToHex(channel, channel, channel, parseAlphaString(alphaText));
  });
}

/**
 * Minifies a `background` value by removing the components that only restate
 * their defaults, then normalizing the separator between each layer's image
 * and its position.
 *
 * @param  {string} value      The `background` value.
 * @param  {Array}  urlTokens  URL tokens currently represented by markers.
 * @return {string}            The minified value.
 */
function minifyBackgroundValue (value, urlTokens) {
  let normalized = value
    // Remove default "0 0" background-position values
    .replace(/(?:^|\s)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ' ')
    // Remove "0 0" background-position after a close-paren (e.g. after url())
    .replace(/\)0(?:%|px)? 0(?:%|px)?(?=\s|$)/g, ') ')
    // Remove default "repeat" background-repeat keyword (excluding compound values like no-repeat)
    .replace(/(?<!-)\brepeat\b(?!-)/g, ' ')
    // Remove default "scroll" background-attachment keyword
    .replace(/\bscroll\b/g, ' ')
    // Remove default "none" background-image keyword
    .replace(/\bnone\b/g, ' ')
    // Collapse whitespace to single space
    .replace(/\s+/g, ' ')
    .trim();
  normalized = removeDefaultBackgroundPositionsAfterUrlTokens(normalized, urlTokens);
  return normalizeImagePositionSeparator(normalized || value);
}

/**
 * Minifies a `transform` value, then removes the whitespace between its
 * consecutive transform functions.
 *
 * @param  {string} value  The `transform` value.
 * @return {string}        The minified value.
 */
function minifyTransformProperty (value) {
  // Remove whitespace between consecutive transform functions
  return minifyTransformValue(value).replace(/\)\s+(?=[a-z-]+\()/gi, ')');
}

/**
 * Collapses a `scale` value to the fewest axis components that state the
 * same scaling, since an unstated y axis repeats x and an unstated z axis is 1.
 *
 * @param  {string} value  The `scale` value.
 * @return {string}        The collapsed value.
 */
function collapseScaleValue (value) {
  // Split scale value on whitespace into individual axis components
  const parts = value.split(/\s+/).filter(Boolean).map(normalizeScaleComponent);
  if (parts.length === 2 && parts[0] === parts[1]) {
    return parts[0];
  }
  if (parts.length === 3 && parts[2] === '1') {
    if (parts[0] === parts[1]) {
      return parts[0];
    }
    return parts[0] + ' ' + parts[1];
  }
  return parts.join(' ');
}

/**
 * Collapses a box-model shorthand value to the fewest components that state
 * the same edges.
 *
 * @param  {string} value  The shorthand value.
 * @return {string}        The collapsed value.
 */
function collapseBoxShorthandValue (value) {
  // Split components instead of splitting on spaces, so values that legally
  // touch, like the adjacent hex colors of `#ddd#ddd`, count separately
  return collapseShorthandParts(splitTopLevelComponents(value))
    .join(' ')
    // A hash token may touch the component before it, so the separator space is not needed
    .replace(/ #/g, '#');
}

/**
 * Collapses each slash-separated half of a `border-radius` value to the fewest
 * components that state the same corners.
 *
 * @param  {string} value  The `border-radius` value.
 * @return {string}        The collapsed value.
 */
function collapseBorderRadiusValue (value) {
  const segments = value.split('/').map((segment) => {
    return segment.trim();
  }).filter(Boolean).map((segment) => {
    // Split each segment on whitespace and collapse redundant parts
    return collapseShorthandParts(segment.split(/\s+/)).join(' ');
  });
  return segments.join('/');
}

/**
 * Applies property-specific optimizations to a CSS value (transition, flex, font,
 * background, display, scale, border-radius, shorthand collapsing, etc.).
 *
 * @param  {string} value      The CSS value string after generic minification.
 * @param  {string} property   The CSS property name.
 * @param  {Array}  urlTokens  URL tokens currently represented by markers.
 * @return {string}            The value with property-specific optimizations applied.
 */
function applyPropertyOptimizations (value, property, urlTokens) {
  if (property === 'font-weight' && isUnicodeCharset()) {
    value = convertFontWeightKeywords(value);
  }

  // Convert ms to s for time-related properties when the seconds form is shorter
  if (TIME_PROPERTIES.has(property)) {
    value = convertTimesToShortestUnit(value);
  }

  if (property === 'transition') {
    value = minifyTransitionValue(value);
  }

  if (property === 'animation') {
    value = minifyAnimationValue(value);
  }

  if (property === 'flex') {
    value = minifyFlexValue(value);
  }

  // Initial values
  value = resolveInitialKeyword(value, property);
  value = replaceWithShorterEquivalentValue(value, property);

  if (property === 'background-position') {
    value = convertBackgroundPositionKeywords(value);
  }

  if (property === 'border') {
    value = reorderBorderWidthBeforeStyle(value);
  }

  if (property === 'flex-flow') {
    value = reorderFlexFlowValue(value);
  }

  if (property === 'font-family') {
    value = minifyFontFamilyValue(value);
  }

  if (property === 'grid-template-areas') {
    value = normalizeGridTemplateAreas(value);
  }

  // Custom properties hold an arbitrary token stream rather than a typed value,
  // so a unit-like token in one is not necessarily a length.
  if (!isCustomProperty(property)) {
    value = replaceOutsideStringsAndUrls(value, convertAbsoluteLengthsToPx);
  }

  if (property === 'syntax') {
    // Remove whitespace around pipe separators in @property syntax descriptors
    value = value.replace(/\s*\|\s*/g, '|');
  }

  // Simplify clamp() where all three arguments are identical (e.g. clamp(1rem,1rem,1rem) → 1rem)
  value = value.replace(/\bclamp\(([^,]+),\1,\1\)/gi, '$1');

  value = convertDisplayP3GraysToHex(value);

  // Font families may contain color names, but never color values.
  if (property !== 'font' && property !== 'font-family') {
    value = replaceOutsideStringsAndUrls(value, (segment) => {
      return shortenColorValues(segment);
    });
  }

  if (!PUNCTUATED_COMPONENT_PROPERTIES.has(property)) {
    // Restore space after close-paren when followed by an alphanumeric, hash, or hyphen
    value = value.replace(/\)(?=[0-9a-zA-Z#-])/g, ') ');
  }
  value = restoreSpaceBeforeMathOperators(value);

  if (property === 'font') {
    value = minifyFontShorthand(value);
  }

  if (property === 'background' && value !== 'none') {
    value = minifyBackgroundValue(value, urlTokens);
  }

  if (property === 'mask') {
    value = normalizeImagePositionSeparator(value);
  }

  if (property === 'border') {
    value = removeDefaultBorderWidth(value);
  }

  if (property === 'outline') {
    value = separateOutlineStyleFromColor(value);
  }

  if (property === 'transform') {
    value = minifyTransformProperty(value);
  }

  if (property === 'scale') {
    value = collapseScaleValue(value);
  }

  // Replace multiple spaces
  value = value.replace(/\s+/g, ' ');

  if (COLLAPSIBLE_BOX_SHORTHAND_PROPERTIES.has(property)) {
    value = collapseBoxShorthandValue(value);
  }

  if (property === 'hyphenate-limit-chars') {
    value = collapseHyphenateLimitChars(value);
  }

  if (property === 'border-radius') {
    value = collapseBorderRadiusValue(value);
  }

  return value;
}

export {
  applyPropertyOptimizations,
  PUNCTUATED_COMPONENT_PROPERTIES
};
