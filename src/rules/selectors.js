/**
 * @file Selector minification utilities for CSS rule stringification.
 */

/**
 * Splits a parameter string by commas while respecting nested parentheses,
 * so commas inside function calls within default values are not treated as separators.
 *
 * @param  {string} parameterString  The comma-separated parameter string to split.
 * @return {Array}                   An array of individual parameter strings.
 */
function splitParametersByComma (parameterString) {
  const parameters = [];
  let currentParameter = '';
  let parenthesisDepth = 0;
  for (const character of parameterString) {
    if (character === '(') {
      parenthesisDepth++;
    } else if (character === ')') {
      parenthesisDepth--;
    }
    if (character === ',' && parenthesisDepth === 0) {
      parameters.push(currentParameter);
      currentParameter = '';
    } else {
      currentParameter += character;
    }
  }
  parameters.push(currentParameter);
  return parameters;
}

/**
 * Finds the index of the closing parenthesis that matches the opening
 * parenthesis at the given position in the string.
 *
 * @param  {string} text       The string to search within.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the matching closing parenthesis, or -1 if not found.
 */
function findMatchingCloseParenthesis (text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index++) {
    if (text[index] === '(') {
      depth++;
    } else if (text[index] === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Extracts the type selector or universal selector from the beginning of a
 * compound selector string, if one is present. A type selector is a bare
 * element name (e.g. `div`, `a`); the universal selector is `*`.
 *
 * @param  {string}      compoundSelector  A single compound CSS selector string.
 * @return {string|null}                   The type or universal selector, or null if none is present.
 */
function extractTypeSelector (compoundSelector) {
  // Match universal selector (*) or type selector (letter followed by alphanumeric chars or hyphens)
  const match = compoundSelector.match(/^(\*|[a-zA-Z][a-zA-Z0-9-]*)/);
  if (match) {
    return match[0];
  }
  return null;
}

/**
 * Merges two simple/compound selectors into a single compound selector,
 * ensuring any type or universal selector appears first. Returns null when
 * merging is invalid because both sides contain a type or universal selector.
 *
 * @param  {string}      left   The first selector to merge.
 * @param  {string}      right  The second selector to merge.
 * @return {string|null}        The merged compound selector, or null if the merge is invalid.
 */
function mergeCompoundSelectors (left, right) {
  const leftTypeSelector = extractTypeSelector(left);
  const rightTypeSelector = extractTypeSelector(right);
  if (leftTypeSelector && rightTypeSelector) {
    return null;
  }
  // When the right side has a type selector, it must come first in the compound
  if (rightTypeSelector) {
    return right + left;
  }
  return left + right;
}

/**
 * Builds the cartesian product of two selector lists by merging every
 * combination of left and right selectors into compound selectors.
 * Returns null if any combination produces an invalid merge.
 *
 * @param  {Array}      leftParts   Selectors from the first `:where()`.
 * @param  {Array}      rightParts  Selectors from the second `:where()`.
 * @return {Array|null}             The array of merged compound selectors, or null if any merge is invalid.
 */
function buildWhereCartesianProduct (leftParts, rightParts) {
  const products = [];
  for (const leftSelector of leftParts) {
    for (const rightSelector of rightParts) {
      const merged = mergeCompoundSelectors(leftSelector.trim(), rightSelector.trim());
      if (merged === null) {
        return null;
      }
      products.push(merged);
    }
  }
  return products;
}

/**
 * Scans a selector string for adjacent `:where(A):where(B)` patterns and
 * merges them into a single `:where(AB)` (or `:where()` with the cartesian
 * product of their selector lists) when the merged form is strictly shorter.
 * Type selectors are correctly repositioned to the front of each merged
 * compound, and merges that would produce invalid compound selectors (two
 * type selectors) are skipped.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {string}           The selector with beneficial adjacent `:where()` merges applied.
 */
function mergeAdjacentWherePseudoClasses (selector) {
  let result = selector;
  let position = 0;
  while (position < result.length) {
    const whereIndex = result.indexOf(':where(', position);
    if (whereIndex === -1) {
      break;
    }
    // Index of the '(' in the first ':where('
    const firstOpenParenthesis = whereIndex + 6;
    const firstCloseParenthesis = findMatchingCloseParenthesis(result, firstOpenParenthesis);
    if (firstCloseParenthesis === -1) {
      break;
    }
    const adjacentStart = firstCloseParenthesis + 1;
    const adjacentWhereTag = ':where(';
    if (result.slice(adjacentStart, adjacentStart + adjacentWhereTag.length) !== adjacentWhereTag) {
      position = firstCloseParenthesis + 1;
      continue;
    }
    // Index of the '(' in the second ':where('
    const secondOpenParenthesis = adjacentStart + 6;
    const secondCloseParenthesis = findMatchingCloseParenthesis(result, secondOpenParenthesis);
    if (secondCloseParenthesis === -1) {
      break;
    }
    const firstInnerContent = result.slice(firstOpenParenthesis + 1, firstCloseParenthesis);
    const secondInnerContent = result.slice(secondOpenParenthesis + 1, secondCloseParenthesis);
    const leftParts = splitParametersByComma(firstInnerContent);
    const rightParts = splitParametersByComma(secondInnerContent);
    const mergedParts = buildWhereCartesianProduct(leftParts, rightParts);
    if (mergedParts === null) {
      position = firstCloseParenthesis + 1;
      continue;
    }
    const originalFragment = result.slice(whereIndex, secondCloseParenthesis + 1);
    const mergedFragment = ':where(' + mergedParts.join(',') + ')';
    if (mergedFragment.length < originalFragment.length) {
      result = result.slice(0, whereIndex) + mergedFragment + result.slice(secondCloseParenthesis + 1);
      // Don't advance position; the merged result may be adjacent to another :where()
    } else {
      position = firstCloseParenthesis + 1;
    }
  }
  return result;
}

/**
 * Matches a compound selector built exclusively from long-established simple
 * selectors: an optional type or universal selector, followed by any number of
 * id and class selectors. Anything else (pseudo-classes, pseudo-elements,
 * attribute matchers, combinators, descendant sequences) is excluded, because
 * those may be unrecognized by a browser and `:is()` forgiving parsing is what
 * keeps the remaining selectors in the rule alive.
 *
 * @type {RegExp}
 */
const BROWSER_SAFE_COMPOUND_SELECTOR = /^(?:\*|[a-zA-Z][a-zA-Z0-9_-]*)?(?:[#.][a-zA-Z_-][a-zA-Z0-9_-]*)*$/;

/**
 * Matches every id or class selector within a compound selector, used to count
 * each one's specificity contribution.
 *
 * @type {RegExp}
 */
const ID_OR_CLASS_SELECTOR = /[#.][a-zA-Z_-][a-zA-Z0-9_-]*/g;

/**
 * Computes the specificity of a compound selector known to consist only of
 * type, universal, id, and class selectors, as an "ids,classes,types" key.
 *
 * @param  {string} compoundSelector  A browser-safe compound selector.
 * @return {string}                   The specificity key for equality comparison.
 */
function getSimpleCompoundSpecificityKey (compoundSelector) {
  const idsAndClasses = compoundSelector.match(ID_OR_CLASS_SELECTOR) || [];
  const identifierCount = idsAndClasses.filter((selector) => {
    return selector.startsWith('#');
  }).length;
  const classCount = idsAndClasses.length - identifierCount;
  // Whatever precedes the first id/class is the type or universal selector, if any
  const typePortion = compoundSelector.split(/[#.]/)[0];
  const typeCount = typePortion && typePortion !== '*' ? 1 : 0;
  return identifierCount + ',' + classCount + ',' + typeCount;
}

/**
 * Determines whether a `:is()` selector list can be decomposed into a plain
 * comma-separated selector list. `:is()` applies the highest specificity of its
 * arguments to every match, so decomposing is only equivalent when all
 * arguments share one specificity. It also parses forgivingly, so every
 * argument must additionally be a selector every browser understands.
 *
 * @param  {Array}   parts  The selector strings inside the `:is()`.
 * @return {boolean}        True when the `:is()` wrapper can be dropped.
 */
function canDecomposeIsSelector (parts) {
  if (parts.length < 2) {
    return false;
  }
  const allBrowserSafe = parts.every((part) => {
    return part !== '' && BROWSER_SAFE_COMPOUND_SELECTOR.test(part);
  });
  if (!allBrowserSafe) {
    return false;
  }
  const specificityKeys = parts.map((part) => {
    return getSimpleCompoundSpecificityKey(part);
  });
  return specificityKeys.every((key) => {
    return key === specificityKeys[0];
  });
}

/**
 * Processes a bare `:is()` selector by merging `:link`+`:visited` into `:any-link`,
 * de-duplicating, sorting alphabetically, and decomposing into individual selectors
 * when the remaining parts are browser-safe and share one level of specificity.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {Array}            An array of one or more processed selector strings.
 */
function processIsSelector (selector) {
  // Replace :is(:link,:visited) and :is(:visited,:link) with :any-link
  selector = selector.replace(/:is\(:link,:visited\)/g, ':any-link');
  selector = selector.replace(/:is\(:visited,:link\)/g, ':any-link');
  // Only process bare :is() selectors (where :is() is the entire selector)
  if (!selector.startsWith(':is(')) {
    return [selector];
  }
  let depth = 0;
  let closingIndex = -1;
  for (let index = 4; index < selector.length; index++) {
    if (selector[index] === '(') {
      depth++;
    } else if (selector[index] === ')') {
      if (depth === 0) {
        closingIndex = index;
        break;
      }
      depth--;
    }
  }
  if (closingIndex !== selector.length - 1) {
    return [selector];
  }
  const content = selector.slice(4, -1);
  let parts = [];
  let currentPart = '';
  let parenDepth = 0;
  for (const character of content) {
    if (character === '(') {
      parenDepth++;
    } else if (character === ')') {
      parenDepth--;
    }
    if (character === ',' && parenDepth === 0) {
      parts.push(currentPart);
      currentPart = '';
    } else {
      currentPart += character;
    }
  }
  parts.push(currentPart);
  // Replace :link + :visited with :any-link
  const hasLink = parts.includes(':link');
  const hasVisited = parts.includes(':visited');
  if (hasLink && hasVisited) {
    parts = parts.filter((part) => {
      return part !== ':link' && part !== ':visited';
    });
    if (!parts.includes(':any-link')) {
      parts.push(':any-link');
    }
  }
  // De-duplicate
  parts = [...new Set(parts)];
  // Sort alphabetically
  parts.sort();
  // Unwrap :is() with a single selector
  if (parts.length === 1) {
    return parts;
  }
  // Drop the :is() wrapper when the parts are equivalent as a plain selector list
  if (canDecomposeIsSelector(parts)) {
    return parts;
  }
  return [':is(' + parts.join(',') + ')'];
}

/**
 * Flattens a top-level `:is()` selector into its individual parts when the rule
 * acts as a nesting parent. A nesting parent's entire selector list is treated
 * as `:is()` when computing the specificity of its nested children, so lifting
 * the parts out of an inner `:is()` does not change specificity. The `:is()` is
 * kept when any part contains a pseudo (`:`), since such selectors may be
 * unsupported and rely on `:is()` for forgiving parsing.
 *
 * @param  {string} selector  A minified CSS selector string.
 * @return {Array}            The flattened selector parts, or the original selector.
 */
function flattenNestingParentIsSelector (selector) {
  if (!selector.startsWith(':is(')) {
    return [selector];
  }
  let depth = 0;
  let closingIndex = -1;
  for (let index = 4; index < selector.length; index++) {
    if (selector[index] === '(') {
      depth++;
    } else if (selector[index] === ')') {
      if (depth === 0) {
        closingIndex = index;
        break;
      }
      depth--;
    }
  }
  // The :is() must span the entire selector to be safely liftable
  if (closingIndex !== selector.length - 1) {
    return [selector];
  }
  const parts = splitParametersByComma(selector.slice(4, -1)).map((part) => {
    return part.trim();
  });
  const hasPotentiallyUnsupportedPart = parts.some((part) => {
    return part.includes(':');
  });
  if (hasPotentiallyUnsupportedPart) {
    return [selector];
  }
  return parts;
}
export {
  flattenNestingParentIsSelector,
  mergeAdjacentWherePseudoClasses,
  processIsSelector,
  splitParametersByComma
};
