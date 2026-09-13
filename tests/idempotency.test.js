/**
 * @file Real world test for idempotency.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { minifyCSS } from '../index.js';

const __dirname = import.meta.dirname;

const fileName = 'zotero-dark-theme-v0.0.0.css';

/**
 * Runs the idempotency test.
 */
function run () {
  const node_modules = join(__dirname, '..', 'node_modules');
  const realWorld = join(node_modules, 'real-world-css-libraries');
  const filePath = join(realWorld, 'libs', fileName);

  const file = String(readFileSync(filePath));

  const first = minifyCSS(file);
  const second = minifyCSS(first);

  if (first !== second) {
    const log = {
      'Failed idempotency for': filePath,
      'Original File': file,
      'First Run': first,
      Rerun: second
    };
    console.log(JSON.stringify(log, null, 2));
  } else {
    console.log('Idempotency passed');
  }
}

run();

/*

Run `npm run idem` to test a single CSS file that fails at idempotency. Isolate
the output that changes from the first run to the rerun. Identify any patterns
that could be turned into a generic test similar to those in the /copiedTests
folder. Do not make any changes to any files in the repo. Run `beep` when done
to alert me you finished.

 */
