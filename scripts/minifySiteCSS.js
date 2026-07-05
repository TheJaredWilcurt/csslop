/**
 * @file Loops over `/public/styles/originals/*.css` and uses CSSLOP to minify
 *       them to `/public/styles/*.css`.
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { minifyCSS } from '../index.js';

const __dirname = import.meta.dirname;

/**
 * Loops over `/public/styles/originals/*.css` and uses CSSLOP to minify them to
 * `/public/styles/*.css`.
 */
export const minifySiteCSS = function () {
  const stylesPath = join(__dirname, '..', 'public', 'styles');
  const originalFolder = join(stylesPath, 'originals');
  const originalStyleFiles = readdirSync(originalFolder);
  for (const originalFileName of originalStyleFiles) {
    if (originalFileName.endsWith('.css')) {
      const filePath = join(originalFolder, originalFileName);
      const contents = String(readFileSync(filePath));
      const output = minifyCSS(contents) + '\n';
      const outputPath = join(stylesPath, originalFileName);
      writeFileSync(outputPath, output);
    }
  }
};
