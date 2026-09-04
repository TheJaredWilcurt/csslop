/**
 * @file Shared grammar helpers for the layered image shorthands, `background` and `mask`, whose layers only accept a size behind a slash that follows a position.
 */

/**
 * The layer positions a shorthand may leave unstated, since they already match
 * the initial position that the shorthand resets the layer to.
 *
 * @type {Set<string>}
 */
const INITIAL_LAYER_POSITIONS = new Set(['0 0', '0% 0%']);

/**
 * The shortest spelling of the initial layer position, used whenever a stated
 * size needs a position in front of it.
 *
 * @type {string}
 */
const SHORTEST_INITIAL_LAYER_POSITION = '0 0';

/**
 * The layer size a shorthand may leave unstated, since it already matches the
 * initial size that the shorthand resets the layer to.
 *
 * @type {string}
 */
const INITIAL_LAYER_SIZE = 'auto';

/**
 * Reduces a layer position to what the shorthand has to spell out, which is
 * nothing at all while the position holds its initial value.
 *
 * @param  {string} position  The layer position, or a falsy value when the layer states none.
 * @return {string}           The position to write, or an empty string when it can be left out.
 */
function resolveStatedLayerPosition (position) {
  if (!position || INITIAL_LAYER_POSITIONS.has(position)) {
    return '';
  }
  return position;
}

/**
 * Reduces a layer size to what the shorthand has to spell out, which is nothing
 * at all while the size holds its initial value.
 *
 * @param  {string} size  The layer size, or a falsy value when the layer states none.
 * @return {string}       The size to write, or an empty string when it can be left out.
 */
function resolveStatedLayerSize (size) {
  if (!size || size === INITIAL_LAYER_SIZE) {
    return '';
  }
  return size;
}

/**
 * Builds the position and size components of a layered image shorthand value.
 * The layer grammar only reads a size directly behind a `/` that follows a
 * position, so a stated size pulls the initial position back into the output
 * whenever the layer states no position of its own.
 *
 * @param  {string} position  The layer position, or a falsy value when the layer states none.
 * @param  {string} size      The layer size, or a falsy value when the layer states none.
 * @return {Array}            The shorthand components covering the position and the size.
 */
function buildLayerPositionAndSize (position, size) {
  const statedPosition = resolveStatedLayerPosition(position);
  const statedSize = resolveStatedLayerSize(size);
  if (statedSize) {
    return [(statedPosition || SHORTEST_INITIAL_LAYER_POSITION) + '/' + statedSize];
  }
  if (statedPosition) {
    return [statedPosition];
  }
  return [];
}

export { buildLayerPositionAndSize };
