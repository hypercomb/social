// hypercomb-shim/build.mjs
//
// No Angular, no Vite, no ng builder — one esbuild call. This is the point of
// the shim: if the boot needs a framework to build, it is not a shim.
//
// DEPLOY SAFETY: this script writes ONLY into hypercomb-shim/dist. It never
// touches hypercomb-web/src, hypercomb-web/public, or hypercomb-web/dist, so
// it cannot alter the artifact the live workflow uploads
// (src/hypercomb-web/dist/hypercomb-web/browser).

import { build } from 'esbuild'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, 'dist')
const webPublic = resolve(here, '../hypercomb-web/public')

const exists = async (p) => { try { await stat(p); return true } catch { return false } }

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

// The shim serves the same static root the web shell does: env.js, the
// service worker, the bundled /content/ package ensureInstall falls back to,
// vendor/pixi.runtime.js, substrate art. Copied rather than referenced so the
// shim's dist is a self-contained origin — which is what a deployment IS.
if (await exists(webPublic)) {
  await cp(webPublic, dist, { recursive: true })
} else {
  console.warn('[shim] hypercomb-web/public not found — dist will lack the SW and bundled content')
}

await cp(resolve(here, 'index.html'), resolve(dist, 'index.html'))

const result = await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(dist, 'main.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  // tsconfig paths (@hypercomb/*) resolve through here.
  tsconfig: resolve(here, 'tsconfig.json'),
  sourcemap: true,
  minify: process.argv.includes('--minify'),
  logLevel: 'info',
  metafile: true,
  // Bees and their dependencies are fetched at runtime by signature, never
  // bundled. Anything that resolves to an /opfs or bare module specifier is
  // the runtime graph's problem, not the shim's.
  external: ['/opfs/*'],
})

// The scoreboard that matters: if @angular shows up in the shim's own bundle,
// the shim is not framework-free and the build should say so loudly.
const inputs = Object.keys(result.metafile.outputs[Object.keys(result.metafile.outputs).find(k => k.endsWith('main.js'))].inputs)
const angular = inputs.filter(p => p.includes('node_modules/@angular'))
const bytes = (await stat(resolve(dist, 'main.js'))).size

console.log(`\n[shim] main.js ${(bytes / 1024).toFixed(0)} kB · ${inputs.length} modules`)
if (angular.length) {
  console.log(`[shim] ⚠ ${angular.length} @angular module(s) reached the shim bundle:`)
  for (const a of angular.slice(0, 10)) console.log(`         ${a}`)
} else {
  console.log('[shim] ✓ framework-free — no @angular in the bundle')
}
