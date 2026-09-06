// hypercomb-client/scripts/bake-frontend.mjs
//
// Produce the CLIENT frontend from the web build: copy the dist, then bake a
// STATIC import map into index.html.
//
// WHY BAKING IS REQUIRED (verified live over CDP, Edge/WebView2 151):
//
//   - The web shell applies its import map from an inline script reading
//     localStorage. In this WebView2, a map injected by script — early OR
//     late — is INERT: `import('pixi.js')` fails with the map sitting right
//     there in the DOM. Only a map that is static HTML, ahead of every
//     modulepreload, resolves.
//   - Tauri's asset server guesses mime by extension, so the extension-less
//     `/content/<sig>` files arrive as text/html — which module loading
//     rejects outright. Baking copies each dependency to `modules/<sig>.js`,
//     making the mime correct by construction. The twin is deliberately NOT
//     written beside the content: `/content/` is the flat namespace where a
//     name IS an address, and `<sig>.js` addresses nothing. (Bees are
//     unaffected: they are imported from blob URLs built out of store bytes.)
//     The twins exist only because mime is guessed from the extension; a
//     scheme handler that served `/content/<sig>` as text/javascript would
//     remove the need for them entirely.
//
// The bundled package is fixed at build time, so its import map is too —
// baking is not a workaround, it is the honest shape of the thing: static
// content, static map.
//
// Run after `npm run build` in hypercomb-web:
//   node hypercomb-client/scripts/bake-frontend.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
//
// WHAT A BUNDLE IS, NOW. The build stopped writing a manifest into the content
// (commit e56b74553 — "the ship stops writing a manifest"). What a host
// publishes is the `host:packages` pool: a directory at the DERIVED address
// sha256('host:packages') holding indexed members (`00000000`, …), each
// naming a package's root layer on its first line. The bake reads the bundle
// the same way a client reads a host — head member → root layer → its
// `dependencies` — so it can never disagree with what the shell installs.
const POOL_ADDRESS = createHash('sha256').update('host:packages', 'utf8').digest('hex')
const MARKER_RE = /^\d{8}$/
const SIG_RE = /^[0-9a-f]{64}$/

/** The head member of the bundled `host:packages` pool, or null when the
 *  content carries no pool (a dev shell with no /content/, or a partial build). */
const bundledHead = (contentDir) => {
  const poolDir = join(contentDir, POOL_ADDRESS)
  if (!existsSync(poolDir)) return null
  const markers = readdirSync(poolDir).filter(name => MARKER_RE.test(name)).sort()
  const head = markers.at(-1)
  if (!head) return null
  return readFileSync(join(poolDir, head), 'utf8').split('\n', 1)[0]?.trim().toLowerCase() ?? null
}

const optional = process.argv.includes('--if-available')
const rootSig = bundledHead(join(dist, 'content'))
if (optional && !rootSig) {
  console.log('bake-frontend: no bundled content in the web dist — skipped')
  process.exit(0)
}

// 1. Fresh copy of the web build.
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(dist, out, { recursive: true })

// 2. Derive the import map — the same rules as resolve-import-map.ts:
//    static runtimes, then one alias per dependency from its first-line
//    `// @scope/name` comment. The dependency list is the root layer's own:
//    layer JSON spells each dependency WITH a `.js` suffix, the content
//    namespace names it by bare signature.
if (!rootSig || !SIG_RE.test(rootSig)) throw new Error('bundled content publishes no package (no host:packages head)')
const rootLayer = JSON.parse(readFileSync(join(out, 'content', rootSig), 'utf8'))
const dependencies = (rootLayer.dependencies ?? []).map(name => String(name).replace(/\.js$/i, ''))

const imports = {
  '@hypercomb/core': '/hypercomb-core.runtime.js',
  'pixi.js': '/vendor/pixi.runtime.js',
}

// Serving twins live here, outside the content namespace — see the copy below.
const modulesDir = join(out, 'modules')

let aliased = 0
for (const sig of dependencies) {
  const source = join(out, 'content', sig)
  let firstLine = ''
  try {
    firstLine = readFileSync(source, 'utf8').split('\n', 1)[0]?.trim() ?? ''
  } catch {
    console.warn(`  missing dependency bytes for ${sig.slice(0, 12)} — skipped`)
    continue
  }
  const alias = firstLine.startsWith('//') ? firstLine.split(/\s+/)[1] : undefined
  if (!alias || imports[alias]) continue

  // Copy as .js so Tauri's extension-based mime guess yields JavaScript —
  // module loading hard-rejects text/html.
  //
  // The twin lands in `modules/`, NOT beside the content. Inside the content
  // namespace every name is an address, and `<sig>.js` is not the address of
  // anything — it is a mime-driven serving artifact. Keeping it there put a
  // non-addressed name in the one namespace whose whole invariant is that the
  // name IS the hash. `modules/` is derived build output: wipe it and the next
  // bake reproduces it exactly.
  mkdirSync(modulesDir, { recursive: true })
  copyFileSync(source, join(modulesDir, `${sig}.js`))
  imports[alias] = `/modules/${sig}.js`
  aliased++
}

// 3. Bake the map as the FIRST element of <head> — static HTML, ahead of
//    every modulepreload, which is the only placement this engine honors.
//    A marker script right after it tells the shell's attachImportMap that
//    the map is live, so its late-append/reload-once fallback stays idle.
const mapJson = JSON.stringify({ imports })

// Stamp the service worker's content hash so registration re-installs on
// every worker change (see ensureSwControl in main.ts).
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
console.log(`  import map: ${Object.keys(imports).length} entries (${aliased} dependency aliases)`)
