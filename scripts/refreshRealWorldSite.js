/* eslint-disable import-x/no-extraneous-dependencies */

/**
 * @file Copies real-world CSS files to the site folder and creates JSON for
 *       the site to load at runtime of the list of files.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import getRealWorldCSS from 'real-world-css-libraries';

const __dirname = import.meta.dirname;
const publicPath = join(__dirname, '..', 'public');

const copyFiles = function (libraries) {
  const realPath = join(publicPath, 'real');
  for (const library of libraries) {
    mkdirSync(realPath, { recursive: true });
    writeFileSync(join(realPath, library.fileName), library.source + '\n');
  }
};

const createJsonFile = function (libraries) {
  const libraryMap = libraries.map((library) => {
    return {
      fileName: library.fileName,
      name: library.name,
      size: library.size
    };
  });
  const fileNamesContent = JSON.stringify(libraryMap, null, 2);
  writeFileSync(join(publicPath, 'real.json'), fileNamesContent + '\n');
};

/**
 * Runs all commands in order.
 */
export const refreshRealWorldSite = function () {
  const libraries = getRealWorldCSS();
  copyFiles(libraries);
  createJsonFile(libraries);
};
