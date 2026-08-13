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
 * Copies the test files from css-minify-tests to the copiedTests folder.
 */
export const copyTests = function () {
  const originalTests = join(
    __dirname,
    '..',
    '..',
    'css-minify-tests',
    'tests'
  );
  const copiedTests = join(
    __dirname,
    '..',
    'copiedTests'
  );

  if (!existsSync(originalTests)) {
    console.log([
      '',
      'COPY FAILED:',
      '',
      'You must `git clone` css-minify-tests to:',
      join(__dirname, '..', '..'),
      '',
      'HTTPS',
      'git clone https://github.com/keithamus/css-minify-tests.git',
      '',
      'SSH',
      'git clone git@github.com:keithamus/css-minify-tests.git',
      ''
    ].join('\n'));
    return;
  }

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

copyTests();
