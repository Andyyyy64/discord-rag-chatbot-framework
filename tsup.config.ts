import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  splitting: false,
  sourcemap: process.env.NODE_ENV !== 'production',
  clean: true,
  minify: false,
  dts: false,
  shims: true,
});
