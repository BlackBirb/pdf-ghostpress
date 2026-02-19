import { builtinModules } from 'node:module';
import { defineConfig } from 'tsup';

export default defineConfig({
  // crypto will screm if bundled
  entry: ['src/**/*.ts'],
  bundle: false,
  clean: true,
  sourcemap: true,
  platform: 'node',
  target: 'node25',
  format: ['esm'],
  env: {
    NODE_ENV: 'production',
  },
  external: [
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`)
    // "fast-fwt"
  ]
});
