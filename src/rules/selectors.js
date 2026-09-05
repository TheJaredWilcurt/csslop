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
 * Advances past a quoted string in a selector, honoring backslash escapes so a
 * quoted close-quote does not end the skip early.
 *
 * @param  {string} text        The selector string being scanned.
 * @param  {number} quoteIndex  The index of the opening quote character.
 * @return {number}             The index right after the closing quote, or the end of the string if the quote never closes.
 */
function skipQuotedText (text, quoteIndex) {
  const quote = text[quoteIndex];
  let index = quoteIndex + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index++;
    } else if (text[index] === quote) {
      return index + 1;
    }
    index++;
  }
  return text.length;
}

/**
 * Advances past an attribute selector `[...]` in a selector, skipping quoted
 * values and escaped characters so brackets inside them are not miscounted.
 *
 * @param  {string} text       The selector string being scanned.
 * @param  {number} openIndex  The index of the `[` that opens the attribute selector.
 * @return {number}            The index right after the closing `]`, or the end of the string if it never closes.
 */
function skipAttributeSelector (text, openIndex) {
  let index = openIndex + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === '\'') {
      index = skipQuotedText(text, index);
      continue;
    }
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === ']') {
      return index + 1;
    }
    index++;
  }
  return text.length;
}

/**
 * Finds the index of the closing parenthesis that matches the opening
 * parenthesis at the given position in the string, skipping over quoted
 * strings and attribute selectors so parentheses inside them are ignored.
 *
 * @param  {string} text       The string to search within.
 * @param  {number} openIndex  The index of the opening parenthesis.
 * @return {number}            The index of the matching closing parenthesis, or -1 if not found.
 */
function findMatchingCloseParenthesis (text, openIndex) {
  let depth = 0;
  let index = openIndex;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === '\'') {
      index = skipQuotedText(text, index);
      continue;
    }
    if (character === '[') {
      index = skipAttributeSelector(text, index);
      continue;
    }
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
    index++;
  }
  return -1;
}

/**
 * Finds the next occurrence of a pseudo-class function token (e.g. `:is(`)
 * that sits at the top level of a selector, outside any quoted string or
 * attribute selector.
 *
 * @param  {string} text          The selector string to scan.
 * @param  {string} functionCall  The function token to find, including its opening parenthesis.
 * @param  {number} start         The index to start scanning from.
 * @return {number}               The index of the next top-level occurrence, or -1 if none remains.
 */
function findNextFunctionCallOutsideStrings (text, functionCall, start) {
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === '\'') {
      index = skipQuotedText(text, index);
      continue;
    }
    if (character === '[') {
      index = skipAttributeSelector(text, index);
      continue;
    }
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (text.startsWith(functionCall, index)) {
      return index;
    }
    index++;
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
 * Pseudo-classes that every browser has recognized for many years. Wrapping
 * one of these in `:is()` cannot protect a rule from a browser that would not
 * know how to parse it, because every browser does. Keeping the list to
 * long-established pseudo-classes means newer or vendor-specific ones continue
 * to be treated as potentially unknown.
 *
 * @type {Set<string>}
 */
const WELL_KNOWN_PSEUDO_CLASSES = new Set([
  'active',
  'any-link',
  'checked',
  'default',
  'dir',
  'disabled',
  'empty',
  'enabled',
  'first-child',
  'first-of-type',
  'focus',
  'focus-visible',
  'focus-within',
  'fullscreen',
  'hover',
  'in-range',
  'indeterminate',
  'invalid',
  'lang',
  'last-child',
  'last-of-type',
  'link',
  'not',
  'nth-child',
  'nth-last-child',
  'nth-last-of-type',
  'nth-of-type',
  'only-child',
  'only-of-type',
  'optional',
  'out-of-range',
  'placeholder-shown',
  'read-only',
  'read-write',
  'required',
  'root',
  'scope',
  'target',
  'valid',
  'visited'
]);

/**
 * The legacy pseudo-elements that browsers accept with a single colon. They
 * are tracked because pseudo-elements inside `:is()` never match (the spec
 * forbids them), so unwrapping such an `:is()` would resurrect a dead rule.
 *
 * @type {Set<string>}
 */
const LEGACY_PSEUDO_ELEMENT_NAMES = new Set([
  'after',
  'before',
  'first-letter',
  'first-line'
]);

/**
 * Functional pseudo-classes whose argument is a selector list, such as
 * `:not(.a)`. Their specificity comes from their argument rather than the
 * pseudo-class itself, so a simple token count cannot describe them.
 *
 * @type {Set<string>}
 */
const SELECTOR_ARGUMENT_PSEUDO_CLASSES = new Set([
  'is',
  'where',
  'has',
  'not',
  'matches',
  '-webkit-any',
  '-moz-any'
]);

/**
 * Matches a single character allowed inside a selector identifier (letters,
 * digits, hyphens, underscores).
 *
 * @type {RegExp}
 */
const IDENTIFIER_CHARACTER = /[a-zA-Z0-9_-]/;

/**
 * Matches a single ASCII letter, which is how a type selector name begins.
 *
 * @type {RegExp}
 */
const TYPE_SELECTOR_START = /[a-zA-Z]/;

/**
 * Matches a single character that may start a pseudo-class or pseudo-element
 * name (a letter, or a hyphen for vendor-prefixed names).
 *
 * @type {RegExp}
 */
const PSEUDO_NAME_CHARACTER = /[a-zA-Z-]/;

/**
 * Reads a pseudo-class or pseudo-element name starting at the given index and
 * returns the index right after the final name character.
 *
 * @param  {string} selector  The selector string being scanned.
 * @param  {number} start     The index of the name's first character.
 * @return {number}           The index immediately after the pseudo name.
 */
function readPseudoNameEnd (selector, start) {
  let index = start;
  while (index < selector.length && PSEUDO_NAME_CHARACTER.test(selector[index])) {
    index++;
  }
  return index;
}

/**
 * Result of scanning one compound selector: how many simple selectors of each
 * specificity tier it holds and whether a browser could fail to recognize any
 * of them.
 *
 * @typedef  {object}  CompoundSelectorSummary
 * @property {number}  identifierCount          Number of id selectors.
 * @property {number}  classLevelCount          Number of class, attribute, and pseudo-class selectors.
 * @property {number}  typeLevelCount           Number of type selectors and pseudo-elements.
 * @property {boolean} hasPseudoElement         True when a pseudo-element is present.
 * @property {boolean} recognizable             True when every simple selector is universally recognized.
 */

/**
 * Scans a compound selector (one without combinators) and summarizes its
 * simple selectors for specificity comparison and recognizability checks.
 * Returns null when the string is not a plain compound selector, since
 * something else (a combinator, a stray character) was found inside.
 *
 * @param  {string}                       selector  The compound selector string to summarize.
 * @return {CompoundSelectorSummary|null}           The summary, or null for non-compound input.
 */
function summarizeCompoundSelector (selector) {
  if (!selector) {
    return null;
  }
  const summary = {
    identifierCount: 0,
    classLevelCount: 0,
    typeLevelCount: 0,
    hasPseudoElement: false,
    recognizable: true
  };
  let index = 0;
  let tokenCount = 0;
  while (index < selector.length) {
    const character = selector[index];
    if (tokenCount === 0 && (character === '*' || TYPE_SELECTOR_START.test(character))) {
      // The first simple selector of a compound may be a type (`div`) or universal (`*`) selector
      if (character !== '*') {
        let end = index + 1;
        while (end < selector.length && IDENTIFIER_CHARACTER.test(selector[end])) {
          end++;
        }
        index = end;
        summary.typeLevelCount++;
      } else {
        index++;
      }
      tokenCount++;
      continue;
    }
    if (character === '#' || character === '.') {
      // Id and class selectors are an identifier prefixed by '#' or '.'
      const nameStart = index + 1;
      if (nameStart >= selector.length || !IDENTIFIER_CHARACTER.test(selector[nameStart])) {
        return null;
      }
      let end = nameStart + 1;
      while (end < selector.length && IDENTIFIER_CHARACTER.test(selector[end])) {
        end++;
      }
      index = end;
      if (character === '#') {
        summary.identifierCount++;
      } else {
        summary.classLevelCount++;
      }
    } else if (character === '[') {
      // Attribute selector: well-formed input has a closing bracket
      const closeBracketIndex = selector.indexOf(']', index + 1);
      if (closeBracketIndex === -1) {
        return null;
      }
      index = closeBracketIndex + 1;
      summary.classLevelCount++;
    } else if (character === ':') {
      let nameStart = index + 1;
      const isDoubleColon = selector[nameStart] === ':';
      if (isDoubleColon) {
        nameStart++;
      }
      const nameEnd = readPseudoNameEnd(selector, nameStart);
      if (nameEnd === nameStart) {
        return null;
      }
      const pseudoName = selector.slice(nameStart, nameEnd).toLowerCase();
      index = nameEnd;
      if (selector[index] === '(') {
        // Functional pseudo-class: skip past its balanced argument parentheses
        const closeParenthesisIndex = findMatchingCloseParenthesis(selector, index);
        if (closeParenthesisIndex === -1) {
          return null;
        }
        index = closeParenthesisIndex + 1;
      }
      if (isDoubleColon || LEGACY_PSEUDO_ELEMENT_NAMES.has(pseudoName)) {
        summary.hasPseudoElement = true;
        summary.recognizable = false;
        summary.typeLevelCount++;
      } else if (SELECTOR_ARGUMENT_PSEUDO_CLASSES.has(pseudoName)) {
        // Selector-argument pseudo-classes take their specificity from their
        // argument, so simple token counting cannot price them, and their
        // argument may itself contain something unknown to older browsers.
        summary.recognizable = false;
        summary.classLevelCount++;
      } else {
        summary.classLevelCount++;
        if (!WELL_KNOWN_PSEUDO_CLASSES.has(pseudoName)) {
          summary.recognizable = false;
        }
      }
    } else {
      return null;
    }
    tokenCount++;
  }
  if (tokenCount === 0) {
    return null;
  }
  return summary;
}

/**
 * Splits a complex selector into the compound segments between its top-level
 * combinators, treating anything inside parentheses or attribute brackets as
 * part of the current segment.
 *
 * @param  {string} selector  The selector string to split.
 * @return {Array}            The compound selector segments, combinators excluded.
 */
function splitCombinatorSegments (selector) {
  const segments = [];
  let currentSegment = '';
  let depth = 0;
  for (const character of selector) {
    if (character === '(' || character === '[') {
      depth++;
    } else if (character === ')' || character === ']') {
      depth--;
    }
    // A combinator at the top level ends the current compound segment;
    // whitespace runs collapse into a single boundary
    if (depth === 0 && (character === '>' || character === '+' || character === '~' || /\s/.test(character))) {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = '';
      }
      continue;
    }
    currentSegment += character;
  }
  if (currentSegment) {
    segments.push(currentSegment);
  }
  return segments;
}

/**
 * Determines whether a selector is built entirely from simple selectors every
 * browser recognizes. Combinators are fine; only the compound segments between
 * them decide. Unknown pseudo-classes and pseudo-elements fail the check,
 * because a browser that cannot parse a selector discards its whole rule,
 * while `:is()` forgiving parsing would keep the rest of the rule alive.
 *
 * @param  {string}  selector  A minified CSS selector string.
 * @return {boolean}           True when the selector is universally recognizable.
 */
function isUniversallyRecognizableSelector (selector) {
  const segments = splitCombinatorSegments(selector);
  if (!segments.length) {
    return false;
  }
  return segments.every((segment) => {
    const summary = summarizeCompoundSelector(segment);
    return summary !== null && summary.recognizable && !summary.hasPseudoElement;
  });
}

/**
 * Determines whether a selector contains a pseudo-element anywhere (double
 * colon, or a legacy single-colon pseudo-element name). Pseudo-elements are
 * invalid inside `:is()`, so an `:is()` holding one never matches, and
 * unwrapping it would wrongly bring the selector to life.
 *
 * @param  {string}  selector  The selector string to inspect.
 * @return {boolean}           True when a pseudo-element token is present.
 */
function containsPseudoElement (selector) {
  let index = 0;
  while (index < selector.length) {
    if (selector[index] !== ':') {
      index++;
      continue;
    }
    if (selector[index + 1] === ':') {
      return true;
    }
    const nameEnd = readPseudoNameEnd(selector, index + 1);
    const pseudoName = selector.slice(index + 1, nameEnd).toLowerCase();
    if (LEGACY_PSEUDO_ELEMENT_NAMES.has(pseudoName)) {
      return true;
    }
    index = nameEnd > index + 1 ? nameEnd : index + 1;
  }
  return false;
}

/**
 * Determines whether a single selector contains a top-level combinator, which
 * would make it a complex selector rather than a single compound selector.
 *
 * @param  {string}  selector  The selector string to inspect.
 * @return {boolean}           True when a top-level combinator is present.
 */
function hasTopLevelCombinator (selector) {
  let depth = 0;
  for (const character of selector) {
    if (character === '(' || character === '[') {
      depth++;
    } else if (character === ')' || character === ']') {
      depth--;
    } else if (depth === 0 && (character === '>' || character === '+' || character === '~' || /\s/.test(character))) {
      // A combinator or whitespace boundary at the top level joins two compounds
      return true;
    }
  }
  return false;
}

/**
 * The characters that can start a simple selector mid-compound (id, class,
 * attribute selector, pseudo-class) or the nesting selector. Type and
 * universal selectors are excluded on purpose: they may only open a compound,
 * so `div:is(a)` cannot flatten to `diva`.
 *
 * @type {Set<string>}
 */
const SIMPLE_SELECTOR_STARTS = new Set(['#', '.', '[', ':', '&']);

/**
 * Determines whether a character sits between two selector parts, meaning an
 * `:is()` next to it is its own compound (or its own item in an argument
 * list) rather than fused with neighboring simple selectors.
 *
 * @param  {string}  character  The character to classify.
 * @return {boolean}            True when the character is a selector part boundary.
 */
function isSelectorPartBoundary (character) {
  // Combinators, whitespace, parentheses, and comma all delimit selector parts
  return /\s/.test(character) || character === '>' || character === '+' || character === '~' || character === '(' || character === ')' || character === ',';
}

/**
 * Unwraps every single-argument `:is()` found within a selector, since such an
 * `:is()` adds neither specificity (a one-argument `:is()` takes its
 * argument's) nor matching behavior of its own. The unwrap is refused when it
 * could change what a browser applies: an `:is()` fused to neighboring
 * compound parts cannot release a complex argument (`div:is(a b)` cannot
 * become `div a b`), and an argument a browser might not recognize must stay
 * inside `:is()` whenever sibling selectors rely on its forgiving parsing.
 *
 * @param  {string}  selector             A minified CSS selector string.
 * @param  {boolean} hasSiblingSelectors  True when the rule's selector list holds other selectors besides this one.
 * @return {string}                       The selector with redundant `:is()` wrappers removed.
 */
function unwrapSingleArgumentIsFunctions (selector, hasSiblingSelectors) {
  let result = selector;
  let position = 0;
  while (position < result.length) {
    const isIndex = findNextFunctionCallOutsideStrings(result, ':is(', position);
    if (isIndex === -1) {
      break;
    }
    const openParenthesisIndex = isIndex + 3;
    const closeParenthesisIndex = findMatchingCloseParenthesis(result, openParenthesisIndex);
    if (closeParenthesisIndex === -1) {
      break;
    }
    const content = result.slice(openParenthesisIndex + 1, closeParenthesisIndex);
    const innerSelector = content.trim();
    const parts = splitParametersByComma(content);
    if (parts.length !== 1 || !innerSelector) {
      position = closeParenthesisIndex + 1;
      continue;
    }
    const characterBefore = isIndex > 0 ? result[isIndex - 1] : '';
    const characterAfter = closeParenthesisIndex + 1 < result.length ? result[closeParenthesisIndex + 1] : '';
    const fusedOnLeft = characterBefore !== '' && !isSelectorPartBoundary(characterBefore);
    const fusedOnRight = characterAfter !== '' && !isSelectorPartBoundary(characterAfter);
    if ((fusedOnLeft || fusedOnRight) && hasTopLevelCombinator(innerSelector)) {
      position = closeParenthesisIndex + 1;
      continue;
    }
    // A compound selector's simple selectors must not fuse into one another:
    // dropped `:is()` text must still start with something that can continue a
    // compound (`div:is(.a)` → `div.a`) and end before something that can
    // continue one (`:is(.a):hover` → `.a:hover`), or tokens merge wrongly
    // (`div:is(a)` cannot become `diva`)
    if (fusedOnLeft && !SIMPLE_SELECTOR_STARTS.has(innerSelector[0])) {
      position = closeParenthesisIndex + 1;
      continue;
    }
    if (fusedOnRight && !SIMPLE_SELECTOR_STARTS.has(characterAfter)) {
      position = closeParenthesisIndex + 1;
      continue;
    }
    const canUnwrap = hasSiblingSelectors ?
      isUniversallyRecognizableSelector(innerSelector) :
      !containsPseudoElement(innerSelector);
    if (!canUnwrap) {
      position = closeParenthesisIndex + 1;
      continue;
    }
    result = result.slice(0, isIndex) + innerSelector + result.slice(closeParenthesisIndex + 1);
    // Stay at isIndex so a nested :is() exposed by this unwrap is considered next
  }
  return result;
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
  const summaries = [];
  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      return false;
    }
    const summary = summarizeCompoundSelector(trimmedPart);
    if (!summary || !summary.recognizable || summary.hasPseudoElement) {
      return false;
    }
    summaries.push(summary);
  }
  const firstSummary = summaries[0];
  return summaries.every((summary) => {
    return (
      summary.identifierCount === firstSummary.identifierCount &&
      summary.classLevelCount === firstSummary.classLevelCount &&
      summary.typeLevelCount === firstSummary.typeLevelCount
    );
  });
}

/**
 * Processes a selector by unwrapping redundant single-argument `:is()`
 * functions within it, then — for bare `:is()` selectors (where `:is()` is the
 * entire selector) — merging `:link`+`:visited` into `:any-link`,
 * de-duplicating, sorting alphabetically, and decomposing into individual
 * selectors when the remaining parts are browser-safe and share one level of
 * specificity.
 *
 * @param  {string}  selector             A minified CSS selector string.
 * @param  {boolean} hasSiblingSelectors  True when the rule's selector list holds other selectors besides this one.
 * @return {Array}                        An array of one or more processed selector strings.
 */
function processIsSelector (selector, hasSiblingSelectors) {
  // Replace :is(:link,:visited) and :is(:visited,:link) with :any-link
  selector = selector.replace(/:is\(:link,:visited\)/g, ':any-link');
  selector = selector.replace(/:is\(:visited,:link\)/g, ':any-link');
  selector = unwrapSingleArgumentIsFunctions(selector, hasSiblingSelectors);
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
    const onlyPart = parts[0].trim();
    const canUnwrap = hasSiblingSelectors ?
      isUniversallyRecognizableSelector(onlyPart) :
      !containsPseudoElement(onlyPart);
    return canUnwrap ? [onlyPart] : [':is(' + parts[0] + ')'];
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
