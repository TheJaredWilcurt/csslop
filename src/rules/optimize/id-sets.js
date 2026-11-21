/**
 * @file Small integer ids for strings, and sets of those ids that empty in
 * constant time, so hot loops that test membership far more often than they
 * build sets avoid hashing strings and allocating new sets.
 */

/**
 * Creates an interner that gives each distinct key the next small integer id,
 * always returning the same id for the same key.
 *
 * @return {function(string): number} Returns the id of a key.
 */
function createInterner () {
  const idByKey = new Map();
  return function intern (key) {
    let id = idByKey.get(key);
    if (id === undefined) {
      id = idByKey.size;
      idByKey.set(key, id);
    }
    return id;
  };
}

/**
 * Creates a set of small integer ids. Each id is marked with the current
 * stamp, so emptying the set only moves to a new stamp instead of touching
 * every member.
 *
 * @return {object} The set, with `add`, `has`, `clear`, and `size`.
 */
function createIdSet () {
  let stamps = new Int32Array(64);
  let stamp = 1;
  let size = 0;
  return {
    /**
     * Adds an id to the set.
     *
     * @param  {number}  id  The id to add.
     * @return {boolean}     True when the id was not already in the set.
     */
    add: function (id) {
      if (id >= stamps.length) {
        const grownStamps = new Int32Array(Math.max(id + 1, stamps.length * 2));
        grownStamps.set(stamps);
        stamps = grownStamps;
      }
      if (stamps[id] === stamp) {
        return false;
      }
      stamps[id] = stamp;
      size++;
      return true;
    },
    /**
     * Empties the set.
     */
    clear: function () {
      stamp++;
      size = 0;
    },
    /**
     * Reports whether an id is in the set.
     *
     * @param  {number}  id  The id to look for.
     * @return {boolean}     True when the id is in the set.
     */
    has: function (id) {
      return id < stamps.length && stamps[id] === stamp;
    },
    /**
     * The number of ids in the set.
     *
     * @return {number} The count of ids.
     */
    get size () {
      return size;
    }
  };
}

export {
  createIdSet,
  createInterner
};
