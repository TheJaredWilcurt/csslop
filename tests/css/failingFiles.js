/**
 * @file Copies a failing file for AI to investigate.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { minifyCSS } from '../../index.js';


const failingFile = 'google-type-v0.0.0.css';


const __dirname = import.meta.dirname;
const inputFile = join(__dirname, '..', '..', 'node_modules', 'real-world-css-libraries', 'libs', failingFile);
const input = String(readFileSync(inputFile));
const exampleFolder = join(__dirname, '..', '..', 'example');
const copy = join(exampleFolder, 'failing.css');
const minified = join(exampleFolder, 'failing.min.css');
const output = minifyCSS(input);
writeFileSync(copy, input);
writeFileSync(minified, output);

if (output.length >= input.length) {
  throw 'OUTPUT TOO LARGE';
}
