/**
 * @file Defines lookup tables mapping CSS shorthand properties to their constituent longhand properties and override relationships.
 */

const shorthandMap = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  overflow: ['overflow-x', 'overflow-y'],
  gap: ['row-gap', 'column-gap'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  border: ['border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color'],
  'border-image': ['border-image-source', 'border-image-slice', 'border-image-repeat'],
  'border-top': ['border-top-width', 'border-top-style', 'border-top-color'],
  'border-right': ['border-right-width', 'border-right-style', 'border-right-color'],
  'border-bottom': ['border-bottom-width', 'border-bottom-style', 'border-bottom-color'],
  'border-left': ['border-left-width', 'border-left-style', 'border-left-color'],
  'background-position': ['background-position-x', 'background-position-y'],
  background: ['background-color', 'background-image', 'background-repeat', 'background-position', 'background-position-x', 'background-position-y', 'background-attachment', 'background-size', 'background-origin', 'background-clip'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  columns: ['column-width', 'column-count'],
  'list-style': ['list-style-position', 'list-style-image', 'list-style-type'],
  'margin-inline': ['margin-inline-start', 'margin-inline-end'],
  'margin-block': ['margin-block-start', 'margin-block-end'],
  'padding-inline': ['padding-inline-start', 'padding-inline-end'],
  'padding-block': ['padding-block-start', 'padding-block-end'],
  'inset-inline': ['inset-inline-start', 'inset-inline-end'],
  'inset-block': ['inset-block-start', 'inset-block-end'],
  'border-inline': ['border-inline-start', 'border-inline-end', 'border-inline-width', 'border-inline-style', 'border-inline-color'],
  'border-block': ['border-block-start', 'border-block-end', 'border-block-width', 'border-block-style', 'border-block-color'],
  'border-inline-width': ['border-inline-start-width', 'border-inline-end-width'],
  'border-block-width': ['border-block-start-width', 'border-block-end-width'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  mask: ['mask-image', 'mask-repeat', 'mask-size'],
  'position-try': ['position-try-order', 'position-try-fallbacks'],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family']
};

const shorthandOverrideMap = {
  border: ['border-image', 'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'],
  font: ['font-variant', 'font-variant-alternates', 'font-variant-caps', 'font-variant-east-asian', 'font-variant-ligatures', 'font-variant-numeric', 'font-variant-position'],
  mask: ['mask-border', 'mask-border-source', 'mask-border-slice', 'mask-border-width', 'mask-border-outset', 'mask-border-repeat', 'mask-border-mode']
};

/**
 * CSS-wide keywords, which are only valid as the entire value of a declaration
 * and never as an individual component of a shorthand value.
 *
 * @type {Set<string>}
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Shorthand properties that themselves hold a full width/style/color value for a
 * single edge of a box, so they can only collapse into their parent shorthand
 * when every edge carries the exact same value.
 *
 * @type {Set<string>}
 */
const EDGE_SHORTHANDS = new Set([
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-inline-start',
  'border-inline-end',
  'border-block-start',
  'border-block-end'
]);

/**
 * The four physical edge shorthands that together cover the `border` shorthand.
 *
 * @type {Array}
 */
const BORDER_EDGE_PROPERTIES = ['border-top', 'border-right', 'border-bottom', 'border-left'];

/**
 * Converts a lookup table of property name to property list into the same
 * lookup keyed by name with each list as a set, so that "does this shorthand
 * cover that property" is a single key lookup rather than a list scan.
 *
 * @param  {object} propertyListsByName  A lookup of property name to an array of property names.
 * @return {Map}                         The same lookup with each array stored as a set.
 */
function createPropertySetLookup (propertyListsByName) {
  const setsByName = new Map();
  for (const [name, propertyList] of Object.entries(propertyListsByName)) {
    setsByName.set(name, new Set(propertyList));
  }
  return setsByName;
}

/**
 * The longhands of each shorthand, as sets for membership testing.
 *
 * @type {Map<string, Set<string>>}
 */
const LONGHANDS_BY_SHORTHAND = createPropertySetLookup(shorthandMap);

/**
 * The extra properties each shorthand resets, as sets for membership testing.
 *
 * @type {Map<string, Set<string>>}
 */
const OVERRIDES_BY_SHORTHAND = createPropertySetLookup(shorthandOverrideMap);

/**
 * An immutable empty set, returned for properties that are not shorthands so
 * callers can test membership without first checking for a missing entry.
 *
 * @type {Set<string>}
 */
const NO_PROPERTIES = new Set();

/**
 * Returns the set of longhands a shorthand expands into.
 *
 * @param  {string} shorthandName  The CSS shorthand property name.
 * @return {Set}                   The longhand property names, empty when the name is not a shorthand.
 */
function getLonghandsOf (shorthandName) {
  return LONGHANDS_BY_SHORTHAND.get(shorthandName) || NO_PROPERTIES;
}

/**
 * Returns the set of extra properties a shorthand resets beyond its longhands.
 *
 * @param  {string} shorthandName  The CSS shorthand property name.
 * @return {Set}                   The reset property names, empty when the shorthand resets nothing else.
 */
function getOverridesOf (shorthandName) {
  return OVERRIDES_BY_SHORTHAND.get(shorthandName) || NO_PROPERTIES;
}

export {
  BORDER_EDGE_PROPERTIES,
  CSS_WIDE_KEYWORDS,
  EDGE_SHORTHANDS,
  getLonghandsOf,
  getOverridesOf,
  shorthandMap,
  shorthandOverrideMap
};
