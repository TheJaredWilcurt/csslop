/**
 * @file Copies a failing file for AI to investigate.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { minifyCSS } from '../../index.js';

const failingFiles = [
  'css-extras-v0.4.0.css',
  'github-dark-v6.3.0.css',
  'github-windows-v0.6.0.css',
  'tailwind-v2.2.19.css'
];

for (const failingFile of failingFiles) {
  const __dirname = import.meta.dirname;
  const inputFile = join(__dirname, '..', '..', 'node_modules', 'real-world-css-libraries', 'libs', failingFile);
  const input = String(readFileSync(inputFile));
  const exampleFolder = join(__dirname, '..', '..', 'example');
  const copy = join(exampleFolder, 'failing.css');
  const minified = join(exampleFolder, 'failing.min.css');
  const output = minifyCSS(input);
  writeFileSync(copy, input + '\n');
  writeFileSync(minified, output + '\n');

  if (output.length >= input.length) {
    throw 'OUTPUT TOO LARGE';
  }
  if (output.trim().length === 0) {
    throw 'FILE NOT MINIFIED';
  }
}
