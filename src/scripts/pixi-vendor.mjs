// scripts/pixi-vendor.mjs
//
// THE PIXI RUNTIME RECIPE — one definition for every place Pixi is built as a
// standalone module that bees import as `pixi.js`:
//   - a shell's own runtime, /vendor/pixi.runtime.js
//     (hypercomb-web/scripts/build-pixi-vendor.ts,
//     hypercomb-shim/scripts/build-vendor.mjs), and
//   - the copy a package carries as its own dependency atom
//     (hypercomb-essentials/scripts/build-module.ts), so a host that ships no
//     renderer still runs the package.
// Both must behave identically, so both come from here.

import { build } from 'esbuild'

const ENTRY = "import 'pixi.js/unsafe-eval'\nexport * from 'pixi.js'\n"

// pixi's isWebGLSupported probe asks only for a WebGL **1** context, but its
// GlContextSystem prefers WebGL **2** (preferWebGLVersion: 2). A browser that
// drops/breaks WebGL1 while keeping WebGL2 (observed on macOS after a browser
// update) is misclassified as "no WebGL" and autoDetectRenderer falls back to
// the canvas renderer — which has no mesh pipe, so the tile scene crashes
// every frame. Until pixi fixes the probe upstream, accept a WebGL2 context as
// proof of support. The replace is exact-match and counted: a pixi upgrade
// that changes the probe shape fails the build instead of silently shipping
// the unpatched (or doubly-patched) bundle.
const PROBE_V1 = 'let gl = canvas.getContext("webgl", contextOptions);'
const PROBE_V2 = 'let gl = canvas.getContext("webgl", contextOptions) || canvas.getContext("webgl2", contextOptions);'

// pixi ships CDN URLs for the KTX/Basis transcoders and would fetch them from
// jsdelivr the first time a compressed texture is loaded — a third-party
// request from inside our own bundle (documentation/no-third-party-requests.md).
// Nothing loads such a texture today, so this is latent rather than live;
// rewriting the URLs local means that if one ever IS loaded it fails visibly
// instead of quietly reaching out. Counted, so a pixi change fails loudly
// rather than silently restoring the CDN.
const CDN = 'https://cdn.jsdelivr.net/npm/pixi.js/transcoders/'
const LOCAL = '/vendor/transcoders/'

/** Build the patched Pixi runtime. `resolveDir` must reach a node_modules
 *  holding pixi.js. Returns the module text; the caller decides where it goes.
 *  @param {string} resolveDir
 *  @returns {Promise<string>} */
export const buildPixiRuntime = async (resolveDir) => {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir, sourcefile: 'pixi-vendor-entry.js', loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    splitting: false,
    treeShaking: false,
    mainFields: ['module', 'browser', 'main'],
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: false,
    sourcemap: false,
    write: false,
    logLevel: 'warning',
  })
  const bundled = result.outputFiles[0].text
  const occurrences = bundled.split(PROBE_V1).length - 1
  if (occurrences !== 1) {
    throw new Error(`[pixi-vendor] expected exactly 1 isWebGLSupported probe to patch, found ${occurrences} — pixi changed; re-check whether the WebGL2 probe patch is still needed`)
  }
  const probePatched = bundled.replace(PROBE_V1, PROBE_V2)
  const cdnHits = probePatched.split(CDN).length - 1
  if (cdnHits !== 4) {
    throw new Error(`[pixi-vendor] expected exactly 4 CDN transcoder URLs to localise, found ${cdnHits} — pixi changed; re-check the transcoder wiring`)
  }
  return probePatched.replaceAll(CDN, LOCAL)
}
