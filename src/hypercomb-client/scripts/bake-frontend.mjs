// hypercomb-client/scripts/bake-frontend.mjs
//
// Produce the CLIENT frontend from the web build: copy the dist, then bake the
// two-entry PLATFORM import map into index.html.
//
// WHY BAKING IS REQUIRED (verified live over CDP, Edge/WebView2 151):
//
//   - The web shell applies its import map from an inline script reading
//     localStorage. In this WebView2, a map injected by script — early OR
//     late — is INERT: `import('pixi.js')` fails with the map sitting right
//     there in the DOM. Only a map that is static HTML, ahead of every
//     modulepreload, resolves.
//   - Namespace dependencies no longer resolve through this map. Both eager
//     and bee-lazy loaders import `/opfs/<pool-sig>/<content-sig>`; the service
//     worker supplies JavaScript MIME and asks the native page bridge for bytes
//     when its own OPFS is empty. No `/modules/<sig>.js` serving twins remain.
//
// The bundled package is fixed at build time, so its import map is too —
// baking is not a workaround, it is the honest shape of the thing: static
// content, static map.
//
// Run after `npm run build` in hypercomb-web:
//   node hypercomb-client/scripts/bake-frontend.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = join(here, '../../hypercomb-web/dist/hypercomb-web/browser')
const out = join(here, '../app/frontend')

// Run automatically as hypercomb-web's `postbuild`, so the client frontend
// never lags the web build. In that position a missing/contentless dist means
// "this build was not a full one", not "the bake is broken" — `--if-available`
// makes that a skip. Invoked by hand (or by CI ahead of a bundle) the script
// keeps hard-failing: there, an unbaked frontend is a broken bundle.
const optional = process.argv.includes('--if-available')
if (optional && !existsSync(join(dist, 'content/manifest.json'))) {
  console.log('bake-frontend: no bundled content in the web dist — skipped')
  process.exit(0)
}

// 1. Fresh copy of the web build.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(dist, out, { recursive: true })

// 2. Derive the import map — the same executable remainder as
//    resolve-import-map.ts: only the two platform runtimes.
const manifest = JSON.parse(readFileSync(join(out, 'content/manifest.json'), 'utf8'))
const pkg = Object.values(manifest.packages ?? {})[0]
if (!pkg) throw new Error('bundled manifest has no package')

const imports = {
  '@hypercomb/core': '/hypercomb-core.runtime.js',
  'pixi.js': '/vendor/pixi.runtime.js',
}

// 3. Bake the map as the FIRST element of <head> — static HTML, ahead of
//    every modulepreload, which is the only placement this engine honors.
//    A marker script right after it tells the shell's attachImportMap that
//    the map is live, so its late-append/reload-once fallback stays idle.
const mapJson = JSON.stringify({ imports })

// Stamp the service worker's content hash so registration re-installs on
// every worker change (see ensureSwControl in main.ts).
const { createHash } = await import('node:crypto')
const swHash = createHash('sha256').update(readFileSync(join(out, 'hypercomb.worker.js'))).digest('hex').slice(0, 12)
const indexPath = join(out, 'index.html')
const html = readFileSync(indexPath, 'utf8').replace(
  '<head>',
  `<head><script type="importmap">${mapJson}</script>` +
  `<script>window.__hcImportMapApplied=${JSON.stringify(mapJson)};window.__hcSwV="${swHash}"</script>`,
)
if (!html.includes('"importmap"')) throw new Error('failed to inject the import map')
writeFileSync(indexPath, html)

console.log(`baked frontend -> ${out}`)
console.log(`  import map: ${Object.keys(imports).length} platform entries`)
