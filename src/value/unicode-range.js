/**
 * @file Optimizes CSS unicode-range values by deduplicating, merging overlapping
 * and adjacent ranges, collapsing consecutive single values into ranges, and
 * applying wildcard compression.
 */

/**
 * Parses a single unicode-range token into a numeric start/end pair.
 * Handles single values (U+1F170), explicit ranges (U+2000-2002),
 * and wildcard notation (U+4??).
 *
 * @param  {string}      token  A trimmed unicode-range token.
 * @return {object|null}        Object with numeric start and end, or null if unparseable.
 */
function parseUnicodeRangeToken (token) {
  const trimmed = token.trim();

  // Match wildcard notation: U+ followed by optional hex prefix then one or more ?
  const wildcardMatch = trimmed.match(/^U\+([0-9a-fA-F]*)(\?+)$/i);
  if (wildcardMatch) {
    const prefix = wildcardMatch[1] || '';
    const wildcardCount = wildcardMatch[2].length;
    const start = parseInt(prefix + '0'.repeat(wildcardCount), 16);
    const end = parseInt(prefix + 'F'.repeat(wildcardCount), 16);
    return { start, end };
  }

  // Match explicit range: U+XXXX-YYYY
  const rangeMatch = trimmed.match(/^U\+([0-9a-fA-F]+)-([0-9a-fA-F]+)$/i);
  if (rangeMatch) {
    return {
      start: parseInt(rangeMatch[1], 16),
      end: parseInt(rangeMatch[2], 16)
    };
  }

  // Match single code point: U+XXXX
  const singleMatch = trimmed.match(/^U\+([0-9a-fA-F]+)$/i);
  if (singleMatch) {
    const codePoint = parseInt(singleMatch[1], 16);
    return { start: codePoint, end: codePoint };
  }

  return null;
}

/**
 * Sorts ranges by start value and merges any that overlap or are adjacent
 * (where the gap between them is zero or negative after +1 adjustment).
 *
 * @param  {Array} ranges  Array of {start, end} objects.
 * @return {Array}         New array of merged {start, end} objects.
 */
function mergeOverlappingRanges (ranges) {
  if (ranges.length <= 1) {
    return ranges.map((range) => {
      return { start: range.start, end: range.end };
    });
  }

  const sorted = [...ranges].sort((rangeA, rangeB) => {
    return rangeA.start - rangeB.start || rangeB.end - rangeA.end;
  });

  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
}

/**
 * Attempts to express a numeric range as wildcard notation (e.g. U+5??).
 * Wildcards are only possible when the suffix of the start is all zeros
 * and the suffix of the end is all F's, meaning the range covers an
 * entire block aligned to a power-of-16 boundary.
 *
 * @param  {number}      start  The range start code point.
 * @param  {number}      end    The range end code point.
 * @return {string|null}        Wildcard string like "U+5??", or null if not representable.
 */
function tryWildcardNotation (start, end) {
  if (start > end) {
    return null;
  }

  const startHex = start.toString(16).toUpperCase();
  const endHex = end.toString(16).toUpperCase();
  const digitCount = Math.max(startHex.length, endHex.length);
  const paddedStart = startHex.padStart(digitCount, '0');
  const paddedEnd = endHex.padStart(digitCount, '0');

  let commonPrefixLength = 0;
  while (commonPrefixLength < digitCount && paddedStart[commonPrefixLength] === paddedEnd[commonPrefixLength]) {
    commonPrefixLength++;
  }

  const startSuffix = paddedStart.slice(commonPrefixLength);
  const endSuffix = paddedEnd.slice(commonPrefixLength);

  // Wildcard requires suffix to span the full 0-F range (all zeros to all F's)
  const suffixIsAllZeros = /^0+$/.test(startSuffix);
  const suffixIsAllFs = /^F+$/i.test(endSuffix);
  if (startSuffix.length > 0 && suffixIsAllZeros && suffixIsAllFs) {
    const wildcardCount = digitCount - commonPrefixLength;
    // Strip leading zeros from the fixed-width prefix
    const prefix = paddedStart.slice(0, commonPrefixLength).replace(/^0+/, '');
    return 'U+' + prefix + '?'.repeat(wildcardCount);
  }

  return null;
}

/**
 * Formats a single merged range back into the shortest valid unicode-range token.
 * Tries wildcard notation first, then falls back to explicit range or single value.
 *
 * @param  {number} start  The range start code point.
 * @param  {number} end    The range end code point.
 * @return {string}        The formatted unicode-range token.
 */
function formatUnicodeRange (start, end) {
  const wildcardForm = tryWildcardNotation(start, end);
  if (wildcardForm) {
    return wildcardForm;
  }

  const startHex = start.toString(16).toUpperCase();
  if (start === end) {
    return 'U+' + startHex;
  }

  const endHex = end.toString(16).toUpperCase();
  return 'U+' + startHex + '-' + endHex;
}

/**
 * Optimizes a CSS unicode-range value by parsing all tokens, merging
 * overlapping/adjacent/duplicate ranges, and re-encoding with the
 * shortest possible notation (wildcards where applicable).
 *
 * @param  {string} value  The raw unicode-range CSS value (comma-separated tokens).
 * @return {string}        The optimized unicode-range value.
 */
function optimizeUnicodeRange (value) {
  const tokens = value.split(',');

  const ranges = [];
  for (const token of tokens) {
    const parsed = parseUnicodeRangeToken(token);
    if (parsed) {
      ranges.push(parsed);
    }
  }

  if (ranges.length === 0) {
    return value;
  }

  const merged = mergeOverlappingRanges(ranges);

  const formatted = merged.map((range) => {
    return formatUnicodeRange(range.start, range.end);
  });
  return formatted.join(',');
}

export { optimizeUnicodeRange };
