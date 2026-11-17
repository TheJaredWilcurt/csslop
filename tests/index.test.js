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
  function normalizeEOL (value) {
    return value.replaceAll('\r\n', '\n');
  }
  const allTests = [];
  const __dirname = import.meta.dirname;
  const copiedTests = join(__dirname, '..', 'copiedTests');
  const testFolders = readdirSync(copiedTests);
  for (const folder of testFolders) {
    folders[folder] = { fail: 0, total: 0 };
    const testFolder = join(copiedTests, folder);
    const testNumbers = readdirSync(testFolder);
    for (const testNumber of testNumbers) {
      const testFileNames = readdirSync(join(testFolder, testNumber));
      const accepted = testFileNames
        .filter((testFileName) => {
          return testFileName.startsWith('expected');
        })
        .map((testFileName) => {
          const expected = join(testFolder, testNumber, testFileName);
          return normalizeEOL(String(readFileSync(expected)).trim());
        });
      const source = join(testFolder, testNumber, 'source.css');
      const README = join(testFolder, testNumber, 'README.md');
      const test = {
        folder,
        testNumber,
        source: normalizeEOL(String(readFileSync(source)).trim()),
        accepted,
        description: normalizeEOL(String(readFileSync(README)).trim())
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
      accepted,
      folder,
      source
    } = test;
    const actual = minifyCSS(source);
    const rerun = minifyCSS(actual);
    folders[folder].total++;
    if (accepted.includes(actual)) {
      pass++;
    } else {
      folders[folder].fail++;
      fail++;
      console.log({
        id: '/copiedTests/' + testFolder + '/' + testNumber,
        description,
        source,
        accepted,
        actual
      });
    }
    if (actual !== rerun) {
      if (!folders.idempotency?.fail) {
        fail++;
      }
      folders.idempotency.fail++;
      console.log({
        id: '/copiedTests/' + testFolder + '/' + testNumber,
        description: 'This test has failed idempotency. ' +
          'It\'s minified output should not change if minified again.',
        source,
        accepted,
        actual,
        rerun
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
