// hypercomb-client/scripts/bake-frontend.mjs
//
// Produce the CLIENT frontend from the web build and stamp its service-worker
// content identity into index.html.
//
// Current packages need no baked import map:
//
//   - namespace loaders import `/opfs/<pool-sig>/<content-sig>` directly;
//   - emitted @hypercomb/core and pixi.js edges are rewritten to that same
//     immutable URL shape at module-build time;
//   - both platform runtimes ship as signed leaves in manifest.dependencies.
//
// The source index retains a two-entry localStorage replay only for an old
// installed web package. The native shell adopts its bundled current package
// before dependency execution, so baking that compatibility map would merely
// preserve a dependency the signed graph no longer has.
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

// 2. Stamp the service worker's content hash so registration re-installs on
// every worker change (see ensureSwControl in main.ts).
const { createHash } = await import('node:crypto')
const swHash = createHash('sha256').update(readFileSync(join(out, 'hypercomb.worker.js'))).digest('hex').slice(0, 12)
const indexPath = join(out, 'index.html')
const html = readFileSync(indexPath, 'utf8').replace(
  '<head>',
  `<head><script>window.__hcSwV="${swHash}"</script>`,
)
if (!html.includes('window.__hcSwV')) throw new Error('failed to stamp the service-worker version')
writeFileSync(indexPath, html)

console.log(`baked frontend -> ${out}`)
console.log('  import map: none (signed platform edges)')
