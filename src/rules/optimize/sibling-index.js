/**
 * @file Builds the lookups that passes moving rules among their siblings share:
 * which siblings could nest under a parent selector, and which siblings a rule
 * could not move across.
 */

import {
  createWriteIndex,
  createWrittenPropertiesCache
} from './reordering.js';
import { createSelectorPrefixIndex } from './selector-prefix-index.js';

/**
 * Builds the lookups for one list of sibling entries. The entries must not be
 * mutated or reordered while the lookups are in use, so a pass that reorders
 * its siblings builds them again afterwards, reusing the same
 * `getWrittenProperties` cache since the rules themselves are unchanged.
 *
 * @param  {Array}                 entries                 The sibling AST entries.
 * @param  {function(object): Set} [getWrittenProperties]  Returns the properties a rule writes.
 * @param  {Set<string>|null}      [queriedParents]        The only parent selectors `findNestingCandidates` will be asked about, or null when any may be.
 * @return {object}                                        The `findNestingCandidates` parent lookup and the `writeIndex` of the siblings.
 */
function createSiblingIndex (entries, getWrittenProperties = createWrittenPropertiesCache(), queriedParents = null) {
  return {
    findNestingCandidates: createSelectorPrefixIndex(entries, queriedParents),
    writeIndex: createWriteIndex(entries, getWrittenProperties)
  };
}

export {
  createSiblingIndex
};
