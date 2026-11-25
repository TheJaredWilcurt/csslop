/**
 * @file Real world test for idempotency.
 */
import { join } from 'node:path';

import getRealWorldCSS from 'real-world-css-libraries';

import { minifyCSS } from '../index.js';

const __dirname = import.meta.dirname;

const knownBad = [
  'admin-lte-v4.0.0.css',
  'awesome-bootstrap-checkbox-v0.3.7.css',
  'beercss-v4.0.21.css',
  'blue-topaz-obsidian-v6.0.0.css',
  'bootplus-v1.0.5.css',
  'bulma-v1.0.4.css',
  'carbon-v1.107.0.css',
  'cirrus-v0.8.0.css',
  'classless-v1.0.0.css',
  'cs16-v0.0.0.css',
  'cssicon-v1.0.0.css',
  'cutestrap2-v2.0.0.css',
  'elegantfin-v25.12.31.css',
  'ff-ultima-v4.3.0.css',
  'finimalism-v12.0.0.css',
  'firefox-uwp-style-v0.0.0.css',
  'flakes-v1.0.1.css',
  'fluentbird-v1.1.2.css',
  'fomantic-v2.9.4.css',
  'foundation-v6.9.0.css',
  'github-dark-v6.3.0.css',
  'gitweb-theme-v0.0.0.css',
  'gridlex-v2.7.1.css',
  'gumby-v2.6.4.css',
  'halfmoon-v2.0.2.css',
  'hugo-universal-theme-v1.4.1.css',
  'less-framework-v0.0.0.css',
  'material-for-bootstrap-v4.1.1.css',
  'mini-v3.0.1.css',
  'missing-v1.3.0.css',
  'mvp-v1.17.3.css',
  'my-internet-v1.0.0.css',
  'nes-v2.3.0.css',
  'obsidian-colored-sidebar-v2.0.0.css',
  'obsidian-notebook-themes-v2.2.3.css',
  'patternfly-v6.5.2.css',
  'phonon-v1.5.1.css',
  'picnic-v7.1.0.css',
  'pico-v2.1.1.css',
  'portfolio-template-v0.0.0.css',
  'pretty-checkbox-v3.0.3.css',
  'proxmorph-v2.7.3.css',
  'responsive-4-v4.1.4.css',
  'sapc-apca-v0.0.0.css',
  'semantic-v2.5.0.css',
  'shina-fox-v0.1.0.css',
  'simple-v2.3.7.css',
  'spicetify-bloom-v0.0.0.css',
  'stackoverflow-dark-v5.1.2.css',
  'stacks-v2.8.6.css',
  'tablecloth-v1.0.0.css',
  'tocas-v5.7.0.css',
  'tufte-v1.8.0.css',
  'tw-animate-css-v1.4.0.css',
  'uikit-v3.25.17.css',
  'universal-v0.0.0.css',
  'uswds-v3.13.0.css',
  'water-v2.1.1.css',
  'wikipedia-dark-v3.7.9.css',
  'zotero-dark-theme-v0.0.0.css'
];

const onlyThese = [
];

let foundBad = [];

/**
 * Runs the idempotency test.
 */
function run () {
  const includeFileName = true;
  let libraries = getRealWorldCSS(includeFileName);

  for (const library of libraries) {
    const fileName = library.fileName;
    if (
      (
        onlyThese.length &&
        onlyThese.includes(fileName)
      ) ||
      (
        !onlyThese.length &&
        !knownBad.includes(fileName)
      )
    ) {
      const file = library.source;
      const first = minifyCSS(file);
      const second = minifyCSS(first);

      const filePath = join(
        __dirname,
        '..',
        'node_modules',
        'real-world-css-libraries',
        'libs',
        fileName
      );

      if (first !== second) {
        foundBad.push(fileName);
        const log = {
          'Failed idempotency for': filePath,
          'Original File': file,
          'First Run': first,
          Rerun: second
        };
        console.log(JSON.stringify(log, null, 2));
      }
    }
  }

  foundBad = Array.from(new Set(foundBad));
  foundBad = foundBad.sort();

  if (!foundBad.length) {
    console.log('Idempotency passed');
  } else if (foundBad.length === 1) {
    console.log('1 file failed idempotency');
    console.log(foundBad);
  } else {
    console.log(foundBad.length + ' files failed idempotency');
    console.log(JSON.stringify(foundBad, null, 2).replaceAll('"', '\''));
  }
}

run();

/*

Run `npm run idem` to test a single CSS file that fails at idempotency. Isolate the output that changes from the first run to the rerun. Identify any patterns that could be turned into a generic test similar to those in the /copiedTests folder. Do not make any changes to any files in the repo. Run `beep` when done to alert me you finished.

 */
