/**
 * @file Binary searches over ascending lists of entry indexes, so passes that
 * scan sibling rules can jump straight to the indexes they care about.
 */

/**
 * Finds the first position in an ascending list of numbers whose value is at
 * least the given minimum.
 *
 * @param  {Array<number>} sortedNumbers  The ascending numbers to search.
 * @param  {number}        minimum        The smallest acceptable value.
 * @return {number}                       The position of the first value at least the minimum, or the list length when there is none.
 */
function findFirstPositionAtLeast (sortedNumbers, minimum) {
  let low = 0;
  let high = sortedNumbers.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sortedNumbers[middle] < minimum) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Finds the largest index in an ascending list that comes before a bound.
 *
 * @param  {Array<number>} [sortedIndexes]  The ascending indexes to search.
 * @param  {number}        beforeIndex      The exclusive upper bound.
 * @return {number}                         The last index before the bound, or -1 when there is none.
 */
function findLastIndexBefore (sortedIndexes, beforeIndex) {
  if (!sortedIndexes) {
    return -1;
  }
  const position = findFirstPositionAtLeast(sortedIndexes, beforeIndex);
  if (position === 0) {
    return -1;
  }
  return sortedIndexes[position - 1];
}

export {
  findFirstPositionAtLeast,
  findLastIndexBefore
};
