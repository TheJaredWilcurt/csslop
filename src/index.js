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
  nestFlatRules
} from './rules/optimize.js';
import { stringifyRule } from './rules/stringify.js';
import { minifyValue } from './value/minify.js';

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
    const finalRules = factorCommonParents(nestedRules);

    for (const rule of finalRules) {
      output.push(stringifyRule(rule, context));
    }

    return restoreEscapeSequences(output.join(''));
  }

  return source;
};
