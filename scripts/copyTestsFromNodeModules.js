/**
 * @file Copies the test suite from `node_modules/css-minify-tests`.
 */

import { copyTests } from './copyTests.js';

const fromNodeModules = true;

copyTests(fromNodeModules);
