/* eslint-disable import-x/no-extraneous-dependencies */

/**
 * @file Vite config.
 */

import { resolve } from 'node:path';

import { defineConfig } from 'vite';

const __dirname = import.meta.dirname;

const config = defineConfig({
  base: '/csslop',
  build: {
    outDir: resolve(__dirname, 'site'),
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              test: /node_modules\/codemirror/,
              name: 'codemirror'
            },
            {
              test: /node_modules\/@codemirror\/lang-css/,
              name: 'codemirror-lang-css'
            },
            {
              test: /node_modules\/@csstools\/css-calc/,
              name: 'css-calc'
            },
            {
              test: /node_modules\/@node-projects\/css-parser/,
              name: 'css-parser'
            },
            {
              test: /node_modules/,
              name: 'lib'
            },
            {
              test: /index\.js/,
              name: 'CSSLOP'
            }
          ]
        }
      }
    }
  }
});

export default config;
