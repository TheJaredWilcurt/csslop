/**
 * @file Rewrites longhand declarations that share a CSS-wide keyword into a shorthand carrying that keyword, followed by the longhands that override it.
 */

import { minifyValue } from '../value/minify.js';

import {
  CSS_WIDE_KEYWORDS,
  shorthandMap,
  shorthandOverrideMap
} from './config.js';

/**
 * Expands a property into the set of leaf longhands it ultimately sets, so that
 * different groupings of the same box, such as `border-width` and
 * `border-top-width`, can be compared for equivalent coverage.
 *
 * @param  {string} property        The property name to expand.
 * @param  {Set}    leafProperties  The set collecting the leaf longhand names.
 * @return {Set}                    The set of leaf longhand property names.
 */
function expandToLeafProperties (property, leafProperties = new Set()) {
  const longhands = shorthandMap[property];
  if (!longhands) {
    leafProperties.add(property);
    return leafProperties;
  }
  for (const longhand of longhands) {
    expandToLeafProperties(longhand, leafProperties);
  }
  return leafProperties;
}

/**
 * Checks whether a group of longhands sets every leaf longhand that the
 * shorthand sets. A CSS-wide keyword may only move into the shorthand when the
 * group covers all of them, otherwise the keyword would also land on a longhand
 * the author never declared.
 *
 * @param  {string}  shorthandName  The target shorthand property name.
 * @param  {Array}   properties     The longhand property names in the group.
 * @return {boolean}                Whether the group covers the whole shorthand.
 */
function coversEveryLonghandOfShorthand (shorthandName, properties) {
  const coveredLeaves = new Set();
  for (const property of properties) {
    expandToLeafProperties(property, coveredLeaves);
  }
  return [...expandToLeafProperties(shorthandName)].every((leafProperty) => {
    return coveredLeaves.has(leafProperty);
  });
}

/**
 * @typedef  {object}  LonghandEntry
 * @property {object}  declaration    The original declaration object.
 * @property {number}  index          The declaration's index within the rule.
 * @property {string}  property       The longhand property name.
 * @property {string}  text           The minified `property:value` text.
 * @property {string}  value          The minified value, without any `!important`.
 * @property {boolean} isImportant    Whether the declaration carries `!important`.
 */

/**
 * Collects the declarations of a rule that set one of a shorthand's longhands,
 * in source order.
 *
 * @param  {Array}  declarations   The declarations of a single rule.
 * @param  {string} shorthandName  The shorthand whose longhands to collect.
 * @return {Array}                 The matching longhand entries, in source order.
 */
function collectLonghandEntries (declarations, shorthandName) {
  const longhands = shorthandMap[shorthandName];
  const entries = [];
  declarations.forEach((declaration, index) => {
    if (!declaration.property || !longhands.includes(declaration.property)) {
      return;
    }
    const minifiedValue = minifyValue(declaration);
    const isImportant = minifiedValue.includes('!important');
    entries.push({
      declaration,
      index,
      property: declaration.property,
      text: declaration.property + ':' + minifiedValue,
      value: minifiedValue.replace('!important', '').trim(),
      isImportant
    });
  });
  return entries;
}

/**
 * Checks whether a group declares the same property more than once, which
 * happens when an intentional fallback was kept. Rewriting such a group would
 * drop one of the two declarations, so it is left alone.
 *
 * @param  {Array}   entries  The longhand entries of the group.
 * @return {boolean}          Whether any property appears more than once.
 */
function hasRepeatedProperty (entries) {
  const seenProperties = new Set();
  return entries.some((entry) => {
    if (seenProperties.has(entry.property)) {
      return true;
    }
    seenProperties.add(entry.property);
    return false;
  });
}

/**
 * Resolves the `!important` suffix the shorthand must carry. A group that mixes
 * important and normal longhands cannot be rewritten, because the shorthand
 * would either lose or gain priority over the longhands it replaces.
 *
 * @param  {Array}       entries  The longhand entries of the group.
 * @return {string|null}          The suffix to append, or null when the group cannot be rewritten.
 */
function resolveImportantSuffix (entries) {
  const allImportant = entries.every((entry) => {
    return entry.isImportant;
  });
  if (allImportant) {
    return '!important';
  }
  const noneImportant = entries.every((entry) => {
    return !entry.isImportant;
  });
  if (noneImportant) {
    return '';
  }
  return null;
}

/**
 * Resolves the single CSS-wide keyword shared by the longhands that use one.
 * A group with no keyword has nothing to hoist, and a group mixing different
 * keywords has no single value the shorthand could carry.
 *
 * @param  {Array}       entries  The longhand entries of the group.
 * @return {string|null}          The shared keyword, or null when there is none.
 */
function resolveSharedKeyword (entries) {
  const keywords = entries.filter((entry) => {
    return CSS_WIDE_KEYWORDS.has(entry.value.toLowerCase());
  }).map((entry) => {
    return entry.value.toLowerCase();
  });
  if (!keywords.length) {
    return null;
  }
  const isSharedByAll = keywords.every((keyword) => {
    return keyword === keywords[0];
  });
  if (!isSharedByAll) {
    return null;
  }
  return keywords[0];
}

/**
 * Checks whether a property the shorthand also resets, such as `border-image`
 * for `border`, is declared before the point where the shorthand would be
 * inserted. Inserting the shorthand there would discard that declaration.
 *
 * @param  {Array}   declarations    The declarations of a single rule.
 * @param  {string}  shorthandName   The target shorthand property name.
 * @param  {number}  insertionIndex  The index the shorthand would be inserted at.
 * @return {boolean}                 Whether an earlier declaration would be discarded.
 */
function resetsEarlierDeclaration (declarations, shorthandName, insertionIndex) {
  const resetProperties = shorthandOverrideMap[shorthandName] || [];
  if (!resetProperties.length) {
    return false;
  }
  return declarations.slice(0, insertionIndex).some((declaration) => {
    return resetProperties.includes(declaration.property);
  });
}

/**
 * Rewrites one longhand group into a shorthand holding the shared CSS-wide
 * keyword, followed by the longhands that override it, when that is shorter
 * than the group of longhands it replaces.
 *
 * @param  {Array}      declarations   The declarations of a single rule.
 * @param  {string}     shorthandName  The target shorthand property name.
 * @return {Array|null}                The rewritten declarations, or null when the rewrite does not apply.
 */
function rewriteGroupAsKeywordShorthand (declarations, shorthandName) {
  const shorthandAlreadyExists = declarations.some((declaration) => {
    return declaration.property === shorthandName;
  });
  if (shorthandAlreadyExists) {
    return null;
  }

  const entries = collectLonghandEntries(declarations, shorthandName);
  if (entries.length < 2 || hasRepeatedProperty(entries)) {
    return null;
  }
  const properties = entries.map((entry) => {
    return entry.property;
  });
  if (!coversEveryLonghandOfShorthand(shorthandName, properties)) {
    return null;
  }

  const importantSuffix = resolveImportantSuffix(entries);
  const sharedKeyword = resolveSharedKeyword(entries);
  if (importantSuffix === null || !sharedKeyword) {
    return null;
  }

  const insertionIndex = entries[0].index;
  if (resetsEarlierDeclaration(declarations, shorthandName, insertionIndex)) {
    return null;
  }

  // The longhands whose value is not the shared keyword have to be restated
  // after the shorthand, because the shorthand also set them to the keyword.
  const overrideEntries = entries.filter((entry) => {
    return entry.value.toLowerCase() !== sharedKeyword;
  });
  const shorthandDeclaration = {
    property: shorthandName,
    value: sharedKeyword + importantSuffix,
    isAssembledShorthand: true
  };
  const rewrittenLength = [shorthandDeclaration.property + ':' + shorthandDeclaration.value, ...overrideEntries.map((entry) => {
    return entry.text;
  })].join(';').length;
  const longhandLength = entries.map((entry) => {
    return entry.text;
  }).join(';').length;
  if (rewrittenLength >= longhandLength) {
    return null;
  }

  const groupIndexes = new Set(entries.map((entry) => {
    return entry.index;
  }));
  const result = [];
  declarations.forEach((declaration, index) => {
    if (index === insertionIndex) {
      result.push(shorthandDeclaration);
      for (const entry of overrideEntries) {
        result.push(entry.declaration);
      }
      return;
    }
    if (groupIndexes.has(index)) {
      return;
    }
    result.push(declaration);
  });
  return result;
}

/**
 * Hoists a CSS-wide keyword such as `inherit` out of a group of longhands into
 * their shorthand. A CSS-wide keyword is only valid as a declaration's whole
 * value, so `border-style:inherit;border-color:inherit;border-width:2px` cannot
 * become `border:2px inherit inherit`. It can however become `border:inherit`
 * followed by `border-width:2px`, which inherits every border property and then
 * overrides the one that differs.
 *
 * @param  {Array} declarations  The declarations of a single rule.
 * @return {Array}               The declarations, with eligible groups rewritten.
 */
function hoistCssWideKeywordsIntoShorthands (declarations) {
  let result = declarations;
  // Shorthands are visited in declaration order, so the widest shorthand of a
  // family is rewritten before the narrower shorthands it contains.
  for (const shorthandName of Object.keys(shorthandMap)) {
    const rewritten = rewriteGroupAsKeywordShorthand(result, shorthandName);
    if (rewritten) {
      result = rewritten;
    }
  }
  return result;
}

export { hoistCssWideKeywordsIntoShorthands };
