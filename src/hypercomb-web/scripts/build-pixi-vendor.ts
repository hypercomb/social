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
    // `pixi.js/unsafe-eval` swaps the new-Function uniform-sync for a static
    // parser, so the renderer constructs under a CSP with no 'unsafe-eval' —
    // the published visitor hosts (worker.js serveVisitorAsset) serve exactly
    // that CSP, and without this import PixiHostWorker dies at Application.init.
    stdin: {
      contents: "import 'pixi.js/unsafe-eval'\nexport * from 'pixi.js'\n",
      resolveDir: process.cwd(),
      sourcefile: 'pixi-vendor-entry.js',
      loader: 'js',
    },
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
  // pixi ships CDN URLs for the KTX/Basis transcoders and would fetch them
  // from jsdelivr the first time a compressed texture is loaded — a
  // third-party request from inside our own bundle (see
  // documentation/no-third-party-requests.md). Nothing loads such a texture
  // today, so this is latent rather than live; rewriting the URLs local means
  // that if one ever IS loaded it fails visibly here instead of quietly
  // reaching out. Counted, so a pixi change fails loudly rather than silently
  // restoring the CDN.
  const CDN = 'https://cdn.jsdelivr.net/npm/pixi.js/transcoders/'
  const LOCAL = '/vendor/transcoders/'
  const probePatched = bundled.replace(PROBE_V1, PROBE_V2)
  const cdnHits = probePatched.split(CDN).length - 1
  if (cdnHits !== 4) {
    throw new Error(`[pixi-vendor] expected exactly 4 CDN transcoder URLs to localise, found ${cdnHits} — pixi changed; re-check the transcoder wiring`)
  }
  writeFileSync(OUT_FILE, probePatched.replaceAll(CDN, LOCAL))
  console.log('[pixi-vendor] ✔ patched isWebGLSupported to accept WebGL2-only browsers')
  console.log('[pixi-vendor] ✔ localised 4 CDN transcoder URLs')

  console.log('[pixi-vendor] ✔ pixi.runtime.js built successfully')
})().catch(err => {
  console.error('[pixi-vendor] build failed')
  console.error(err)
  process.exit(1)
})
