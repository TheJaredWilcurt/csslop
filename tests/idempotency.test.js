/**
 * @file Real world test for idempotency.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import getRealWorldCSS from 'real-world-css-libraries';

import { minifyCSS } from '../index.js';

const __dirname = import.meta.dirname;

const knownBad = [
  // '3dtransforms-v0.0.0.css',
  '960.gs-v0.0.0.css',
  'admin-lte-v4.0.0.css',
  'awesome-bootstrap-checkbox-v0.3.7.css',
  'basscss-v8.1.0.css',
  'blooger-website-v0.0.0.css',
  'blue-topaz-obsidian-v6.0.0.css',
  'bojler-v3.2.1.css',
  'bootplus-v1.0.5.css',
  'bootstrap-4-v4.6.2.css',
  'bootstrap-5-v5.3.8.css',
  'bttn-v0.2.4.css',
  'carbon-v1.107.0.css',
  'cardinal-v3.7.0.css',
  'checka11y-v2.5.0.css',
  'chota-v0.9.2.css',
  'cirrus-v0.8.0.css',
  'cleanslate-v0.10.1.css',
  'colofilter-v0.0.0.css',
  'cs16-v0.0.0.css',
  'css-diner-v0.0.0.css',
  'css-social-buttons-v1.4.0.css',
  'cssco-v1.1.0.css',
  'cssicon-v1.0.0.css',
  'csszengarden-215-v0.0.0.css',
  'cutestrap1-v1.3.1.css',
  'destyle-v4.0.1.css',
  'devices-v0.2.0.css',
  'doxygen-awesome-v2.4.2.css',
  'elegantfin-v25.12.31.css',
  'ff-ultima-v4.3.0.css',
  'finimalism-v12.0.0.css',
  'firefox-uwp-style-v0.0.0.css',
  'flakes-v1.0.1.css',
  'fluentbird-v1.1.2.css',
  'fomantic-v2.9.4.css',
  'font-awesome-v7.2.0.css',
  'foundation-v6.9.0.css',
  'freebies-v0.0.0.css',
  'furatto-v3.1.1.css',
  'gallery-v1.0.2.css',
  'github-dark-v6.3.0.css',
  'gitweb-theme-v0.0.0.css',
  'google-type-v0.0.0.css',
  'gridlex-v2.7.1.css',
  'gumby-v2.6.4.css',
  'halfmoon-v2.0.2.css',
  'holmes-v6.8.12.css',
  'hover-buttons-v0.15.0.css',
  'hugo-universal-theme-v1.4.1.css',
  'jupyter-themes-v0.20.0.css',
  'littlebox-v0.0.4.css',
  'lynx-v1.4.0.css',
  'material-for-bootstrap-v4.1.1.css',
  'mini-v3.0.1.css',
  'missing-v1.3.0.css',
  'obsidian-colored-sidebar-v2.0.0.css',
  'obsidian-modular-css-layout-v0.10.0.css',
  'obsidian-notebook-themes-v2.2.3.css',
  'orbit-v1.4.11.css',
  'patternfly-v6.5.2.css',
  'phonon-v1.5.1.css',
  'picnic-v7.1.0.css',
  'pico-v2.1.1.css',
  'preboot-v2.0.0.css',
  'pretty-checkbox-v3.0.3.css',
  'proxmorph-v2.7.3.css',
  'pure-v3.0.0.css',
  'responsive-4-v4.1.4.css',
  'responsive-5-v5.0.0.css',
  'rippleui-v1.12.1.css',
  'semantic-v2.5.0.css',
  'shards-v3.0.0.css',
  'shina-fox-v0.1.0.css',
  'slitslider-v1.1.0.css',
  'social-signin-buttons-v0.0.0.css',
  'spicetify-bloom-v0.0.0.css',
  'spicetify-dribbblish-v0.0.0.css',
  'spicetify-text-v0.0.0.css',
  'stackicons-v1.13.0.css',
  'stackoverflow-dark-v5.1.2.css',
  'stacks-v2.8.6.css',
  'swagger-ui-themes-2-v2.1.0.css',
  'swagger-ui-themes-3-v3.0.1.css',
  'tailwind-cards-v0.0.0.css',
  'tailwind-v2.2.19.css',
  'tocas-v5.7.0.css',
  'tootik-v1.0.2.css',
  'tw-animate-css-v1.4.0.css',
  'uikit-v3.25.17.css',
  'unfold-v0.0.0.css',
  'universal-v0.0.0.css',
  'uswds-v3.13.0.css',
  'vitepress-v1.6.4.css',
  'water-v2.1.1.css',
  'webgradients-v0.0.0.css',
  'wikipedia-dark-v3.7.9.css'
];

const foundBad = [];

/**
 * Runs the idempotency test.
 */
function run () {
  const includeFileName = true;
  let libraries = getRealWorldCSS(includeFileName);

  for (const library of libraries) {
    const fileName = library.fileName;
    if (!knownBad.includes(fileName)) {
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
        foundBad.push(fileName)
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

  if (!foundBad.length) {
    console.log('Idempotency passed');
  } else if (foundBad.length === 1) {
    console.log('1 file failed idempotency');
  } else {
    console.log(foundBad.length + ' files failed idempotency');
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
