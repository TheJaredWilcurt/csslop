/**
 * @file Indexes sibling rules by the parent selectors their first selector
 * could nest under, so a pass looking for the rules that could nest under a
 * parent selector only visits the rules that have a chance to.
 */

/**
 * Matches a character that can follow a parent selector within a selector
 * nested under it: whitespace before a descendant or explicit combinator, the
 * colon of a pseudo-class, or an explicit combinator itself. A selector can
 * only nest under the parts in front of these characters, or under the whole
 * of itself.
 *
 * @type {RegExp}
 */
// Any whitespace character, a colon, or one of the explicit combinators
const NESTING_BOUNDARY_PATTERN = /[\s:>+~]/g;

/**
 * The result of looking up a parent no rule could nest under. Lookups only
 * ever read the indexes they are given, so it is shared.
 *
 * @type {Array<number>}
 */
const NO_INDEXES = Object.freeze([]);

/**
 * Memoizes the parent selectors each trimmed first selector could nest under,
 * for the current stylesheet. The index is built again whenever its siblings
 * are reordered, and over many passes, so reusing the same prefix strings
 * spares slicing and hashing them anew every time.
 *
 * @type {Map<string, Array<string>>}
 */
const nestingParentsBySelector = new Map();

/**
 * Discards every memoized list of nesting parents. The minifier calls this
 * around each stylesheet, so the cache does not outlive the pass that filled
 * it.
 */
function clearNestingParentCache () {
  nestingParentsBySelector.clear();
}

/**
 * Lists the parent selectors a trimmed selector could nest under: the selector
 * itself, and every part of it in front of a nesting boundary.
 *
 * @param  {string}        selector  The trimmed selector.
 * @return {Array<string>}           The parent selectors, the selector itself first.
 */
function computeNestingParents (selector) {
  const parents = [selector];
  NESTING_BOUNDARY_PATTERN.lastIndex = 0;
  let boundary = NESTING_BOUNDARY_PATTERN.exec(selector);
  while (boundary) {
    parents.push(selector.slice(0, boundary.index));
    boundary = NESTING_BOUNDARY_PATTERN.exec(selector);
  }
  return parents;
}

/**
 * Lists the parent selectors a trimmed selector could nest under, reusing the
 * list when the same selector was already examined during this stylesheet.
 * The returned list is shared, so it must not be changed.
 *
 * @param  {string}        selector  The trimmed selector.
 * @return {Array<string>}           The parent selectors, the selector itself first.
 */
function collectNestingParents (selector) {
  let parents = nestingParentsBySelector.get(selector);
  if (!parents) {
    parents = computeNestingParents(selector);
    nestingParentsBySelector.set(selector, parents);
  }
  return parents;
}

/**
 * Adds a rule's index to the rules that could nest under a parent. Most
 * parents are only ever reached by a single rule, so a lone index is stored
 * as is, and only becomes a list once a second rule reaches the same parent.
 *
 * @param {Map<string, (number|Array<number>)>} indexesByParent  Map of parent selector to the index, or ascending indexes, of the rules that could nest under it.
 * @param {string}                              parent           The parent selector.
 * @param {number}                              index            The rule's index among its siblings.
 */
function addNestingCandidate (indexesByParent, parent, index) {
  const indexes = indexesByParent.get(parent);
  if (indexes === undefined) {
    indexesByParent.set(parent, index);
  } else if (typeof indexes === 'number') {
    indexesByParent.set(parent, [indexes, index]);
  } else {
    indexes.push(index);
  }
}

/**
 * Looks up the ascending indexes of the rules that could nest under a parent,
 * turning a lone stored index into a list the first time it is asked for.
 *
 * @param  {Map<string, (number|Array<number>)>} indexesByParent  Map of parent selector to the index, or ascending indexes, of the rules that could nest under it.
 * @param  {string}                              parent           The parent selector.
 * @return {Array<number>}                                        The ascending indexes. The list must not be changed.
 */
function findNestingCandidateIndexes (indexesByParent, parent) {
  const indexes = indexesByParent.get(parent);
  if (indexes === undefined) {
    return NO_INDEXES;
  }
  if (typeof indexes === 'number') {
    const loneIndex = [indexes];
    indexesByParent.set(parent, loneIndex);
    return loneIndex;
  }
  return indexes;
}

/**
 * Indexes every rule with selectors under each parent selector its trimmed
 * first selector could nest under: the first selector itself, and every part
 * of it in front of a nesting boundary. The rules are visited in order, so
 * each list of indexes is already ascending. When the only parents that will
 * ever be looked up are known, every other parent is left out.
 *
 * @param  {Array}                               entries         The sibling AST entries.
 * @param  {Set<string>|null}                    queriedParents  The only parent selectors that will be looked up, or null when any may be.
 * @return {Map<string, (number|Array<number>)>}                 Map of parent selector to the index, or ascending indexes, of the rules that could nest under it.
 */
function indexNestingCandidates (entries, queriedParents) {
  const indexesByParent = new Map();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.type !== 'rule' || !entry.selectors?.length) {
      continue;
    }
    for (const parent of collectNestingParents(entry.selectors[0].trim())) {
      if (!queriedParents || queriedParents.has(parent)) {
        addNestingCandidate(indexesByParent, parent, index);
      }
    }
  }
  return indexesByParent;
}

/**
 * Builds a lookup of the sibling rules that could nest under a given parent
 * selector. Nesting requires every one of a rule's selectors to be the parent
 * itself, or to continue past the parent with a nesting boundary, so only the
 * rules whose first selector does so are returned. Every rule left out could
 * never nest under the parent, which lets a pass skip them without changing
 * which rules it nests.
 *
 * @param  {Array}                           entries           The sibling AST entries. They must not be reordered while the lookup is in use.
 * @param  {Set<string>|null}                [queriedParents]  The only parent selectors that will be looked up, or null when any may be. Looking up any other parent finds nothing.
 * @return {function(string): Array<number>}                   Returns the ascending indexes of the rules that could nest under the parent. The list must not be changed.
 */
function createSelectorPrefixIndex (entries, queriedParents = null) {
  let indexesByParent = null;
  return (parent) => {
    indexesByParent = indexesByParent || indexNestingCandidates(entries, queriedParents);
    return findNestingCandidateIndexes(indexesByParent, parent);
  };
}

export {
  clearNestingParentCache,
  createSelectorPrefixIndex
};
