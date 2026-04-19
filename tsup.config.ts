import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  clean: true,
  sourcemap: true,
  dts: {
    // tsup injects `baseUrl` for DTS emit; TS 6 reports TS5101 unless silenced here.
    // Keep root `tsconfig.json` free of this so editors on TS 5.x do not error on `"6.0"`.
    compilerOptions: {
      ignoreDeprecations: '6.0',
    },
  },
});
