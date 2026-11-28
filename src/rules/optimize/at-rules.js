/**
 * @file Consolidates grouping at-rules by merging matching `@media` and `@layer` blocks, and drops the `@keyframes` that a later definition replaces.
 */

import { minifyValue } from '../../value/minify.js';
import {
  containsIEHack,
  normalizeLayerNames,
  normalizeMedia
} from '../normalize.js';

import {
  collectWrittenLeafProperties,
  expandToOverridableProperties,
  isPropertyDeclaration,
  propertySetsOverlap
} from './declaration-writes.js';
import {
  addSpecificity,
  compareSpecificity,
  maximumRuleSpecificity,
  minimumRuleSpecificity
} from './specificity.js';

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
 * Simplifies one `@media` block. A block whose only content is a single nested `@media` block is joined into one query, and the simplification repeats on the result. Nested `@media` blocks whose media type the block already excludes are removed.
 *
 * @param  {object} rule  The `@media` rule node to simplify.
 * @return {object}       A new `@media` rule node.
 */
function simplifyMediaBlock (rule) {
  const children = rule.rules || [];
  if (children.length === 1 && children[0].type === 'media') {
    const joinedMedia = joinNestedMediaQueries(rule.media, children[0].media);
    if (joinedMedia !== null) {
      return simplifyMediaBlock({ ...children[0], media: joinedMedia });
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
    const hadContent = Boolean(rule.rules?.length);
    const isEmptiedByDeadContent = hadContent && !simplified.rules.length;
    return isEmptiedByDeadContent ? [] : [simplified];
  });
}

/**
 * Reports whether a `@media` block holds only declaration-only rules that repeat the selector of the single-selector rule directly before it, so the block can be folded into that rule. Rules with nested rules are excluded, since a nested rule cannot be written inside a `@media` block in the same way.
 *
 * @param  {object}  rule        The rule that would receive the block.
 * @param  {object}  mediaBlock  The `@media` rule node that would be folded.
 * @return {boolean}             True when every entry of the block is a rule with the same selector as `rule` and no nested rules.
 */
function canFoldMediaIntoRule (rule, mediaBlock) {
  if (rule.type !== 'rule' || rule.selectors?.length !== 1) {
    return false;
  }
  const content = mediaBlock.rules || [];
  return content.length > 0 && content.every((child) => {
    const repeatsSelector = child.type === 'rule' && child.selectors?.length === 1 && child.selectors[0] === rule.selectors[0];
    return repeatsSelector && !(child.declarations || []).some((entry) => {
      return entry.type === 'rule';
    });
  });
}

/**
 * Reports whether a declaration already holds the value it would give an
 * element when the rule before it is applied. Only the last earlier declaration
 * that writes any of the same leaf properties counts, since a later overlapping
 * write would take precedence over an identical one.
 *
 * @param  {Array}   precedingEntries  The declarations of the rule, in source order.
 * @param  {object}  declaration       The declaration that would be written again.
 * @return {boolean}                   True when the declaration writes nothing new.
 */
function isAlreadyInEffect (precedingEntries, declaration) {
  if (!isPropertyDeclaration(declaration)) {
    return false;
  }
  const declaredLeaves = collectWrittenLeafProperties([declaration]);
  const lastOverlapping = precedingEntries.findLast((entry) => {
    return propertySetsOverlap(collectWrittenLeafProperties([entry]), declaredLeaves);
  });
  return Boolean(lastOverlapping) &&
    isPropertyDeclaration(lastOverlapping) &&
    lastOverlapping.property === declaration.property &&
    minifyValue(lastOverlapping) === minifyValue(declaration);
}

/**
 * Folds a `@media` block into the rule it repeats, writing the block as a nested `@media` placed after that rule's existing declarations. The block's content keeps its order, and it stays after the rule, so the cascade is unchanged. Declarations the rule already holds in effect are left out, and when none remain the block is dropped entirely.
 *
 * @param  {object} rule        The rule that receives the nested block.
 * @param  {object} mediaBlock  The `@media` rule node whose rules all repeat `rule`'s selector.
 * @return {object}             The rule with the nested `@media` block added to its declarations, or the rule unchanged when the block adds nothing.
 */
function foldMediaIntoRule (rule, mediaBlock) {
  const ruleDeclarations = rule.declarations || [];
  const nestedDeclarations = mediaBlock.rules.flatMap((child) => {
    return child.declarations || [];
  }).filter((declaration) => {
    return !isAlreadyInEffect(ruleDeclarations, declaration);
  });
  if (!nestedDeclarations.length) {
    return rule;
  }
  const nestedMedia = { ...mediaBlock, rules: nestedDeclarations };
  return {
    ...rule,
    declarations: [...ruleDeclarations, nestedMedia]
  };
}

/**
 * Folds each `@media` block that repeats the single-selector rule before it into that rule as a nested `@media`. Blocks that do not repeat the rule are left as they are.
 *
 * @param  {Array} rules  The AST rule nodes to process.
 * @return {Array}        A new array of rules with repeated `@media` blocks folded into their preceding rules.
 */
function foldRepeatedMediaRules (rules) {
  const result = [];
  for (const entry of rules) {
    const previousIndex = result.length - 1;
    if (entry.type === 'media' && previousIndex !== -1 && canFoldMediaIntoRule(result[previousIndex], entry)) {
      result[previousIndex] = foldMediaIntoRule(result[previousIndex], entry);
    } else {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Maps every leaf property a list of AST entries writes to the strongest
 * specificity that write is applied with. Nested rules add their selectors'
 * specificity to the rule they are nested in, as they only match through it.
 *
 * @param  {Array} entries                The AST entries to search.
 * @param  {Array} baseSpecificity        The specificity the entries are nested under.
 * @param  {Map}   [strongestByProperty]  The map the strongest specificities are added to.
 * @return {Map}                          Map of leaf property name to its strongest [ids, classes, types] specificity.
 */
function collectStrongestLeafWrites (entries, baseSpecificity = [0, 0, 0], strongestByProperty = new Map()) {
  for (const entry of entries) {
    if (isPropertyDeclaration(entry)) {
      for (const leafProperty of expandToOverridableProperties(entry.property)) {
        const strongestSoFar = strongestByProperty.get(leafProperty);
        if (!strongestSoFar || compareSpecificity(baseSpecificity, strongestSoFar) > 0) {
          strongestByProperty.set(leafProperty, baseSpecificity);
        }
      }
      continue;
    }
    const entrySpecificity = entry.selectors?.length ?
      addSpecificity(baseSpecificity, maximumRuleSpecificity(entry.selectors)) :
      baseSpecificity;
    collectStrongestLeafWrites(entry.declarations || [], entrySpecificity, strongestByProperty);
    collectStrongestLeafWrites(entry.rules || [], entrySpecificity, strongestByProperty);
  }
  return strongestByProperty;
}

/**
 * Reports whether an entry would change the cascade if it were moved above a
 * group of earlier rules. Only a rule of strictly lower specificity than the
 * entry is guaranteed to lose to it either way, so a preceding write of the
 * same property with at least the entry's weakest specificity blocks the move.
 *
 * @param  {object}  entry            The entry that would move.
 * @param  {Map}     precedingWrites  Map of leaf property name to the strongest specificity the preceding rules write it with.
 * @return {boolean}                  True when the entry cannot be moved above the preceding rules.
 */
function isBlockedAboveEarlierWrites (entry, precedingWrites) {
  const entryWrites = collectWrittenLeafProperties([entry]);
  if (entryWrites.has('all') || precedingWrites.has('all')) {
    return propertySetsOverlap(entryWrites, new Set(precedingWrites.keys()));
  }
  const weakestEntrySpecificity = minimumRuleSpecificity(entry.selectors || []);
  return [...entryWrites].some((leafProperty) => {
    const strongestPreceding = precedingWrites.get(leafProperty);
    return strongestPreceding !== undefined && compareSpecificity(strongestPreceding, weakestEntrySpecificity) >= 0;
  });
}

/**
 * Entry types that may be reordered past a `@media` block. Style rules and
 * other `@media` blocks are reordered only when they write nothing the block
 * writes, while comments never affect the cascade.
 *
 * @type {Set<string>}
 */
const REORDERABLE_ENTRY_TYPES = new Set(['rule', 'comment', 'media']);

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
  let earlierIndex = -1;
  for (let scanIndex = mediaIndex - 1; scanIndex >= 0; scanIndex--) {
    const candidate = rules[scanIndex];
    if (candidate.type === 'media' && normalizeMedia(candidate.media) === query) {
      earlierIndex = scanIndex;
      continue;
    }
    if (REORDERABLE_ENTRY_TYPES.has(candidate.type)) {
      continue;
    }
    break;
  }
  return earlierIndex;
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
  for (let mediaIndex = result.length - 1; mediaIndex >= 0; mediaIndex--) {
    const earlierIndex = findRepeatedMediaIndex(result, mediaIndex);
    if (earlierIndex === -1) {
      continue;
    }
    const query = normalizeMedia(result[mediaIndex].media);
    const entriesBetween = result.slice(earlierIndex + 1, mediaIndex);
    const repeatedMediaRules = entriesBetween.filter((entry) => {
      return entry.type === 'media' && normalizeMedia(entry.media) === query;
    });
    const mediaRules = [result[earlierIndex], ...repeatedMediaRules, result[mediaIndex]];
    const entriesBeforeMedia = [];
    const entriesAfterMedia = [];
    const movedMediaWrites = collectWrittenLeafProperties(mediaRules.slice(1));
    const allMediaWrites = collectWrittenLeafProperties(mediaRules);
    const precedingMediaRules = [mediaRules[0]];
    let canMerge = true;

    for (const entry of entriesBetween) {
      if (entry.type === 'media' && normalizeMedia(entry.media) === query) {
        precedingMediaRules.push(entry);
        continue;
      }
      if (entry.type === 'comment') {
        entriesAfterMedia.push(entry);
        continue;
      }

      // An entry moves above the block when the rules it would pass cannot
      // change its cascade, and it does not pass an entry that stays behind.
      // Failing that, it moves below the block when it writes nothing the
      // block writes. Another `@media` block only needs to avoid what the
      // repeated blocks write, since it stays after the first block.
      const entryWrites = collectWrittenLeafProperties([entry]);
      const blockWritesToAvoid = entry.type === 'media' ? movedMediaWrites : allMediaWrites;
      const crossesEntriesAfter = entriesAfterMedia.some((entryAfter) => {
        return propertySetsOverlap(collectWrittenLeafProperties([entryAfter]), entryWrites);
      });
      const precedingWrites = collectStrongestLeafWrites(precedingMediaRules);
      if (!crossesEntriesAfter && !isBlockedAboveEarlierWrites(entry, precedingWrites)) {
        entriesBeforeMedia.push(entry);
      } else if (!propertySetsOverlap(entryWrites, blockWritesToAvoid)) {
        entriesAfterMedia.push(entry);
      } else {
        canMerge = false;
        break;
      }
    }

    if (canMerge) {
      result.splice(
        earlierIndex,
        mediaIndex - earlierIndex + 1,
        ...entriesBeforeMedia,
        ...mediaRules,
        ...entriesAfterMedia
      );
    }
  }
  return result;
}

/**
 * Normalizes a container condition so equivalent whitespace and casing use
 * the same key when matching container blocks.
 *
 * @param  {string} condition  The raw container condition.
 * @return {string}            The normalized condition.
 */
function normalizeContainerCondition (condition) {
  const text = String(condition ?? '').trim().toLowerCase();
  let normalized = '';
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (' \t\n\r\f'.includes(character)) {
      let nextIndex = index + 1;
      while (nextIndex < text.length && ' \t\n\r\f'.includes(text[nextIndex])) {
        nextIndex++;
      }
      const previousCharacter = normalized[normalized.length - 1] || '';
      const nextCharacter = text[nextIndex] || '';
      if (
        previousCharacter &&
        nextCharacter &&
        !'(<>:=,'.includes(previousCharacter) &&
        !')<>:=,'.includes(nextCharacter)
      ) {
        normalized += ' ';
      }
      index = nextIndex;
      continue;
    }
    normalized += character;
    index++;
  }

  return normalized;
}

/**
 * Merges container blocks with matching conditions and combines their child
 * selector rules.
 *
 * @param  {Array}                  rules               The AST rule nodes to process.
 * @param  {function(Array): Array} mergeSelectorRules  The callback that merges child selector rules.
 * @return {Array}                                      The rules with matching containers combined.
 */
function mergeContainerRules (rules, mergeSelectorRules) {
  const containerMap = new Map();
  const result = [];

  for (const rule of rules) {
    if (rule.type === 'container') {
      const condition = normalizeContainerCondition(rule.container);
      if (condition && containerMap.has(condition)) {
        containerMap.get(condition).rules.push(...(rule.rules || []));
      } else {
        if (condition) {
          containerMap.set(condition, rule);
        }
        result.push(rule);
      }
    } else {
      if (containerMap.size) {
        containerMap.clear();
      }
      result.push(rule);
    }
  }

  for (const rule of result) {
    if (rule.type === 'container' && rule.rules?.length) {
      rule.rules = mergeSelectorRules(rule.rules);
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
      if (mediaMap.size) {
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
  canFoldMediaIntoRule,
  deduplicateKeyframes,
  foldRepeatedMediaRules,
  mergeContainerRules,
  mergeLayerRules,
  mergeMediaRules,
  removeIEMediaRules,
  simplifyNestedMediaRules
};
