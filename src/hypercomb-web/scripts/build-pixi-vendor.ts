// scripts/build-pixi-vendor.ts
// builds a single-file, import-free ESM pixi vendor runtime

import { build } from 'esbuild'
import { resolve } from 'path'
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

(async () => {
  const OUT_DIR = resolve('public/vendor')
  const OUT_FILE = resolve(OUT_DIR, 'pixi.runtime.js')

  // clean output
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  await build({
    entryPoints: ['pixi.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    outfile: OUT_FILE,

    splitting: false,
    treeShaking: false,

    mainFields: ['module', 'browser', 'main'],

    define: {
      'process.env.NODE_ENV': '"production"'
    },

    minify: false,
    sourcemap: false,

    logLevel: 'info'
  })

  // ── patch: WebGL2-aware support probe ─────────────────────────────
  // pixi 8.16's isWebGLSupported() requests only a WebGL **1** context,
  // but its GlContextSystem prefers WebGL **2** (preferWebGLVersion: 2).
  // A browser that drops/breaks WebGL1 while keeping WebGL2 (observed on
  // macOS after a browser update) is misclassified as "no WebGL" and
  // autoDetectRenderer falls back to the canvas renderer — which has no
  // mesh pipe, so the tile scene crashes every frame. Until pixi fixes
  // the probe upstream, accept a WebGL2 context as proof of support.
  // The replace is exact-match and counted: a pixi upgrade that changes
  // the probe shape fails the build here instead of silently shipping
  // the unpatched (or doubly-patched) bundle.
  const PROBE_V1 = 'let gl = canvas.getContext("webgl", contextOptions);'
  const PROBE_V2 = 'let gl = canvas.getContext("webgl", contextOptions) || canvas.getContext("webgl2", contextOptions);'
  const bundled = readFileSync(OUT_FILE, 'utf8')
  const occurrences = bundled.split(PROBE_V1).length - 1
  if (occurrences !== 1) {
    throw new Error(`[pixi-vendor] expected exactly 1 isWebGLSupported probe to patch, found ${occurrences} — pixi changed; re-check whether the WebGL2 probe patch is still needed`)
  }
  writeFileSync(OUT_FILE, bundled.replace(PROBE_V1, PROBE_V2))
  console.log('[pixi-vendor] ✔ patched isWebGLSupported to accept WebGL2-only browsers')

  console.log('[pixi-vendor] ✔ pixi.runtime.js built successfully')
})().catch(err => {
  console.error('[pixi-vendor] build failed')
  console.error(err)
  process.exit(1)
})
