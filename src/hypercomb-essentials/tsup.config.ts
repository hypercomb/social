import { defineConfig } from 'tsup'

// outDir is `dist-lib`, NOT `dist` — the two must never share a directory.
// `dist/` belongs to scripts/build-module.ts, which emits the signature-
// addressed module package (bare-sig files + manifest.json + .cache/).
// The two builds are mutually destructive when pointed at one directory:
//   - tsup's `clean: true` wipes build-module's manifest.json, .cache/ and
//     every sig file, so the package advertises content that no longer
//     exists on disk;
//   - build-module's Phase 2 clean deletes everything in DIST_ROOT except
//     .cache/ and manifest.json, taking tsup's index.js/.cjs/.d.ts with it.
// Symptom when they collide: a standalone `tsup` run (a running dev server's
// prebuild does exactly this) strips dist, the root layer's bytes are lost,
// and DCP renders "No content found" against a manifest it can still fetch.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  outDir: 'dist-lib',
  external: ['@hypercomb/core', 'nostr-tools', 'pixi.js'],
})
