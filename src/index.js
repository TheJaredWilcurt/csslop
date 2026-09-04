/**
 * @file CSS minification entry point.
 */

import { parse } from '@node-projects/css-parser';

import {
  detectCharset,
  filterRedundantCharsets
} from './charset.js';
import {
  clearActiveCharset,
  createMinifyContext,
  setActiveCharset
} from './context.js';
import { recordStylesheetResetProperties } from './declarations/reset-hazards.js';
import {
  analyzePositionTryRules,
  cleanPositionTryRules,
  collectRuleMetadata,
  filterUnusedPositionTry
} from './position-try.js';
import {
  neutralizeEscapeSequences,
  preprocessDeclarationBlocks,
  restoreEscapeSequences
} from './preprocess.js';
import {
  deduplicateKeyframes,
  expandPureNestedRules,
  factorCommonParents,
  mergeByDeclarations,
  mergeIdenticalNestedRules,
  mergeLayerRules,
  mergeMediaRules,
  mergeSelectorRules,
  nestFlatRules,
  removeEmptyRules,
  removeOverriddenMultiSelectorProperties
} from './rules/optimize.js';
import {
  removeRedundantLayerStatementSemicolon,
  stringifyRule
} from './rules/stringify.js';
import {
  clearMinifiedValueCache,
  minifyValue
} from './value/minify.js';

/**
 * Splits a minified CSS selector list at top-level commas, respecting
 * parenthesized and bracketed groups so that commas inside pseudo-class
 * arguments like `:is(a, b)` are not treated as selector separators.
 *
 * @param  {string} selectorList  The comma-separated selector list string.
 * @return {Array}                An array of individual selector strings.
 */
function splitSelectorList (selectorList) {
  const selectors = [];
  let current = '';
  let depth = 0;
  for (const character of selectorList) {
    if (character === '(' || character === '[') {
      depth++;
      current += character;
    } else if (character === ')' || character === ']') {
      depth--;
      current += character;
    } else if (character === ',' && depth === 0) {
      selectors.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  const remaining = current.trim();
  if (remaining) {
    selectors.push(remaining);
  }
  return selectors;
}

/**
 * Deduplicates a minified CSS selector list string by splitting at top-level
 * commas, removing duplicate selectors, and rejoining with commas.
 *
 * @param  {string} selectorList  The comma-separated selector list string.
 * @return {string}               The deduplicated selector list string.
 */
function deduplicateSelectorList (selectorList) {
  const selectors = splitSelectorList(selectorList);
  const seen = new Set();
  const unique = selectors.filter((selector) => {
    if (seen.has(selector)) {
      return false;
    }
    seen.add(selector);
    return true;
  });
  return unique.join(',');
}

/**
 * Extracts the declaration body (from the opening brace to the end) of a
 * stringified CSS rule. Returns null for at-rules or strings without braces,
 * since those should not participate in selector merging.
 *
 * @param  {string}      ruleString  A stringified CSS rule.
 * @return {string|null}             The body substring starting at `{`, or null if not a simple rule.
 */
function extractRuleBody (ruleString) {
  // At-rules start with @ and should not be merged by selector
  if (ruleString.startsWith('@')) {
    return null;
  }
  const braceIndex = ruleString.indexOf('{');
  if (braceIndex === -1) {
    return null;
  }
  return ruleString.slice(braceIndex);
}

/**
 * Normalizes a stringified CSS rule body for order-independent comparison
 * by sorting top-level declarations alphabetically. Bodies that contain
 * nested rules (additional `{` characters beyond the opening brace) are
 * returned as-is since their internal structure makes simple sorting unsafe.
 *
 * @param  {string} body  The rule body string starting with `{`.
 * @return {string}       The body with declarations sorted, or the original body if it contains nested rules.
 */
function normalizeBodyForComparison (body) {
  // Nested rules contain additional opening braces; skip normalization
  if (body.indexOf('{', 1) !== -1) {
    return body;
  }
  const inner = body.slice(1, -1);
  if (!inner) {
    return body;
  }
  const declarations = inner.split(';').filter(Boolean).sort();
  return '{' + declarations.join(';') + '}';
}

/**
 * Merges consecutive stringified rules that share an identical declaration
 * body into a single rule with comma-separated selectors. This catches
 * rules whose values only become identical after minification (e.g.
 * `#F00` and `rgb(255,0,0)` both minify to `red`).
 *
 * @param  {Array} ruleStrings  The array of stringified CSS rule strings.
 * @return {Array}              A new array with adjacent identical-body rules merged.
 */
function mergeAdjacentRulesWithIdenticalBodies (ruleStrings) {
  const result = [];
  for (const ruleString of ruleStrings) {
    if (!ruleString) {
      continue;
    }
    const lastResult = result[result.length - 1];
    if (lastResult) {
      const lastBody = extractRuleBody(lastResult);
      const currentBody = extractRuleBody(ruleString);
      const bodiesAreEquivalent = (
        lastBody &&
        currentBody &&
        normalizeBodyForComparison(lastBody) === normalizeBodyForComparison(currentBody)
      );
      if (bodiesAreEquivalent) {
        const lastSelector = lastResult.slice(0, lastResult.length - lastBody.length);
        const currentSelector = ruleString.slice(0, ruleString.length - currentBody.length);
        const combinedSelector = deduplicateSelectorList(lastSelector + ',' + currentSelector);
        result[result.length - 1] = combinedSelector + lastBody;
        continue;
      }
    }
    result.push(ruleString);
  }
  return result;
}

/**
 * Prepares the module-level state a single minification pass relies on: the
 * active charset, and an empty value cache, since a value memoized under a
 * different charset may no longer minify the same way.
 *
 * @param {string} charset  The `@charset` value detected in the source.
 */
function beginMinificationPass (charset) {
  setActiveCharset(charset);
  clearMinifiedValueCache();
}

/**
 * Releases the module-level state a minification pass built up, so a cache
 * filled by a large stylesheet is not retained until the next pass runs.
 */
function endMinificationPass () {
  clearActiveCharset();
  clearMinifiedValueCache();
}

/**
 * Parses, optimizes, and minifies a CSS string by applying rule merging, declaration deduplication, value compression, and dead-code elimination.
 *
 * @param  {string} input  The raw CSS string to minify.
 * @return {string}        The fully minified CSS string, or the original input if parsing fails.
 */
export const minifyCSS = function (input) {
  let source;
  if (typeof input === 'string') {
    source = input;
  } else {
    source = String(input ?? '');
  }
  let ast;
  const output = [];

  const detectedCharset = detectCharset(source);
  beginMinificationPass(detectedCharset);

  try {
    ast = parse(
      preprocessDeclarationBlocks(neutralizeEscapeSequences(source)),
      { preserveFormatting: true, silent: true }
    );
  } catch {
    endMinificationPass();
    return source;
  }

  const context = createMinifyContext();

  if (ast?.stylesheet?.rules) {
    // Which properties a shorthand may not silently reset is a question about
    // the whole stylesheet, so it is answered before any rule is rewritten.
    recordStylesheetResetProperties(ast.stylesheet.rules, context);

    const {
      positionTryRules,
      positionTryUsage
    } = collectRuleMetadata(ast.stylesheet.rules, context);

    analyzePositionTryRules(
      ast.stylesheet.rules,
      minifyValue,
      positionTryRules,
      positionTryUsage
    );
    cleanPositionTryRules(ast.stylesheet.rules);

    ast.stylesheet.rules = filterUnusedPositionTry(
      ast.stylesheet.rules,
      positionTryRules,
      positionTryUsage
    );
    ast.stylesheet.rules = filterRedundantCharsets(ast.stylesheet.rules);

    ast.stylesheet.rules = expandPureNestedRules(ast.stylesheet.rules);
    ast.stylesheet.rules = mergeLayerRules(ast.stylesheet.rules, mergeSelectorRules);
    ast.stylesheet.rules = mergeMediaRules(ast.stylesheet.rules, mergeSelectorRules);
    ast.stylesheet.rules = deduplicateKeyframes(ast.stylesheet.rules);

    const mergedRules = mergeSelectorRules(ast.stylesheet.rules);
    const overrideCleanedRules = removeOverriddenMultiSelectorProperties(mergedRules);
    const preCleanedRules = removeEmptyRules(overrideCleanedRules);
    const declarationMergedRules = mergeByDeclarations(preCleanedRules);
    const nestedRules = nestFlatRules(declarationMergedRules);
    const nonEmptyRules = removeEmptyRules(nestedRules);
    const factoredRules = factorCommonParents(nonEmptyRules);
    const nestedFinalRules = nestFlatRules(factoredRules);
    const finalRules = mergeIdenticalNestedRules(nestedFinalRules);

    for (const rule of finalRules) {
      output.push(stringifyRule(rule, context));
    }

    const mergedOutput = removeRedundantLayerStatementSemicolon(mergeAdjacentRulesWithIdenticalBodies(output));

    endMinificationPass();
    return restoreEscapeSequences(mergedOutput.join(''));
  }

  endMinificationPass();
  return source;
};
