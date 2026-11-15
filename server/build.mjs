import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  legalComments: 'none',
  external: ['playwright', 'playwright-core'],
  banner: {
    js: "import { createRequire as __personaqaRequire } from 'node:module'; const require = __personaqaRequire(import.meta.url);",
  },
  logLevel: 'info',
});
