/**
 * @file Worker thread entry point that stringifies a chunk of CSS AST rules into minified output, communicating the result back to the parent thread via message passing.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { stringifyRule } from './rules/stringify.js';

const { context, rules } = workerData;

parentPort.postMessage(rules.map((rule) => {
  return stringifyRule(rule, context);
}).join(''));
