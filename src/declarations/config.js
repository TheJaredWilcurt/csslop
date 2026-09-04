/**
 * @file Defines lookup tables mapping CSS shorthand properties to their constituent longhand properties and override relationships.
 */

/**
 * The gap decoration rule components that CSS Gaps 1 defines once per
 * direction, as a `column-rule-*` and a `row-rule-*` longhand.
 *
 * @type {Array}
 */
const GAP_DECORATION_RULE_COMPONENTS = [
  'width',
  'style',
  'color',
  'break',
  'visibility-items',
  'inset-cap-start',
  'inset-cap-end',
  'inset-junction-start',
  'inset-junction-end'
];

/**
 * Builds the bidirectional `rule-*` gap decoration shorthands, each of which
 * applies a single value to both the column and the row longhand of one gap
 * decoration component.
 *
 * @return {object} A lookup of shorthand name to its column and row longhands.
 */
function createBidirectionalGapRuleShorthands () {
  const shorthands = {};
  for (const component of GAP_DECORATION_RULE_COMPONENTS) {
    shorthands['rule-' + component] = ['column-rule-' + component, 'row-rule-' + component];
  }
  return shorthands;
}

/**
 * The bidirectional gap decoration shorthands, keyed by shorthand name.
 *
 * @type {object}
 */
const BIDIRECTIONAL_GAP_RULE_SHORTHANDS = createBidirectionalGapRuleShorthands();

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
  columns: ['column-width', 'column-count', 'column-height'],
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
  mask: ['mask-image', 'mask-position', 'mask-size', 'mask-repeat'],
  'position-try': ['position-try-order', 'position-try-fallbacks'],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  marker: ['marker-start', 'marker-mid', 'marker-end'],
  ...BIDIRECTIONAL_GAP_RULE_SHORTHANDS
};

const shorthandOverrideMap = {
  animation: ['animation-timeline', 'animation-range', 'animation-range-start', 'animation-range-end'],
  columns: ['column-wrap'],
  border: ['border-image', 'border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'],
  font: ['font-variant', 'font-variant-alternates', 'font-variant-caps', 'font-variant-east-asian', 'font-variant-ligatures', 'font-variant-numeric', 'font-variant-position', 'font-feature-settings', 'font-kerning', 'font-language-override', 'font-optical-sizing', 'font-size-adjust', 'font-variation-settings'],
  mask: ['mask-border', 'mask-border-source', 'mask-border-slice', 'mask-border-width', 'mask-border-outset', 'mask-border-repeat', 'mask-border-mode', 'mask-origin', 'mask-clip', 'mask-composite', 'mask-mode']
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
 * Shorthands that apply one value to every longhand they set, such as the SVG
 * `marker` shorthand and the bidirectional gap decoration rules. They have no
 * way to express longhands that differ, so a group of longhands only collapses
 * into them when every longhand already holds the same value.
 *
 * @type {Set<string>}
 */
const UNIFORM_VALUE_SHORTHANDS = new Set([
  'marker',
  ...Object.keys(BIDIRECTIONAL_GAP_RULE_SHORTHANDS)
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

/**
 * The words a longhand adds to its shorthand's name to say which side, axis,
 * corner, or alignment dimension of the box that longhand applies to, such as
 * the `top` of `padding-top` or the `row` of `row-gap`.
 *
 * @type {Set<string>}
 */
const BOX_PART_WORDS = new Set([
  'align',
  'block',
  'bottom',
  'column',
  'end',
  'inline',
  'justify',
  'left',
  'right',
  'row',
  'start',
  'top',
  'x',
  'y'
]);

/**
 * Removes each of the shorthand's own words from a longhand's words, leaving
 * only the words the longhand adds to name the part of the box it covers. Each
 * shared word is removed once, so the `border` and the `radius` of
 * `border-radius` leave `top` and `left` behind in `border-top-left-radius`.
 *
 * @param  {Array} longhandWords   The hyphen-separated words of the longhand's name.
 * @param  {Array} shorthandWords  The hyphen-separated words of the shorthand's name.
 * @return {Array}                 The words the longhand adds on top of the shorthand's.
 */
function subtractSharedWords (longhandWords, shorthandWords) {
  const remainingWords = [...longhandWords];
  for (const shorthandWord of shorthandWords) {
    const wordIndex = remainingWords.indexOf(shorthandWord);
    if (wordIndex !== -1) {
      remainingWords.splice(wordIndex, 1);
    }
  }
  return remainingWords;
}

/**
 * Whether each shorthand takes a positional list of components, computed on
 * first use, since the shorthand tables never change.
 *
 * @type {Map<string, boolean>}
 */
const positionalComponentsByShorthand = new Map();

/**
 * Reports whether a shorthand's value is a positional list of same-typed
 * components rather than an unordered set of components that its grammar tells
 * apart by type. A shorthand is positional when its longhands are the very same
 * property repeated for each part of the box, as `padding` repeats a length for
 * each side and `gap` repeats one for each axis. Nothing but the order the
 * components are written in says which part of the box each one lands on, so
 * the whitespace between them delimits the list. A shorthand such as `border`
 * or `font`, whose longhands each hold a different kind of value, is not
 * positional: its grammar reads each component by type, in any order.
 *
 * @param  {string}  shorthandName  The CSS property name to test.
 * @return {boolean}                Whether the shorthand's components are positional.
 */
function hasPositionalComponents (shorthandName) {
  const cachedAnswer = positionalComponentsByShorthand.get(shorthandName);
  if (cachedAnswer !== undefined) {
    return cachedAnswer;
  }
  const longhands = shorthandMap[shorthandName];
  let isPositional = false;
  if (Array.isArray(longhands)) {
    const shorthandWords = shorthandName.split('-');
    isPositional = longhands.every((longhand) => {
      const addedWords = subtractSharedWords(longhand.split('-'), shorthandWords);
      return Boolean(addedWords.length) && addedWords.every((word) => {
        return BOX_PART_WORDS.has(word);
      });
    });
  }
  positionalComponentsByShorthand.set(shorthandName, isPositional);
  return isPositional;
}

/**
 * The leaf longhands each property ultimately sets, computed on first use. The
 * shorthand tables never change, so a property always expands the same way.
 *
 * @type {Map<string, Set<string>>}
 */
const leafPropertiesByProperty = new Map();

/**
 * Expands a property into the set of leaf longhands it ultimately sets, so that
 * different groupings of the same box, such as `border-width` and
 * `border-top-width`, can be compared for equivalent coverage.
 *
 * @param  {string} property  The property name to expand.
 * @return {Set}              The set of leaf longhand property names.
 */
function expandToLeafProperties (property) {
  const cachedLeaves = leafPropertiesByProperty.get(property);
  if (cachedLeaves) {
    return cachedLeaves;
  }
  const leafProperties = new Set();
  const longhands = shorthandMap[property];
  if (!longhands) {
    leafProperties.add(property);
  } else {
    for (const longhand of longhands) {
      for (const leafProperty of expandToLeafProperties(longhand)) {
        leafProperties.add(leafProperty);
      }
    }
  }
  leafPropertiesByProperty.set(property, leafProperties);
  return leafProperties;
}

export {
  BORDER_EDGE_PROPERTIES,
  CSS_WIDE_KEYWORDS,
  EDGE_SHORTHANDS,
  expandToLeafProperties,
  getLonghandsOf,
  getOverridesOf,
  hasPositionalComponents,
  shorthandMap,
  shorthandOverrideMap,
  UNIFORM_VALUE_SHORTHANDS
};
