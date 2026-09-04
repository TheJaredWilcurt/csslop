/**
 * @file Folds longhand declarations that follow their own shorthand back into that shorthand, whenever restating the whole shorthand is shorter than keeping the shorthand and its overrides apart.
 */

import { splitTopLevelComponents } from '../value/syntax.js';

import {
  CSS_WIDE_KEYWORDS,
  expandToLeafProperties,
  shorthandMap
} from './config.js';
import { describeDeclaration } from './lookup.js';
import { canMergeVarValue } from './merge.js';
import { buildShorthandValue } from './shorthand-values.js';

/**
 * The shorthands whose value is a positional list of the values of their
 * longhands: either a start/end pair or the four sides of a box. Only these can
 * be expanded back into one value per longhand and rebuilt around an override.
 *
 * @type {Array}
 */
const POSITIONAL_SHORTHAND_NAMES = [
  'margin',
  'padding',
  'inset',
  'gap',
  'overflow',
  'place-items',
  'place-content',
  'place-self',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'margin-inline',
  'margin-block',
  'padding-inline',
  'padding-block',
  'inset-inline',
  'inset-block',
  'border-inline-width',
  'border-block-width'
];

/**
 * The words of the property names that describe the same box as a shorthand,
 * computed on first use. The shorthand tables never change, so a shorthand
 * always has the same family.
 *
 * @type {Map<string, Set<string>>}
 */
const familyWordsByShorthand = new Map();

/**
 * Collects the hyphen separated words of a shorthand and of every longhand it
 * sets. Logical properties such as `padding-inline-start` describe the same box
 * as physical ones such as `padding-right`, but which physical side they map to
 * depends on the writing mode, so the words of the names are what relates them.
 *
 * @param  {string} shorthandName  The CSS shorthand property name.
 * @return {Set}                   The words that mark a property as part of the same family.
 */
function collectFamilyWords (shorthandName) {
  const cachedWords = familyWordsByShorthand.get(shorthandName);
  if (cachedWords) {
    return cachedWords;
  }
  const words = new Set(shorthandName.split('-'));
  for (const leafProperty of expandToLeafProperties(shorthandName)) {
    for (const word of leafProperty.split('-')) {
      words.add(word);
    }
  }
  familyWordsByShorthand.set(shorthandName, words);
  return words;
}

/**
 * Checks whether a property might set part of the same box as a shorthand,
 * which it does when the two names have a word in common.
 *
 * @param  {string}  property     The property name to classify.
 * @param  {Set}     familyWords  The words of the shorthand's family.
 * @return {boolean}              Whether the property belongs to the same family.
 */
function belongsToFamily (property, familyWords) {
  return property.split('-').some((word) => {
    return familyWords.has(word);
  });
}

/**
 * @typedef  {object} FoldCandidate
 * @property {object} shorthandEntry   The description of the shorthand declaration.
 * @property {Array}  overrideEntries  The descriptions of the longhands that follow it.
 */

/**
 * Finds the shorthand of a family and the longhands declared after it, which
 * are the declarations a fold would replace with a single shorthand. A family
 * that states its shorthand or one of its longhands twice keeps an intentional
 * fallback, so it is left alone.
 *
 * @param  {Array}              declarations   The declarations of a single rule, in source order.
 * @param  {string}             shorthandName  The CSS shorthand property name.
 * @return {FoldCandidate|null}                The declarations to fold, or null when there are none.
 */
function findFoldCandidate (declarations, shorthandName) {
  const longhandProperties = new Set(shorthandMap[shorthandName]);
  const shorthandEntries = [];
  const overrideEntries = [];
  const overriddenProperties = new Set();
  let hasRepeatedOverride = false;

  declarations.forEach((declaration, index) => {
    if (declaration.property === shorthandName) {
      shorthandEntries.push(describeDeclaration(declaration, index));
      return;
    }
    if (!shorthandEntries.length || !longhandProperties.has(declaration.property)) {
      return;
    }
    if (overriddenProperties.has(declaration.property)) {
      hasRepeatedOverride = true;
    }
    overriddenProperties.add(declaration.property);
    overrideEntries.push(describeDeclaration(declaration, index));
  });

  if (shorthandEntries.length !== 1 || !overrideEntries.length || hasRepeatedOverride) {
    return null;
  }
  return {
    shorthandEntry: shorthandEntries[0],
    overrideEntries
  };
}

/**
 * Checks whether a declaration lying between the shorthand and the last of its
 * overrides would change meaning once the overrides move up to the shorthand.
 * Only a declaration from another family is harmless, and a nested rule is
 * never safe to step over because its own declarations may set the same box.
 *
 * @param  {Array}   declarations   The declarations of a single rule, in source order.
 * @param  {string}  shorthandName  The CSS shorthand property name.
 * @param  {object}  candidate      The shorthand and the longhands that follow it.
 * @return {boolean}                Whether nothing stands in the way of the fold.
 */
function isFoldPathClear (declarations, shorthandName, candidate) {
  const { shorthandEntry, overrideEntries } = candidate;
  const foldedIndexes = new Set(overrideEntries.map((entry) => {
    return entry.index;
  }));
  const lastOverrideIndex = overrideEntries[overrideEntries.length - 1].index;
  const familyWords = collectFamilyWords(shorthandName);

  for (let index = shorthandEntry.index + 1; index < lastOverrideIndex; index++) {
    if (foldedIndexes.has(index)) {
      continue;
    }
    const { property } = declarations[index];
    if (!property || belongsToFamily(property, familyWords)) {
      return false;
    }
  }
  return true;
}

/**
 * Determines whether a value can stand as one component of a positional
 * shorthand. A CSS-wide keyword is only valid as a declaration's entire value,
 * a `/` separates the two radii of a corner rather than two components, and a
 * `var()` may expand to any number of components at computed value time.
 *
 * @param  {string}  component  The value component to check.
 * @param  {object}  context    The minification context with registered custom property data.
 * @return {boolean}            Whether the component can be positioned in a shorthand.
 */
function isPositionalComponent (component, context) {
  return (
    !component.includes('/') &&
    !CSS_WIDE_KEYWORDS.has(component.toLowerCase()) &&
    canMergeVarValue(component, context)
  );
}

/**
 * Expands the components of a positional shorthand into one value per longhand,
 * repeating the value of the opposite side for every component the author left
 * out, as the CSS box model rules require.
 *
 * @param  {Array}  components     The value components the shorthand was written with.
 * @param  {number} longhandCount  The number of longhands the shorthand sets.
 * @return {Array}                 One value per longhand, in longhand order.
 */
function expandPositionalComponents (components, longhandCount) {
  if (longhandCount === 2) {
    const [start, end = start] = components;
    return [start, end];
  }
  const [top, right = top, bottom = top, left = right] = components;
  return [top, right, bottom, left];
}

/**
 * Rebuilds a shorthand from its own value plus the longhands declared after it.
 *
 * @param  {string}      shorthandName  The CSS shorthand property name.
 * @param  {object}      candidate      The shorthand and the longhands that follow it.
 * @param  {object}      context        The minification context with registered custom property data.
 * @return {string|null}                The rebuilt shorthand value, or null when it cannot be built.
 */
function buildFoldedValue (shorthandName, candidate, context) {
  const { shorthandEntry, overrideEntries } = candidate;
  const longhands = shorthandMap[shorthandName];
  const components = splitTopLevelComponents(shorthandEntry.value);
  if (!components.length || components.length > longhands.length) {
    return null;
  }

  const expandedValues = expandPositionalComponents(components, longhands.length);
  const valueByProperty = new Map(longhands.map((property, index) => {
    return [property, expandedValues[index]];
  }));
  for (const entry of overrideEntries) {
    const overrideComponents = splitTopLevelComponents(entry.value);
    if (overrideComponents.length !== 1) {
      return null;
    }
    valueByProperty.set(entry.property, entry.value);
  }

  const cleanValues = longhands.map((property) => {
    return valueByProperty.get(property);
  });
  const areAllPositional = cleanValues.every((value) => {
    return isPositionalComponent(value, context);
  });
  if (!areAllPositional) {
    return null;
  }

  return buildShorthandValue(shorthandName, {
    properties: longhands,
    valueMap: valueByProperty,
    cleanValues,
    importantSuffix: shorthandEntry.isImportant ? '!important' : ''
  });
}

/**
 * Replaces a shorthand and the longhands declared after it with the single
 * shorthand that states the same box.
 *
 * @param  {Array}  declarations   The declarations of a single rule, in source order.
 * @param  {string} shorthandName  The CSS shorthand property name.
 * @param  {object} candidate      The shorthand and the longhands that follow it.
 * @param  {string} foldedValue    The rebuilt shorthand value.
 * @return {Array}                 The declarations, with the family stated once.
 */
function applyFold (declarations, shorthandName, candidate, foldedValue) {
  const { shorthandEntry, overrideEntries } = candidate;
  const foldedIndexes = new Set(overrideEntries.map((entry) => {
    return entry.index;
  }));
  return declarations.flatMap((declaration, index) => {
    if (index === shorthandEntry.index) {
      return [{
        property: shorthandName,
        value: foldedValue,
        isAssembledShorthand: true
      }];
    }
    if (foldedIndexes.has(index)) {
      return [];
    }
    return [declaration];
  });
}

/**
 * Folds the longhands that follow one shorthand back into it, when the single
 * rebuilt shorthand is shorter than the declarations it replaces.
 *
 * @param  {Array}  declarations   The declarations of a single rule, in source order.
 * @param  {string} shorthandName  The CSS shorthand property name.
 * @param  {object} context        The minification context with registered custom property data.
 * @return {Array}                 The declarations, folded when that is shorter.
 */
function foldOverridesIntoShorthand (declarations, shorthandName, context) {
  const candidate = findFoldCandidate(declarations, shorthandName);
  if (!candidate) {
    return declarations;
  }

  // A shorthand and a longhand of differing importance do not describe one
  // cascade step, so the pair cannot be restated as a single declaration.
  const { shorthandEntry, overrideEntries } = candidate;
  const shareImportance = overrideEntries.every((entry) => {
    return entry.isImportant === shorthandEntry.isImportant;
  });
  if (!shareImportance || !isFoldPathClear(declarations, shorthandName, candidate)) {
    return declarations;
  }

  const foldedValue = buildFoldedValue(shorthandName, candidate, context);
  if (!foldedValue) {
    return declarations;
  }

  const foldedLength = (shorthandName + ':' + foldedValue).length;
  const originalLength = [shorthandEntry.text, ...overrideEntries.map((entry) => {
    return entry.text;
  })].join(';').length;
  if (foldedLength >= originalLength) {
    return declarations;
  }

  return applyFold(declarations, shorthandName, candidate, foldedValue);
}

/**
 * Folds every longhand that follows its own shorthand back into that shorthand.
 * A longhand after a shorthand only overrides the one side the shorthand had
 * already set, so `padding:10px;padding-right:20px` states the same box as
 * `padding:10px 20px 10px 10px`, and the shorter of the two is kept.
 *
 * @param  {Array}  declarations  The declarations of a single rule, in source order.
 * @param  {object} context       The minification context with registered custom property data.
 * @return {Array}                The declarations, with eligible families folded.
 */
function foldLonghandOverridesIntoShorthands (declarations, context) {
  let result = declarations;
  for (const shorthandName of POSITIONAL_SHORTHAND_NAMES) {
    result = foldOverridesIntoShorthand(result, shorthandName, context);
  }
  return result;
}

export { foldLonghandOverridesIntoShorthands };
