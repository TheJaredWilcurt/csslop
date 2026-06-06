/**
 * @file Copies a failing file for AI to investigate.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { minifyCSS } from '../../index.js';

const __dirname = import.meta.dirname;

const failingFiles = [
  // 100%
  'bojler-v3.2.1.css',
  'google-type-v0.0.0.css',
  'halfstyle-v2.0.2.css',
  'nes-v2.3.0.css',
  'tablecloth-v1.10.0.css',
  'tailwind-v2.2.19.css',
  // 0%
  'css-extras-v0.4.0.css',
  'github-dark-v6.3.0.css',
  'github-windows-v0.6.0.css'
];

const failingFile = failingFiles[0];
const inputFile = join(__dirname, '..', '..', 'node_modules', 'real-world-css-libraries', 'libs', failingFile);
const input = String(readFileSync(inputFile));
const copy = join(__dirname, 'failing.css');
const minified = join(__dirname, 'failing.min.css');
writeFileSync(copy, input);
writeFileSync(minified, minifyCSS(input));
