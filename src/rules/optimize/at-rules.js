/**
 * @file Consolidates grouping at-rules by merging matching `@media` and `@layer` blocks, and drops the `@keyframes` that a later definition replaces.
 */

import {
  containsIEHack,
  normalizeLayerNames,
  normalizeMedia
} from '../normalize.js';

import {
  expandToOverridableProperties,
  isPropertyDeclaration
} from './declaration-writes.js';

/**
 * Removes `@media` rules that contain IE10/IE11 exclusive hacks (the `\0` character).
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with IE-exclusive media queries removed.
 */
function removeIEMediaRules (rules) {
  return rules.filter((rule) => {
    if (rule.type === 'media' && containsIEHack(rule.media)) {
      return false;
    }
    return true;
  });
}

/**
 * Matches the media type keyword that opens a normalized `@media` query, such as `screen` in `screen and (width>=768px)`.
 *
 * @type {RegExp}
 */
const LEADING_MEDIA_TYPE_PATTERN = /^[a-z-]+(?=\s|$)/i;

/**
 * Matches one parenthesized media condition, allowing one level of nested parentheses such as `(not (color))`.
 *
 * @type {RegExp}
 */
const PARENTHESIZED_CONDITION_PATTERN = /\((?:[^()]|\([^()]*\))*\)/g;

/**
 * Splits a `@media` query into the media type it names and the conditions it adds, so that two queries can be joined with `and`. Queries that use a list, `not`, or `only` cannot be joined this way.
 *
 * @param  {string}      media  The raw `@media` query string.
 * @return {object|null}        The `type` (null when none applies) and `conditions` text, or null when the query cannot be joined.
 */
function parseJoinableMediaQuery (media) {
  const normalized = normalizeMedia(media);
  const typeText = normalized.match(LEADING_MEDIA_TYPE_PATTERN)?.[0] ?? '';
  const typeName = typeText.toLowerCase();
  if (normalized.includes(',') || typeName === 'not' || typeName === 'only') {
    return null;
  }
  // Drop the `and` that separates the media type from the conditions
  const conditions = normalized.slice(typeText.length).replace(/^\s*and\s*/i, '');
  // Anything left once the parenthesized conditions and `and` joiners are removed is an unsupported operator
  const unparsedText = conditions.replace(PARENTHESIZED_CONDITION_PATTERN, '').replace(/\band\b/gi, '').trim();
  if (unparsedText) {
    return null;
  }
  return {
    // `all` matches every document, so it adds no restriction of its own
    type: typeName && typeName !== 'all' ? typeName : null,
    conditions
  };
}

/**
 * Reports whether two queries name different media types. A document has only one media type, so a block requiring both can never match.
 *
 * @param  {object|null} outer  The parsed enclosing query, from `parseJoinableMediaQuery`.
 * @param  {object|null} inner  The parsed nested query, from `parseJoinableMediaQuery`.
 * @return {boolean}            True when the two queries name different media types.
 */
function areExclusiveMediaTypes (outer, inner) {
  return Boolean(outer?.type && inner?.type && outer.type !== inner.type);
}

/**
 * Joins a `@media` block nested directly inside another into the single query that matches the same documents, such as `screen and (width>=768px)`. A media type both queries share is written once.
 *
 * @param  {string}      outerMedia  The raw query of the enclosing `@media` block.
 * @param  {string}      innerMedia  The raw query of the nested `@media` block.
 * @return {string|null}             The joined query, or null when the pair must stay nested.
 */
function joinNestedMediaQueries (outerMedia, innerMedia) {
  const outer = parseJoinableMediaQuery(outerMedia);
  const inner = parseJoinableMediaQuery(innerMedia);
  if (!outer || !inner || areExclusiveMediaTypes(outer, inner)) {
    return null;
  }
  const parts = [outer.type || inner.type, outer.conditions, inner.conditions].filter(Boolean);
  return parts.join(' and ') || 'all';
}

/**
 * Reports whether an entry of a rule list is real content rather than the whitespace between entries.
 *
 * @param  {object}  entry  An entry of a rule list.
 * @return {boolean}        True when the entry is not whitespace.
 */
function isContentEntry (entry) {
  return entry.type !== 'whitespace';
}

/**
 * Simplifies one `@media` block. A block whose only content is a single nested `@media` block is joined into one query, and the simplification repeats on the result. Nested `@media` blocks whose media type the block already excludes are removed.
 *
 * @param  {object} rule  The `@media` rule node to simplify.
 * @return {object}       A new `@media` rule node.
 */
function simplifyMediaBlock (rule) {
  const children = rule.rules || [];
  const content = children.filter(isContentEntry);
  if (content.length === 1 && content[0].type === 'media') {
    const joinedMedia = joinNestedMediaQueries(rule.media, content[0].media);
    if (joinedMedia !== null) {
      return simplifyMediaBlock({ ...content[0], media: joinedMedia });
    }
  }
  const outerQuery = parseJoinableMediaQuery(rule.media);
  return {
    ...rule,
    rules: children.filter((child) => {
      return !(child.type === 'media' && areExclusiveMediaTypes(outerQuery, parseJoinableMediaQuery(child.media)));
    })
  };
}

/**
 * Simplifies the `@media` blocks in a rule list, dropping any block whose content was removed entirely as dead.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with nested `@media` blocks simplified.
 */
function simplifyNestedMediaRules (rules) {
  return rules.flatMap((rule) => {
    if (rule.type !== 'media') {
      return [rule];
    }
    const simplified = simplifyMediaBlock(rule);
    const hadContent = (rule.rules || []).some(isContentEntry);
    const isEmptiedByDeadContent = hadContent && !simplified.rules.some(isContentEntry);
    return isEmptiedByDeadContent ? [] : [simplified];
  });
}

/**
 * Collects every leaf property written by a list of AST entries, including the
 * declarations of nested rules and blocks.
 *
 * @param  {Array} entries              The AST entries to search.
 * @param  {Set}   [writtenProperties]  The set the names are added to.
 * @return {Set}                        The leaf property names written anywhere within the entries.
 */
function collectWrittenLeafProperties (entries, writtenProperties = new Set()) {
  for (const entry of entries) {
    if (isPropertyDeclaration(entry)) {
      for (const leafProperty of expandToOverridableProperties(entry.property)) {
        writtenProperties.add(leafProperty);
      }
    }
    collectWrittenLeafProperties(entry.declarations || [], writtenProperties);
    collectWrittenLeafProperties(entry.rules || [], writtenProperties);
  }
  return writtenProperties;
}

/**
 * Reports whether two sets of written leaf properties share a property. Only a
 * shared property can make the order of two groups of rules change the cascade.
 * `all` resets every property, so it shares one with any property at all.
 *
 * @param  {Set}     firstProperties   The leaf properties written by the first group.
 * @param  {Set}     secondProperties  The leaf properties written by the second group.
 * @return {boolean}                   True when the two groups write a property in common.
 */
function propertySetsOverlap (firstProperties, secondProperties) {
  if (firstProperties.has('all') || secondProperties.has('all')) {
    return firstProperties.size > 0 && secondProperties.size > 0;
  }
  return [...firstProperties].some((property) => {
    return secondProperties.has(property);
  });
}

/**
 * Entry types that may be reordered past a `@media` block. Style rules are
 * reordered only when they write nothing the block writes, while comments and
 * whitespace never affect the cascade.
 *
 * @type {Set<string>}
 */
const REORDERABLE_ENTRY_TYPES = new Set(['rule', 'comment', 'whitespace']);

/**
 * Finds the `@media` block that a block at `mediaIndex` repeats, if only
 * reorderable entries sit between the two. The nearest such block is returned.
 *
 * @param  {Array}  rules       The AST rule nodes to search.
 * @param  {number} mediaIndex  The index of the `@media` block being matched.
 * @return {number}             The index of the repeated block, or -1 when there is none.
 */
function findRepeatedMediaIndex (rules, mediaIndex) {
  if (rules[mediaIndex].type !== 'media') {
    return -1;
  }
  const query = normalizeMedia(rules[mediaIndex].media);
  let earlierIndex = mediaIndex - 1;
  while (earlierIndex >= 0 && REORDERABLE_ENTRY_TYPES.has(rules[earlierIndex].type)) {
    earlierIndex--;
  }
  const isRepeat = earlierIndex >= 0 && rules[earlierIndex].type === 'media' &&
    normalizeMedia(rules[earlierIndex].media) === query;
  return isRepeat ? earlierIndex : -1;
}

/**
 * Moves the reorderable entries that sit between a `@media` block and an earlier
 * block with the same query above that earlier block, whenever they write no
 * property the earlier block writes. Without the move, the two blocks are
 * separated and cannot merge.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with repeated `@media` blocks brought together where safe.
 */
function hoistRulesAboveRepeatedMedia (rules) {
  const result = [...rules];
  for (let mediaIndex = 0; mediaIndex < result.length; mediaIndex++) {
    const earlierIndex = findRepeatedMediaIndex(result, mediaIndex);
    if (earlierIndex === -1) {
      continue;
    }
    const betweenEntries = result.slice(earlierIndex + 1, mediaIndex);
    const earlierWrites = collectWrittenLeafProperties(result[earlierIndex].rules || []);
    const betweenWrites = collectWrittenLeafProperties(betweenEntries);
    if (!propertySetsOverlap(betweenWrites, earlierWrites)) {
      result.splice(earlierIndex + 1, betweenEntries.length);
      result.splice(earlierIndex, 0, ...betweenEntries);
    }
  }
  return result;
}

/**
 * Merges adjacent `@media` rules that share an identical normalized query string and deduplicates their child selector rules. Reorderable rules that separate a repeated query are first moved above the earlier block, where it is safe to do so.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each media block.
 * @return {Array}                                      A new array of rules with consecutive identical `@media` blocks combined.
 */
function mergeMediaRules (rules, mergeSelectorRules) {
  const mediaMap = new Map();
  const result = [];
  for (const rule of hoistRulesAboveRepeatedMedia(rules)) {
    if (rule.type === 'media') {
      const normalizedQuery = normalizeMedia(rule.media);
      if (mediaMap.has(normalizedQuery)) {
        mediaMap.get(normalizedQuery).rules.push(...(rule.rules || []));
      } else {
        mediaMap.set(normalizedQuery, rule);
        result.push(rule);
      }
    } else {
      // Clearing a map replaces its storage, so an already empty one is left alone
      if (rule.type !== 'whitespace' && mediaMap.size) {
        mediaMap.clear();
      }
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'media' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

/**
 * Removes duplicate `@keyframes` definitions, keeping only the last occurrence of each named animation.
 *
 * @param  {Array} rules  The AST rule nodes to deduplicate.
 * @return {Array}        A new array of rules with earlier duplicate `@keyframes` removed.
 */
function deduplicateKeyframes (rules) {
  const lastIndexByName = new Map();
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].type === 'keyframes' && rules[i].name) {
      lastIndexByName.set(rules[i].name, i);
    }
  }
  return rules.filter((rule, index) => {
    if (rule.type === 'keyframes' && rule.name) {
      return lastIndexByName.get(rule.name) === index;
    }
    return true;
  });
}

/**
 * Merges `@layer` blocks with the same name by combining their child rules, deduplicates layer statements, and merges selector rules within each block.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  Callback to merge selector rules within each layer block.
 * @return {Array}                                      A new array of rules with same-name `@layer` blocks combined.
 */
function mergeLayerRules (rules, mergeSelectorRules) {
  const layerBlockMap = new Map();
  const layerStatementSeen = new Set();
  const result = [];
  for (const rule of rules) {
    if (rule.type === 'layer') {
      const layerName = normalizeLayerNames(rule.layer);
      if (rule.rules && rule.rules.length > 0) {
        if (layerName && layerBlockMap.has(layerName)) {
          layerBlockMap.get(layerName).rules.push(...rule.rules);
        } else {
          if (layerName) {
            layerBlockMap.set(layerName, rule);
          }
          result.push(rule);
        }
      } else {
        if (!layerName || !layerStatementSeen.has(layerName)) {
          if (layerName) {
            layerStatementSeen.add(layerName);
          }
          result.push(rule);
        }
      }
    } else {
      result.push(rule);
    }
  }
  for (const rule of result) {
    if (rule.type === 'layer' && rule.rules && rule.rules.length) {
      rule.rules = mergeSelectorRules(rule.rules);
    }
  }
  return result;
}

export {
  deduplicateKeyframes,
  mergeLayerRules,
  mergeMediaRules,
  removeIEMediaRules,
  simplifyNestedMediaRules
};
