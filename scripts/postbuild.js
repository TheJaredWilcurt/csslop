import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const __dirname = import.meta.dirname;

function postBuild () {
  const manifestPath = join(__dirname, '..', 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath));
  const version = manifest.version;

  const indexPath = join(__dirname, '..', 'site', 'index.html');
  const index = String(readFileSync(indexPath));

  const mutated = index.replace('VERSION_GOES_HERE', 'v' + version);
  writeFileSync(indexPath, mutated);
  console.log('Post-Build complete');
}

postBuild();
