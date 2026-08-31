// hypercomb-shim/scripts/build-vendor.mjs
//
// The two BUILT pieces of the shim's static root, plus the env stub.
// Everything else in public/ is checked in; these three are generated, which
// is why .gitignore holds them. Run once after a core rebuild or a pixi bump:
//
//   node scripts/build-vendor.mjs      (npm run build:vendor)
//
//   public/core/dist/       ← hypercomb-core/dist, verbatim. `@hypercomb/core`
//                             resolves to /hypercomb-core.runtime.js, which
//                             re-exports ./core/dist/index.js.
//   public/vendor/          ← pixi.runtime.js, one import-free ESM file.
//                             `pixi.js` resolves to /vendor/pixi.runtime.js.
//   public/env.js           ← a stub. NEVER a key: an earlier version of the
//                             web script baked ANTHROPIC_API_KEY into the
//                             shipped bundle and leaked it to every visitor.
//
// This is a copy of hypercomb-web/scripts/build-{core,pixi}-vendor, narrowed
// to the shim's own output dir, so the shim builds with no reference to
// hypercomb-web. When web retires, this becomes the only copy.

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shim = resolve(here, '..')
const publicDir = resolve(shim, 'public')

// ── core ─────────────────────────────────────────────────────────────────────
const coreDist = resolve(shim, '..', 'hypercomb-core', 'dist')
const coreOut = resolve(publicDir, 'core', 'dist')
if (!existsSync(coreDist)) {
  throw new Error(`[shim-vendor] hypercomb-core/dist is missing — run \`npm run build:core\` first (${coreDist})`)
}
rmSync(coreOut, { recursive: true, force: true })
mkdirSync(coreOut, { recursive: true })
cpSync(coreDist, coreOut, { recursive: true })
console.log('[shim-vendor] ✔ core → public/core/dist')

// ── pixi ─────────────────────────────────────────────────────────────────────
const vendorOut = resolve(publicDir, 'vendor')
const pixiFile = resolve(vendorOut, 'pixi.runtime.js')
rmSync(vendorOut, { recursive: true, force: true })
mkdirSync(vendorOut, { recursive: true })

await build({
  // `pixi.js/unsafe-eval` swaps the new-Function uniform-sync for a static
  // parser, so the renderer constructs under a CSP with no 'unsafe-eval' —
  // published hosts serve exactly that CSP, and without this import
  // PixiHostWorker dies at Application.init.
  stdin: {
    contents: "import 'pixi.js/unsafe-eval'\nexport * from 'pixi.js'\n",
    resolveDir: shim,
    sourcefile: 'pixi-vendor-entry.js',
    loader: 'js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: pixiFile,
  splitting: false,
  treeShaking: false,
  mainFields: ['module', 'browser', 'main'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
})

// pixi 8.16's isWebGLSupported() probes WebGL **1**, but GlContextSystem
// prefers WebGL **2**. A browser with working WebGL2 and broken WebGL1 is
// misclassified as "no WebGL" and falls back to the canvas renderer, which has
// no mesh pipe — the tile scene then crashes every frame. Exact-match and
// counted: a pixi upgrade that changes the probe fails the build here instead
// of silently shipping an unpatched (or doubly-patched) bundle.
const PROBE_V1 = 'let gl = canvas.getContext("webgl", contextOptions);'
const PROBE_V2 = 'let gl = canvas.getContext("webgl", contextOptions) || canvas.getContext("webgl2", contextOptions);'
const bundled = readFileSync(pixiFile, 'utf8')
const occurrences = bundled.split(PROBE_V1).length - 1
if (occurrences !== 1) {
  throw new Error(`[shim-vendor] expected exactly 1 isWebGLSupported probe to patch, found ${occurrences} — pixi changed; re-check whether the WebGL2 probe patch is still needed`)
}
writeFileSync(pixiFile, bundled.replace(PROBE_V1, PROBE_V2))
console.log('[shim-vendor] ✔ pixi → public/vendor/pixi.runtime.js (WebGL2 probe patched)')

// ── env stub ─────────────────────────────────────────────────────────────────
writeFileSync(
  resolve(publicDir, 'env.js'),
  '// env.js stub — no secrets are embedded in shipped builds\n',
  'utf8',
)
console.log('[shim-vendor] ✔ env.js stub')
