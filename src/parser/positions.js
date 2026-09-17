/**
 * @file Turns offsets into the stylesheet into the line and column numbers that AST nodes report.
 */

/**
 * Records the offset every line of the source begins at, so that any offset
 * can later be resolved without rescanning the text in front of it.
 *
 * @param  {string} source  The raw CSS text.
 * @return {Array}          The offset each line starts at, in order.
 */
function createLineIndex (source) {
  const lineStartOffsets = [0];
  let lineBreakIndex = source.indexOf('\n');
  while (lineBreakIndex !== -1) {
    lineStartOffsets.push(lineBreakIndex + 1);
    lineBreakIndex = source.indexOf('\n', lineBreakIndex + 1);
  }
  return lineStartOffsets;
}

/**
 * Resolves an offset into the stylesheet to the one-based line and column it
 * falls on, by binary searching the line index for the last line that begins
 * at or before the offset.
 *
 * @param  {Array}  lineStartOffsets  The offset each line starts at.
 * @param  {number} offset            The offset to resolve.
 * @return {object}                   The line, column, and offset of that point in the source.
 */
function resolveSourceLocation (lineStartOffsets, offset) {
  let lowestLine = 0;
  let highestLine = lineStartOffsets.length - 1;
  while (lowestLine < highestLine) {
    const middleLine = Math.ceil((lowestLine + highestLine) / 2);
    if (lineStartOffsets[middleLine] <= offset) {
      lowestLine = middleLine;
    } else {
      highestLine = middleLine - 1;
    }
  }
  return {
    line: lowestLine + 1,
    column: offset - lineStartOffsets[lowestLine] + 1,
    offset
  };
}

/**
 * Builds the position an AST node reports, spanning the text the node was
 * parsed from.
 *
 * @param  {Array}  lineStartOffsets  The offset each line starts at.
 * @param  {number} startOffset       The offset the node begins at.
 * @param  {number} endOffset         The offset just past the end of the node.
 * @param  {string} sourceName        The name of the file the CSS came from.
 * @return {object}                   The position of the node in the source.
 */
function createPosition (lineStartOffsets, startOffset, endOffset, sourceName) {
  return {
    start: resolveSourceLocation(lineStartOffsets, startOffset),
    end: resolveSourceLocation(lineStartOffsets, endOffset),
    source: sourceName
  };
}

export {
  createLineIndex,
  createPosition,
  resolveSourceLocation
};
