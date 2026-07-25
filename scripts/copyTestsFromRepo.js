/**
 * @file Copies the test suite from `../../css-minify-tests`.
 */

import { copyTests } from './copyTests.js';

const fromNodeModules = false;

copyTests(fromNodeModules);
