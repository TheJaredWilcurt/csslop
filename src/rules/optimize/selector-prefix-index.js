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
 * Adds a rule's index to the list of rules that could nest under a parent.
 *
 * @param {Map<string, Array<number>>} indexesByParent  Map of parent selector to the ascending indexes of the rules that could nest under it.
 * @param {string}                     parent           The parent selector.
 * @param {number}                     index            The rule's index among its siblings.
 */
function addNestingCandidate (indexesByParent, parent, index) {
  const indexes = indexesByParent.get(parent);
  if (indexes) {
    indexes.push(index);
  } else {
    indexesByParent.set(parent, [index]);
  }
}

/**
 * Indexes every rule with selectors under each parent selector its trimmed
 * first selector could nest under: the first selector itself, and every part
 * of it in front of a nesting boundary. The rules are visited in order, so
 * each list of indexes is already ascending.
 *
 * @param  {Array}                      entries  The sibling AST entries.
 * @return {Map<string, Array<number>>}          Map of parent selector to the ascending indexes of the rules that could nest under it.
 */
function indexNestingCandidates (entries) {
  const indexesByParent = new Map();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.type !== 'rule' || !entry.selectors?.length) {
      continue;
    }
    const selector = entry.selectors[0].trim();
    addNestingCandidate(indexesByParent, selector, index);
    NESTING_BOUNDARY_PATTERN.lastIndex = 0;
    let boundary = NESTING_BOUNDARY_PATTERN.exec(selector);
    while (boundary) {
      addNestingCandidate(indexesByParent, selector.slice(0, boundary.index), index);
      boundary = NESTING_BOUNDARY_PATTERN.exec(selector);
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
 * @param  {Array}                           entries  The sibling AST entries. They must not be reordered while the lookup is in use.
 * @return {function(string): Array<number>}          Returns the ascending indexes of the rules that could nest under the parent. The list must not be changed.
 */
function createSelectorPrefixIndex (entries) {
  let indexesByParent = null;
  return (parent) => {
    indexesByParent = indexesByParent || indexNestingCandidates(entries);
    return indexesByParent.get(parent) || NO_INDEXES;
  };
}

export {
  createSelectorPrefixIndex
};
