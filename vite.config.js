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
    sourcemap: true
  }
});

export default config;
