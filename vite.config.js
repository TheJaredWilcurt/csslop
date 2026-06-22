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
