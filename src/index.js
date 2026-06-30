/**
 * @file CSS minification entry point.
 */

import { parse } from '@node-projects/css-parser';

import { createMinifyContext } from './context.js';
import {
  analyzePositionTryRules,
  cleanPositionTryRules,
  collectRuleMetadata,
  filterRedundantCharsets,
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
  mergeLayerRules,
  mergeMediaRules,
  mergeSelectorRules,
  nestFlatRules,
  removeEmptyRules
} from './rules/optimize.js';
import { stringifyRule } from './rules/stringify.js';
import { minifyValue } from './value/minify.js';

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
      if (lastBody && currentBody && lastBody === currentBody) {
        const lastSelector = lastResult.slice(0, lastResult.length - lastBody.length);
        const currentSelector = ruleString.slice(0, ruleString.length - currentBody.length);
        result[result.length - 1] = lastSelector + ',' + currentSelector + lastBody;
        continue;
      }
    }
    result.push(ruleString);
  }
  return result;
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

  try {
    ast = parse(
      preprocessDeclarationBlocks(neutralizeEscapeSequences(source)),
      { preserveFormatting: true, silent: true }
    );
  } catch {
    return source;
  }

  const context = createMinifyContext();

  if (ast?.stylesheet?.rules) {
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
    const declarationMergedRules = mergeByDeclarations(mergedRules);
    const nestedRules = nestFlatRules(declarationMergedRules);
    const nonEmptyRules = removeEmptyRules(nestedRules);
    const factoredRules = factorCommonParents(nonEmptyRules);
    const finalRules = nestFlatRules(factoredRules);

    for (const rule of finalRules) {
      output.push(stringifyRule(rule, context));
    }

    const mergedOutput = mergeAdjacentRulesWithIdenticalBodies(output);

    return restoreEscapeSequences(mergedOutput.join(''));
  }

  return source;
};
