/**
 * @file Testing the CSS Minifier.
 */
import {
  readdirSync,
  readFileSync
} from 'node:fs';
import { join } from 'path';

import { minifyCSS } from '../index.js';

let pass = 0;
let fail = 0;
const folders = {};

/**
 * Loads all tests into memory.
 *
 * @return {Array} All tests
 */
function loadAllTests () {
  const allTests = [];
  const __dirname = import.meta.dirname;
  const copiedTests = join(__dirname, '..', 'copiedTests');
  const testFolders = readdirSync(copiedTests);
  for (const folder of testFolders) {
    folders[folder] = { fail: 0, total: 0 };
    const testFolder = join(copiedTests, folder);
    const testNumbers = readdirSync(testFolder);
    for (const testNumber of testNumbers) {
      const expected = join(testFolder, testNumber, 'expected.css');
      const source = join(testFolder, testNumber, 'source.css');
      const README = join(testFolder, testNumber, 'README.md');
      const test = {
        folder,
        testNumber,
        source: String(readFileSync(source)).trim(),
        expected: String(readFileSync(expected)).trim(),
        description: String(readFileSync(README)).trim()
      };
      allTests.push(test);
    }
  }
  return allTests;
}

/**
 * Runs all tests, benchmarks time, and updates record of pass/fail.
 *
 * @param  {Array}  allTests  Array of test objects
 * @return {string}           The benchmark time in seconds as string
 */
function runAllTests (allTests) {
  const now = new Date();
  for (const test of allTests) {
    const testFolder = test.folder;
    const {
      testNumber,
      description,
      expected,
      folder,
      source
    } = test;
    const actual = minifyCSS(source);
    folders[folder].total++;
    if (actual === expected) {
      pass++;
    } else {
      folders[folder].fail++;
      fail++;
      console.log({
        id: '/copiedTests/' + testFolder + '/' + testNumber,
        description,
        source,
        expected, 
        actual
      });
    }
  }
  const time = (((new Date()) - now) / 1000) + 's';
  return time;
}

const allTests = loadAllTests();
const time = runAllTests(allTests);

for (const folder in folders) {
  if (!folders[folder].fail) {
    delete folders[folder];
  }
}

const total = pass + fail;
const percent = Math.floor((pass / total) * 100) + '%';

console.log(pass + '/' + total + ' tests passed (' + percent + ') in ' + time);

if (Object.keys(folders).length) {
  console.log(folders);
}
