/**
 * @file CSS minification entry point.
 */

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { parse } from '@node-projects/css-parser';

import { createMinifyContext } from './context.js';
import {
  analyzePositionTryRules,
  cleanPositionTryRules,
  collectRuleMetadata,
  filterRedundantCharsets,
  filterUnusedPositionTry
} from './position-try.js';
import { preprocessDeclarationBlocks } from './preprocess.js';
import {
  deduplicateKeyframes,
  expandPureNestedRules,
  mergeByDeclarations,
  mergeLayerRules,
  mergeMediaRules,
  mergeSelectorRules,
  nestFlatRules
} from './rules/optimize.js';
import { stringifyRule } from './rules/stringify.js';
import { minifyValue } from './value/minify.js';

const MAX_OUTPUT_CACHE_SIZE = 250;
const MAX_PENDING_ASYNC_CACHE_SIZE = 100;
const MIN_PARALLEL_RULES = 64;
const MIN_PARALLEL_SOURCE_LENGTH = 32768;
const MIN_RULES_PER_WORKER = 32;
const outputCache = new Map();
const pendingAsyncCache = new Map();
const stringifyWorkerUrl = new URL('./stringify-worker.js', import.meta.url);

/**
 * Stores a value in a bounded Map cache, clearing the entire cache when it exceeds the given size limit.
 *
 * @param  {Map}    cache    The Map cache to store the entry in.
 * @param  {string} key      The cache key.
 * @param  {string} value    The value to cache.
 * @param  {number} maxSize  The maximum number of entries before the cache is cleared.
 * @return {string}          The stored value.
 */
function setBoundedCacheEntry (cache, key, value, maxSize) {
  if (cache.size >= maxSize) {
    cache.clear();
  }
  cache.set(key, value);
  return value;
}

/**
 * Coerces a CSS input to a string, treating null and undefined as empty strings.
 *
 * @param  {string|number|null|undefined} input  The raw CSS input value.
 * @return {string}                              The input as a string.
 */
function normalizeInput (input) {
  if (typeof input === 'string') {
    return input;
  }
  return String(input ?? '');
}

/**
 * Parses a CSS source string into an AST, runs structural optimizations, and returns the final rule list and minification context.
 *
 * @param  {string}      source  The normalized CSS source string.
 * @return {object|null}         An object with context and finalRules, or null if parsing fails.
 */
function buildMinifiedState (source) {
  let ast;

  try {
    ast = parse(preprocessDeclarationBlocks(source), { preserveFormatting: true });
  } catch {
    return null;
  }

  const context = createMinifyContext();

  if (!ast?.stylesheet?.rules) {
    return null;
  }

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
  const finalRules = nestFlatRules(declarationMergedRules);

  return { context, finalRules };
}

/**
 * Converts an array of optimized AST rule nodes into a single minified CSS string.
 *
 * @param  {Array}  finalRules  The optimized AST rule nodes to stringify.
 * @param  {object} context     The minification context with registered custom property data.
 * @return {string}             The concatenated minified CSS output.
 */
function stringifyRules (finalRules, context) {
  const output = [];
  for (const rule of finalRules) {
    output.push(stringifyRule(rule, context));
  }
  return output.join('');
}

/**
 * Determines whether the source is large enough to benefit from parallel worker-thread stringification.
 *
 * @param  {string}  source      The CSS source string.
 * @param  {Array}   finalRules  The optimized AST rule nodes.
 * @return {boolean}             True if the source length and rule count exceed the parallelism thresholds.
 */
function shouldParallelizeStringify (source, finalRules) {
  return source.length >= MIN_PARALLEL_SOURCE_LENGTH && finalRules.length >= MIN_PARALLEL_RULES;
}

/**
 * Splits an array of rules into roughly equal-sized chunks for parallel processing.
 *
 * @param  {Array}  rules       The AST rule nodes to split.
 * @param  {number} chunkCount  The number of chunks to produce.
 * @return {Array}              An array of rule arrays, one per chunk.
 */
function splitRulesIntoChunks (rules, chunkCount) {
  const chunks = [];
  const chunkSize = Math.ceil(rules.length / chunkCount);
  for (let index = 0; index < rules.length; index += chunkSize) {
    chunks.push(rules.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Spawns a worker thread that stringifies a chunk of AST rules into minified CSS.
 *
 * @param  {Array}           rules    The AST rule nodes for this worker to stringify.
 * @param  {object}          context  The minification context passed to the worker.
 * @return {Promise<string>}          A promise that resolves to the minified CSS string.
 */
function runStringifyWorker (rules, context) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(stringifyWorkerUrl, {
      workerData: { context, rules }
    });
    let settled = false;
    const cleanup = () => {
      worker.removeAllListeners('error');
      worker.removeAllListeners('exit');
      worker.removeAllListeners('message');
    };

    worker.once('message', (output) => {
      settled = true;
      cleanup();
      resolve(output);
    });
    worker.once('error', (error) => {
      settled = true;
      cleanup();
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        cleanup();
        reject(new Error('Stringify worker exited with code ' + code));
      }
    });
  });
}

/**
 * Stringifies AST rules in parallel using worker threads when the input is large enough, falling back to synchronous stringification otherwise.
 *
 * @param  {string}          source      The CSS source string, used to decide parallelism.
 * @param  {Array}           finalRules  The optimized AST rule nodes to stringify.
 * @param  {object}          context     The minification context.
 * @return {Promise<string>}             A promise that resolves to the minified CSS string.
 */
async function stringifyRulesAsync (source, finalRules, context) {
  if (!shouldParallelizeStringify(source, finalRules)) {
    return stringifyRules(finalRules, context);
  }

  const cpuCount = Math.max(1, availableParallelism());
  const workerCount = Math.min(
    Math.max(1, cpuCount - 1),
    Math.floor(finalRules.length / MIN_RULES_PER_WORKER)
  );

  if (workerCount < 2) {
    return stringifyRules(finalRules, context);
  }

  const chunks = splitRulesIntoChunks(finalRules, workerCount);
  const outputs = await Promise.all(chunks.map((rules) => {
    return runStringifyWorker(rules, context);
  }));

  return outputs.join('');
}

/**
 * Parses, optimizes, and minifies a CSS string by applying rule merging, declaration deduplication, value compression, and dead-code elimination.
 *
 * @param  {string} input  The raw CSS string to minify.
 * @return {string}        The fully minified CSS string, or the original input if parsing fails.
 */
export const minifyCSS = function (input) {
  const source = normalizeInput(input);
  if (outputCache.has(source)) {
    return outputCache.get(source);
  }

  const minifiedState = buildMinifiedState(source);
  if (!minifiedState) {
    return setBoundedCacheEntry(outputCache, source, source, MAX_OUTPUT_CACHE_SIZE);
  }

  const result = stringifyRules(minifiedState.finalRules, minifiedState.context);
  return setBoundedCacheEntry(outputCache, source, result, MAX_OUTPUT_CACHE_SIZE);
};

/**
 * Asynchronous version of minifyCSS that uses worker threads for large stylesheets. Falls back to synchronous stringification on worker failure.
 *
 * @param  {string|number|null|undefined} input  The raw CSS input to minify.
 * @return {Promise<string>}                     A promise that resolves to the fully minified CSS string.
 */
export const minifyCSSAsync = async function (input) {
  const source = normalizeInput(input);
  if (outputCache.has(source)) {
    return outputCache.get(source);
  }
  if (pendingAsyncCache.has(source)) {
    return pendingAsyncCache.get(source);
  }

  const pendingResult = (async () => {
    const minifiedState = buildMinifiedState(source);
    if (!minifiedState) {
      return setBoundedCacheEntry(outputCache, source, source, MAX_OUTPUT_CACHE_SIZE);
    }

    try {
      const result = await stringifyRulesAsync(source, minifiedState.finalRules, minifiedState.context);
      return setBoundedCacheEntry(outputCache, source, result, MAX_OUTPUT_CACHE_SIZE);
    } catch {
      const result = stringifyRules(minifiedState.finalRules, minifiedState.context);
      return setBoundedCacheEntry(outputCache, source, result, MAX_OUTPUT_CACHE_SIZE);
    } finally {
      pendingAsyncCache.delete(source);
    }
  })();

  setBoundedCacheEntry(pendingAsyncCache, source, pendingResult, MAX_PENDING_ASYNC_CACHE_SIZE);
  return pendingResult;
};
