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
//   node build.mjs --minify        production bytes (always on with --pure)
//
// DEPLOY SAFETY: this script writes ONLY into hypercomb-shim/dist. It never
// touches hypercomb-web, so it cannot alter the artifact the live workflow
// uploads (src/hypercomb-web/dist/hypercomb-web/browser).

import { build } from 'esbuild'
import { compile } from 'sass'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(process.env.HYPERCOMB_HOST_OUT_DIR || resolve(here, 'dist'))
const staticRoot = resolve(here, 'public')
const essentialsDist = resolve(here, '..', 'hypercomb-essentials', 'dist')
const sharedPublic = resolve(here, '..', 'shared-public')

const pure = process.argv.includes('--pure')
const withContent = !pure && !process.argv.includes('--no-content')
const withAssets = !pure && process.argv.includes('--assets')
// The pure build is the release, so it is always minified: leaving Angular's
// builder must not cost the compression it gave.
const minify = pure || process.argv.includes('--minify')

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
if (!pure && !(await exists(resolve(staticRoot, 'vendor', 'pixi.runtime.js')))) {
  throw new Error('[shim] public/vendor is missing — run `npm run build:vendor` first')
}
await cp(staticRoot, dist, { recursive: true })
// ONE CORE. The pure main.js resolves `@hypercomb/core` through the import
// map, the same runtime file the bootstrap and every adopted bee load, instead
// of carrying its own copy. Core's modules register into `window.ioc` as they
// evaluate, and as an import of main.js core now evaluates BEFORE main.js's
// body, so the ioc install runs first: inlined as a classic script that the
// parser executes before any module script. It is not a new file, so no host's
// route list changes.
let indexHtml = await readFile(resolve(here, 'index.html'), 'utf8')
// HOST FACES ONLY. The host panel renders Inter and upright Source Serif 4
// (its headings), plus system monospace. The icon face and the italic serif
// are application assets: a package that renders them carries them as signed
// resources and declares its own @font-face, so the harness ships neither.
if (pure) {
  const fontsDir = resolve(dist, 'fonts')
  const css = await readFile(resolve(fontsDir, 'fonts.css'), 'utf8')
  const [header, ...faces] = css.split('@font-face')
  const kept = faces.filter(face => /font-family:\s*'Inter'/.test(face)
    || (/font-family:\s*'Source Serif 4'/.test(face) && /font-style:\s*normal/.test(face)))
  if (kept.length === 0) throw new Error('[shim] fonts.css has no host face')
  const keptCss = header + kept.map(face => '@font-face' + face).join('')
  const keptFiles = new Set([...keptCss.matchAll(/url\(\.\/([^?)]+)/g)].map(m => m[1]))
  for (const name of await readdir(fontsDir)) {
    if (name !== 'fonts.css' && !keptFiles.has(name)) await rm(resolve(fontsDir, name), { force: true })
  }
  await writeFile(resolve(fontsDir, 'fonts.css'), keptCss, 'utf8')
  const version = createHash('sha256').update(keptCss).digest('hex').slice(0, 10)
  const link = /fonts\/fonts\.css\?v=[0-9a-f]+/
  if (!link.test(indexHtml)) throw new Error('[shim] index.html does not link fonts/fonts.css?v=')
  indexHtml = indexHtml.replace(link, `fonts/fonts.css?v=${version}`)
}
if (pure) {
  const ioc = await build({
    entryPoints: [resolve(here, '..', 'hypercomb-runtime', 'src', 'ioc.web.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    write: false,
    logLevel: 'warning',
  })
  const code = ioc.outputFiles[0].text.trim()
  if (code.includes('</script')) throw new Error('[shim] inlined ioc would close its own script tag')
  const marker = '<!-- hc:ioc -->'
  if (!indexHtml.includes(marker)) throw new Error('[shim] index.html has no ' + marker + ' marker')
  indexHtml = indexHtml.replace(marker, `<script>${code}</script>`)
  // THE KERNEL DECLARES THE IMPORT MAP once it holds the core library, so
  // the page's own replay (for the full shells) is dropped: browsers without
  // late-map merging accept only one map.
  const replay = /\n    <!-- Import map pre-apply\.[\s\S]*?<\/script>\n/
  if (!replay.test(indexHtml)) throw new Error('[shim] index.html has no import map replay to hand to the kernel')
  indexHtml = indexHtml.replace(replay, '\n')
  // main.js is the kernel: a classic script, so it runs before any module
  // loads and what it starts can still declare the import map.
  const moduleTag = '<script type="module" src="./main.js"></script>'
  if (!indexHtml.includes(moduleTag)) throw new Error('[shim] index.html does not load ./main.js as expected')
  indexHtml = indexHtml.replace(moduleTag, '<script src="./main.js"></script>')
}
await writeFile(resolve(dist, 'index.html'), indexHtml, 'utf8')
// The cold front door reads the same theme values as the full shells. Compile
// only their shared token sheet; Sass is a build tool and ships no runtime code.
const themeCss = compile(resolve(here, '..', 'hypercomb-shared', 'styles', '_material-tokens.scss'), {
  style: 'compressed',
}).css
await writeFile(resolve(dist, 'theme.css'), themeCss, 'utf8')
let coreLibrary = null
if (pure) {
  // A cold harness has no renderer. A package that needs Pixi may provide it;
  // the installable seed must not carry one particular rendering library.
  await rm(resolve(dist, 'vendor'), { recursive: true, force: true })
  await rm(resolve(dist, 'pixi.js'), { force: true })
  // CORE IS TWO PARTS. The processor (act, the bee lifecycle, IoC, effects,
  // signing) is the core a host cannot run without: the install ships it as
  // /hypercomb-core.runtime.js. The library (everything else core exports) is
  // content: written under its own signature, which the kernel knows and
  // resolves like the host bundle. It imports the processor through
  // `@hypercomb/core/processor`, so there is one IoC and one bee lifecycle.
  await rm(resolve(dist, 'core'), { recursive: true, force: true })
  const coreSrc = resolve(here, '..', 'hypercomb-core', 'src')
  const processor = await build({
    entryPoints: [resolve(coreSrc, 'processor.ts')],
    outfile: resolve(dist, 'hypercomb-core.runtime.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    metafile: true,
    logLevel: 'warning',
  })
  const processorFiles = new Set(Object.keys(processor.metafile.inputs).map(p => resolve(p)))
  const library = await build({
    entryPoints: [resolve(coreSrc, 'library.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    write: false,
    metafile: true,
    outfile: 'library.js',
    logLevel: 'warning',
    plugins: [{
      name: 'processor-external',
      setup(b) {
        b.onResolve({ filter: /^\./ }, args => {
          const ts = resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts'))
          return processorFiles.has(ts) ? { path: '@hypercomb/core/processor', external: true } : undefined
        })
      },
    }],
  })
  const libraryInputs = Object.keys(library.metafile.inputs).map(p => resolve(p))
  if (libraryInputs.some(p => processorFiles.has(p))) {
    throw new Error('[shim] the core library carries its own copy of the processor')
  }
  coreLibrary = Buffer.from(library.outputFiles[0].contents)
}

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

  // Azure Static Web Apps serves a directory's index.html with an HTML MIME
  // type. Keep the ordinary index for Pages and local hosts, and emit the same
  // pool listing as .txt for the Azure route in staticwebapp.config.json.
  const packagesPool = createHash('sha256').update('host:packages', 'utf8').digest('hex')
  const poolIndex = resolve(outContent, packagesPool, 'index.html')
  if (await exists(poolIndex)) {
    await cp(poolIndex, resolve(outContent, packagesPool, 'listing.txt'))
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
  if (!pure) {
    for (const entry of await readdir(localeDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const locale = entry.name.slice(0, -'.json'.length)
      const bytes = await readFile(resolve(localeDir, entry.name))
      const sig = createHash('sha256').update(bytes).digest('hex')
      await writeFile(resolve(dist, sig), bytes)
      localeIndex[locale] = sig
      localeBytes += bytes.length
    }
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
// then is the true answer in the full monorepo build. Pure installs omit this
// migration-only count entirely.
//
// REPORTING is not ENFORCEMENT: this printed 47, then 48, then 52 across three
// sessions and nothing stopped it, because a number in build output is only
// read by whoever is looking. The same lines are now a frozen allowlist in
// `doctrine.spec.ts` ("the shell-surface barrel may only shrink"), so growth
// fails the suite. This line stays as the human-facing half — it says how far
// there is to go; the ratchet says which direction you are allowed to move.
const barrelPath = resolve(here, '..', 'hypercomb-shared', 'ui', 'shell-surfaces', 'shell-surfaces.barrel.ts')
let barrelEntries = pure ? -1 : 0
if (!pure) {
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
// THE KERNEL BUILD (--pure) has no second pin: the host console is a
// beehavior of the host package (below).
if (!pure) {
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
}

// ── the host package ─────────────────────────────────────────────────────────
// The kernel build's host console is a BEEHAVIOR: the one bee of the host
// package, carried by its `host` tile. Three signed files: the bee, the tile
// layer that carries it, and the root layer that names the tile and the bee
// as a boot bee. The host bundle knows only the root (baked in below) and
// resolves the rest the hypercomb way (src/host-package.ts).
let hostPackageRoot = ''
if (pure) {
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  const consoleBee = await build({
    entryPoints: [resolve(here, 'src/bootstrap/host-console.drone.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    tsconfig: resolve(here, 'tsconfig.json'),
    minify: true,
    write: false,
    metafile: true,
    outfile: 'host-console.js',
    logLevel: 'warning',
    external: ['@hypercomb/core'],
  })
  // One installer, one Store, one host directory: a bee that carried its own
  // copy of any would run a second one beside the host's.
  const stateful = Object.keys(consoleBee.metafile.inputs)
    .filter(p => /hypercomb-runtime[\/]src[\/](acquire|store|script-preloader|dependency-loader|host-packages)\.ts$/.test(p))
  if (stateful.length) throw new Error('[shim] the host console bee carries a stateful runtime module: ' + stateful.join(', '))
  const beeBytes = Buffer.from(consoleBee.outputFiles[0].contents)
  const beeSig = sha(beeBytes)
  const tile = Buffer.from(JSON.stringify({ name: 'host', cells: [], bees: [beeSig], dependencies: [] }))
  const tileSig = sha(tile)
  const root = Buffer.from(JSON.stringify({ name: 'root', cells: [tileSig], bees: [], dependencies: [], bootBees: [beeSig] }))
  hostPackageRoot = sha(root)
  for (const [sig, bytes] of [[beeSig, beeBytes], [tileSig, tile], [hostPackageRoot, root]]) {
    await writeFile(resolve(dist, sig), bytes)
  }
  console.log(`[shim] host package ${hostPackageRoot.slice(0, 12)}… · host tile · console bee ${(beeBytes.length / 1024).toFixed(0)} kB`)
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

// In the kernel build this is the HOST BUNDLE: written under its signature,
// never served as main.js. main.js is then the kernel (below).
const mainFile = pure ? 'host.tmp.js' : 'main.js'
const result = await build({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(dist, mainFile),
  plugins: [stubLocales],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  // tsconfig paths (@hypercomb/*) resolve through here.
  tsconfig: resolve(here, 'tsconfig.json'),
  sourcemap: !pure,
  minify,
  logLevel: 'info',
  metafile: true,
  define: {
    __HC_BARREL_ENTRIES__: String(barrelEntries), __HC_PURE__: String(pure), __HC_KERNEL__: String(pure),
    ...(pure ? { __HC_HOST_PACKAGE__: JSON.stringify(hostPackageRoot) } : {}),
  },
  // Bees and their dependencies are fetched at runtime by signature, never
  // bundled. Anything that resolves to an /opfs or bare module specifier is
  // the runtime graph's problem, not the shim's.
  external: ['/opfs/*', ...(pure ? ['@hypercomb/core'] : [])],
})

// The scoreboard that matters: if @angular shows up in the shim's own bundle,
// the shim is not framework-free and the build should say so loudly.
const mainOut = Object.keys(result.metafile.outputs).find(k => k.endsWith(mainFile))
const inputs = Object.keys(result.metafile.outputs[mainOut].inputs)
const angular = inputs.filter(p => p.includes('node_modules/@angular'))
const web = inputs.filter(p => p.includes('hypercomb-web'))
const bytes = (await stat(resolve(dist, mainFile))).size

console.log(`\n[shim] ${pure ? 'host bundle' : 'main.js'} ${(bytes / 1024).toFixed(0)} kB · ${inputs.length} modules`)
if (angular.length) {
  console.log(`[shim] ⚠ ${angular.length} @angular module(s) reached the shim bundle:`)
  for (const a of angular.slice(0, 10)) console.log(`         ${a}`)
} else {
  console.log('[shim] ✓ framework-free — no @angular in the bundle')
}
if (pure && angular.length) throw new Error('[shim] pure install includes Angular')
if (pure && inputs.some(p => /bootstrap[\/]host-panel\.ts$/.test(p))) {
  throw new Error('[shim] the host bundle carries the host console — it is the host package\'s beehavior')
}
if (pure && inputs.some(p => p.includes('hypercomb-core/src/'))) {
  throw new Error('[shim] pure main.js carries its own copy of core — it must load the runtime through the import map')
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
if (pure && (shared.length || web.length)) {
  throw new Error('[shim] pure install reached application source')
}

// ── the kernel ───────────────────────────────────────────────────────────────
// The host bundle is content: written under its own signature (and named by
// /pin for tools that look). main.js is the KERNEL — a classic script that
// knows that one signature, baked in here so no signature lives in source,
// finds the bytes (this device, this origin, the default hosts), verifies and
// runs them.
if (pure) {
  const hostBytes = await readFile(resolve(dist, mainFile))
  const hostSig = createHash('sha256').update(hostBytes).digest('hex')
  await writeFile(resolve(dist, hostSig), hostBytes)
  await writeFile(resolve(dist, 'pin'), hostSig + '\n', 'utf8')
  await rm(resolve(dist, mainFile), { force: true })
  const librarySig = createHash('sha256').update(coreLibrary).digest('hex')
  await writeFile(resolve(dist, librarySig), coreLibrary)
  await build({
    entryPoints: [resolve(here, 'src/kernel.ts')],
    outfile: resolve(dist, 'main.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    logLevel: 'warning',
    define: { __HC_HOST_SIG__: JSON.stringify(hostSig), __HC_LIBRARY_SIG__: JSON.stringify(librarySig) },
  })
  const kernelBytes = (await stat(resolve(dist, 'main.js'))).size
  const processorBytes = (await stat(resolve(dist, 'hypercomb-core.runtime.js'))).size
  console.log(`[shim] kernel main.js ${(kernelBytes / 1024).toFixed(1)} kB · processor ${(processorBytes / 1024).toFixed(1)} kB`)
  console.log(`[shim]   resolves host ${hostSig.slice(0, 12)}… (${(hostBytes.length / 1024).toFixed(0)} kB) · core library ${librarySig.slice(0, 12)}… (${(coreLibrary.length / 1024).toFixed(0)} kB)`)
}
console.log(
  `[shim] origin ${mib(await dirBytes(dist))} total` +
  (withContent ? ` · content ${contentFiles} entries, ${mib(contentBytes)}` : ' · no content (cold host)'),
)
if (!pure) {
  console.log(
    `[shim] scoreboard — ${barrelEntries} barrel entries still Angular-shaped and unreachable from the shim` +
    (barrelEntries === 0 ? ' (the barrel is empty — Phase 3 is done)' : ''),
  )
}
