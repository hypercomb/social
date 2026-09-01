// hypercomb-shim/build.mjs
//
// No Angular, no Vite, no ng builder — one esbuild call. This is the point of
// the shim: if the boot needs a framework to build, it is not a shim.
//
// STANDALONE. This build reads nothing from hypercomb-web. The static root is
// hypercomb-shim/public (checked in, plus the two generated pieces from
// scripts/build-vendor.mjs); the content heap comes from the module build that
// PRODUCES it, hypercomb-essentials/dist, not from a shell's copy of it.
//
// The output in dist/ is a complete origin: serve it and it is a host.
//
//   node build.mjs                 minimal — core + fetcher + runner + content
//   node build.mjs --no-content    cold host; boots to 0 surfaces, correct
//   node build.mjs --assets        + shared-public (substrate art, ~47 MB)
//   node build.mjs --minify        production bytes
//
// DEPLOY SAFETY: this script writes ONLY into hypercomb-shim/dist. It never
// touches hypercomb-web, so it cannot alter the artifact the live workflow
// uploads (src/hypercomb-web/dist/hypercomb-web/browser).

import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, 'dist')
const staticRoot = resolve(here, 'public')
const essentialsDist = resolve(here, '..', 'hypercomb-essentials', 'dist')
const sharedPublic = resolve(here, '..', 'shared-public')

const withContent = !process.argv.includes('--no-content')
const withAssets = process.argv.includes('--assets')
const minify = process.argv.includes('--minify')

const SIG_NAME = /^[0-9a-f]{64}$/i
// A real newline, held in a template literal — this file generates JSON and
// text, and an escape sequence here has been mangled by a shell heredoc once
// already.
const NEWLINE = `
`
const exists = async (p) => { try { await stat(p); return true } catch { return false } }
const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`

const dirBytes = async (path) => {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name)
    total += entry.isDirectory() ? await dirBytes(child) : (await stat(child)).size
  }
  return total
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

// ── the static root ──────────────────────────────────────────────────────────
// index.html, the service worker (the signature resolver — the FETCHER), the
// two module-map stubs, host config, icons, and the generated core/ + vendor/.
if (!(await exists(resolve(staticRoot, 'vendor', 'pixi.runtime.js')))) {
  throw new Error('[shim] public/vendor is missing — run `npm run build:vendor` first')
}
await cp(staticRoot, dist, { recursive: true })
await cp(resolve(here, 'index.html'), resolve(dist, 'index.html'))

// ── the content heap ─────────────────────────────────────────────────────────
// Flat and sig-named: `<origin>/content/<sig>`. Straight from the module build
// that mints it. A cold host may ship without it — acquisition by signature is
// the shim's next phase, and then this copy becomes a warm cache, not a
// prerequisite.
let contentFiles = 0
let contentBytes = 0
if (withContent) {
  if (!(await exists(essentialsDist))) {
    throw new Error(`[shim] hypercomb-essentials/dist is missing — run \`npm run build:essentials\` first, or pass --no-content (${essentialsDist})`)
  }
  const outContent = resolve(dist, 'content')
  await mkdir(outContent, { recursive: true })
  for (const entry of await readdir(essentialsDist, { withFileTypes: true })) {
    const isContent = SIG_NAME.test(entry.name) || entry.name === 'manifest.json'
    if (!isContent) continue
    const from = resolve(essentialsDist, entry.name)
    await cp(from, resolve(outContent, entry.name), { recursive: entry.isDirectory() })
    contentFiles++
  }
  contentBytes = await dirBytes(outContent)
}

// ── optional shared assets ───────────────────────────────────────────────────
// Substrate art. Not a boot requirement: without it backgrounds 404 and the
// hive still runs, which is why the minimal host leaves it out.
if (withAssets && await exists(sharedPublic)) {
  await cp(sharedPublic, dist, { recursive: true })
}

// ── locales as content ───────────────────────────────────────────────────────
// A locale is CONTENT, not a bundled asset and not an installer resource. Each
// catalog is written to the origin under its own signature; `locales.json`
// names them. src/locales.ts resolves one on demand — pool, then flat root,
// then origin — verifying at every step.
//
// This is what takes the shim entry from 3,253 kB to ~180 kB: fourteen
// catalogs are 2.9 MB, and bundling them shipped every language to every
// visitor to serve the one they read.
const localeDir = resolve(here, '..', 'hypercomb-shared', 'i18n')
const localeIndex = {}
let localeBytes = 0
try {
  for (const entry of await readdir(localeDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const locale = entry.name.slice(0, -'.json'.length)
    const bytes = await readFile(resolve(localeDir, entry.name))
    const sig = createHash('sha256').update(bytes).digest('hex')
    await writeFile(resolve(dist, sig), bytes)
    localeIndex[locale] = sig
    localeBytes += bytes.length
  }
} catch {
  console.warn('[shim] no locale catalogs found — the host will publish none')
}
await writeFile(resolve(dist, 'locales.json'), JSON.stringify(localeIndex, null, 2) + NEWLINE, 'utf8')
console.log(
  `[shim] locales ${Object.keys(localeIndex).length} published as content ` +
  `(${mib(localeBytes)}, resolved by signature — none bundled)`,
)

// ── the migration scoreboard's other half ────────────────────────────────────
// The shim can COUNT what it mounts but not what it cannot see. The Angular
// panels register themselves by being listed in shared's shell-surfaces
// barrel, and the shim never imports that barrel — so at runtime it observes
// zero Angular-shaped registrations and would report "0 still Angular-shaped",
// which reads as "migration complete" when it means "none reached me".
//
// The barrel is the plan doc's scoreboard (42 entries → 0), so read it HERE,
// at build time, and hand the number in. It tracks the barrel as it shrinks
// and can never quietly disagree with it. A missing barrel counts 0 — which by
// then is the true answer.
//
// REPORTING is not ENFORCEMENT: this printed 47, then 48, then 52 across three
// sessions and nothing stopped it, because a number in build output is only
// read by whoever is looking. The same lines are now a frozen allowlist in
// `doctrine.spec.ts` ("the shell-surface barrel may only shrink"), so growth
// fails the suite. This line stays as the human-facing half — it says how far
// there is to go; the ratchet says which direction you are allowed to move.
const barrelPath = resolve(here, '..', 'hypercomb-shared', 'ui', 'shell-surfaces', 'shell-surfaces.barrel.ts')
let barrelEntries = 0
try {
  const barrel = await readFile(barrelPath, 'utf8')
  // A template literal holding a real newline, and startsWith rather than a
  // regex. A CRLF checkout leaves a trailing carriage return, which
  // startsWith does not mind.
  const NEWLINE = `
`
  barrelEntries = barrel.split(NEWLINE).filter(line => line.startsWith('import ')).length
} catch {
  console.warn('[shim] shell-surfaces barrel not found — reporting 0 unreachable surfaces')
}

// ── the bootstrap bundle ─────────────────────────────────────────────────────
// Acquisition, built as CONTENT rather than as part of the shell: one ESM
// module, hashed, written to the origin under its own signature, and named by
// `/pin`. The shim fetches it by that signature and verifies the bytes before
// running them, so the installer is forkable, auditable and repinnable exactly
// like a bee — which is the point of Phase 4.
//
// `@hypercomb/core` stays EXTERNAL. Bundling it would mint a second copy of
// the runtime the shim already loaded; the import map resolves the bare
// specifier to the one true runtime instead.
const bootstrapBuild = await build({
  entryPoints: [resolve(here, 'src/bootstrap/index.ts')],
  outfile: resolve(dist, 'bootstrap.tmp.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  tsconfig: resolve(here, 'tsconfig.json'),
  sourcemap: false,
  minify,
  logLevel: 'warning',
  metafile: true,
  external: ['@hypercomb/core'],
})

{
  const tmp = resolve(dist, 'bootstrap.tmp.js')
  const bytes = await readFile(tmp)
  const sig = createHash('sha256').update(bytes).digest('hex')
  await writeFile(resolve(dist, sig), bytes)
  // The pin. THE one location-addressed read in the whole chain — a pin has to
  // be mutable or it could never be repointed, which is exactly what it is
  // for. Everything it names is content-addressed and verified.
  await writeFile(resolve(dist, 'pin'), sig + '\n', 'utf8')
  await rm(tmp, { force: true })

  const bootstrapInputs = Object.keys(
    bootstrapBuild.metafile.outputs[Object.keys(bootstrapBuild.metafile.outputs).find(k => k.endsWith('bootstrap.tmp.js'))].inputs,
  )
  const leaked = bootstrapInputs.filter(p => /shared[\/]core[\/]store\.ts$/.test(p))
  if (leaked.length) {
    // A second Store module means a second `register('@hypercomb.social/Store',
    // new Store())` over the same OPFS — two instances, one heap. Fail the
    // build rather than ship it.
    throw new Error('[shim] the bootstrap bundle pulled in shared Store — reach it structurally through IoC instead: ' + leaked.join(', '))
  }
  console.log(
    `[shim] bootstrap ${sig.slice(0, 12)}… · ${(bytes.length / 1024).toFixed(0)} kB · ` +
    `${bootstrapInputs.length} modules · pinned at /pin`,
  )
}

// ── the runner ───────────────────────────────────────────────────────────────
// The shipped catalogs are unreachable at RUNTIME in the shim — main.ts always
// passes `catalogs: signatureCatalogs`, so runtime-initializer's static loader
// map is dead code here. esbuild cannot know that (a dynamic import() it can
// see, it inlines), so tell it: resolve every `i18n/*.json` to an empty object.
// The ratchet below fails the build if one ever reaches the bundle anyway.
const LOCALE_JSON = /i18n[\\/][a-z-]+\.json$/
const stubLocales = {
  name: 'stub-locales',
  setup(builder) {
    builder.onResolve({ filter: LOCALE_JSON }, () => ({ path: 'hc-locale-stub', namespace: 'hc-stub' }))
    builder.onLoad({ filter: /.*/, namespace: 'hc-stub' }, () => ({ contents: 'export default {}', loader: 'js' }))
  },
}

const result = await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(dist, 'main.js'),
  plugins: [stubLocales],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  // tsconfig paths (@hypercomb/*) resolve through here.
  tsconfig: resolve(here, 'tsconfig.json'),
  sourcemap: true,
  minify,
  logLevel: 'info',
  metafile: true,
  define: { __HC_BARREL_ENTRIES__: String(barrelEntries) },
  // Bees and their dependencies are fetched at runtime by signature, never
  // bundled. Anything that resolves to an /opfs or bare module specifier is
  // the runtime graph's problem, not the shim's.
  external: ['/opfs/*'],
})

// The scoreboard that matters: if @angular shows up in the shim's own bundle,
// the shim is not framework-free and the build should say so loudly.
const mainOut = Object.keys(result.metafile.outputs).find(k => k.endsWith('main.js'))
const inputs = Object.keys(result.metafile.outputs[mainOut].inputs)
const angular = inputs.filter(p => p.includes('node_modules/@angular'))
const web = inputs.filter(p => p.includes('hypercomb-web'))
const bytes = (await stat(resolve(dist, 'main.js'))).size

console.log(`\n[shim] main.js ${(bytes / 1024).toFixed(0)} kB · ${inputs.length} modules`)
if (angular.length) {
  console.log(`[shim] ⚠ ${angular.length} @angular module(s) reached the shim bundle:`)
  for (const a of angular.slice(0, 10)) console.log(`         ${a}`)
} else {
  console.log('[shim] ✓ framework-free — no @angular in the bundle')
}
const localesInBundle = inputs.filter(p => LOCALE_JSON.test(p))
if (localesInBundle.length) {
  // 2.9 MB of catalogs in the entry bundle is the difference between a 180 kB
  // host and a 3.2 MB one, and it regresses SILENTLY — the app works, it is
  // just enormous. Fail loudly instead.
  throw new Error(`[shim] ${localesInBundle.length} locale catalog(s) reached the bundle — locales are CONTENT, resolved by signature: ${localesInBundle.join(', ')}`)
}
// The LAST tie to the monorepo. `@hypercomb/runtime` took everything the host
// needs; what is left is shell-shaped and heading elsewhere (tool-windows is
// becoming a core/panels primitive). Reported every build so the number is
// visible and can only go down — a standalone package is the goal, and a
// silent regrowth here is what would quietly prevent it.
const shared = inputs.filter(p => /hypercomb-shared/.test(p))
console.log(
  shared.length === 0
    ? '[shim] ✓ no hypercomb-shared in the bundle — the host is monorepo-free'
    : `[shim] ${shared.length} hypercomb-shared module(s) left: ${shared.map(p => p.replace(/^.*hypercomb-shared\//, '')).join(', ')}`,
)
if (web.length) {
  console.log(`[shim] ⚠ ${web.length} hypercomb-web module(s) reached the shim bundle:`)
  for (const w of web.slice(0, 10)) console.log(`         ${w}`)
} else {
  console.log('[shim] ✓ standalone — no hypercomb-web in the bundle')
}
console.log(
  `[shim] origin ${mib(await dirBytes(dist))} total` +
  (withContent ? ` · content ${contentFiles} entries, ${mib(contentBytes)}` : ' · no content (cold host)'),
)
console.log(
  `[shim] scoreboard — ${barrelEntries} barrel entries still Angular-shaped and unreachable from the shim` +
  (barrelEntries === 0 ? ' (the barrel is empty — Phase 3 is done)' : ''),
)
