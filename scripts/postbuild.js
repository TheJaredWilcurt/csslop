/**
 * @file Scripts that run after `npm run build`.
 */

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const __dirname = import.meta.dirname;

/**
 * Patches the `/site/index.html` to inject the correct library version.
 */
function patchVersionIntoWebsite () {
  const manifestPath = join(__dirname, '..', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  const version = manifest.version;

  const indexPath = join(__dirname, '..', 'site', 'index.html');
  const index = String(readFileSync(indexPath));

  const mutated = index.replace('VERSION_GOES_HERE', 'v' + version);
  writeFileSync(indexPath, mutated);
}

/**
 * Runs automatically after `npm run build`.
 */
function postBuild () {
  patchVersionIntoWebsite();
  console.log('Post-Build complete');
}

postBuild();
