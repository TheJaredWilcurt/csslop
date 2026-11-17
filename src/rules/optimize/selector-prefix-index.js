/**
 * @file Indexes sibling rules by their first selector, so a pass looking for
 * the rules that could nest under a parent selector only visits the rules
 * whose selector starts with that parent.
 */

/**
 * Compares two indexed selectors by their selector text, using the same
 * code unit ordering as `<`, so every selector sharing a prefix sorts into
 * one contiguous block.
 *
 * @param  {object} first   The first `{ selector, index }` entry.
 * @param  {object} second  The second `{ selector, index }` entry.
 * @return {number}         Negative, zero, or positive, like any sort comparator.
 */
function compareIndexedSelectors (first, second) {
  if (first.selector < second.selector) {
    return -1;
  }
  if (first.selector > second.selector) {
    return 1;
  }
  return first.index - second.index;
}

/**
 * Finds the position of the first sorted selector that is not ordered before
 * a prefix, which is where the block of selectors starting with it begins.
 *
 * @param  {Array}  sortedSelectors  The `{ selector, index }` entries, sorted by selector.
 * @param  {string} prefix           The prefix to look for.
 * @return {number}                  The position of the first selector not before the prefix.
 */
function findPrefixBlockStart (sortedSelectors, prefix) {
  let low = 0;
  let high = sortedSelectors.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sortedSelectors[middle].selector < prefix) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Collects the trimmed first selector of every rule with selectors, paired
 * with the rule's index among the siblings, sorted by selector.
 *
 * @param  {Array} entries  The sibling AST entries.
 * @return {Array}          The `{ selector, index }` entries, sorted by selector.
 */
function collectSortedFirstSelectors (entries) {
  const sortedSelectors = [];
  entries.forEach((entry, index) => {
    if (entry.type === 'rule' && entry.selectors?.length) {
      sortedSelectors.push({
        index,
        selector: entry.selectors[0].trim()
      });
    }
  });
  return sortedSelectors.sort(compareIndexedSelectors);
}

/**
 * Builds a lookup of the sibling rules whose first selector starts with a
 * given prefix. Only those rules can nest under a parent selector equal to
 * the prefix, since nesting requires every one of a rule's selectors to start
 * with the parent. Each prefix is only looked up once, then remembered.
 *
 * @param  {Array}                           entries  The sibling AST entries. They must not be reordered while the lookup is in use.
 * @return {function(string): Array<number>}          Returns the ascending indexes of the rules whose first selector starts with the prefix.
 */
function createSelectorPrefixIndex (entries) {
  let sortedSelectors = null;
  const indexesByPrefix = new Map();
  return (prefix) => {
    let indexes = indexesByPrefix.get(prefix);
    if (indexes) {
      return indexes;
    }
    sortedSelectors = sortedSelectors || collectSortedFirstSelectors(entries);
    indexes = [];
    for (let position = findPrefixBlockStart(sortedSelectors, prefix); position < sortedSelectors.length; position++) {
      const { index, selector } = sortedSelectors[position];
      if (!selector.startsWith(prefix)) {
        break;
      }
      indexes.push(index);
    }
    indexes.sort((first, second) => {
      return first - second;
    });
    indexesByPrefix.set(prefix, indexes);
    return indexes;
  };
}

export {
  createSelectorPrefixIndex
};
