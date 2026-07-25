/**
 * @file Copies the test suite from `css-minify-tests`.
 */

import {
  cpSync,
  existsSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { join } from 'node:path';

const __dirname = import.meta.dirname;

/**
 *
 * @param fromNpm
 */

/**
 * Copies the test files from css-minify-tests to the copiedTests folder.
 *
 * @param {boolean} fromNpm  true = copy from node_modules, false = from local sister repo clone
 */
export const copyTests = function (fromNpm) {
  let originalTests = join(
    __dirname,
    '..',
    '..',
    'css-minify-tests',
    'tests'
  );
  if (fromNpm) {
    originalTests = join(
      __dirname,
      '..',
      'node_modules',
      'css-minify-tests',
      'tests'
    );
  }
  const copiedTests = join(
    __dirname,
    '..',
    'copiedTests'
  );

  // Clear folder
  rmSync(copiedTests, { recursive: true, force: true });
  // Copy fresh
  cpSync(originalTests, copiedTests, { recursive: true });

  // Remove validate files
  const testFolders = readdirSync(copiedTests);
  for (const folder of testFolders) {
    const testFolder = join(copiedTests, folder);
    const testNumbers = readdirSync(testFolder);
    for (const testNumber of testNumbers) {
      const validate = join(testFolder, testNumber, 'validate.html');
      if (existsSync(validate)) {
        rmSync(validate);
      }
    }
  }
};
