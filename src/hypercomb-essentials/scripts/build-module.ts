// hypercomb-essentials/scripts/build-module.ts
//
// DELIVERY LAYOUT (flat — no typed `__x__` dirs, ever):
//   dist/manifest.json      package entry keyed by rootLayerSig; its
//                           layers[]/bees[]/dependencies[] arrays carry the
//                           KIND of every sig (the flat files don't)
//   dist/<sig>              every layer (JSON bytes), bee (JS bytes) and
//                           namespace dependency (JS bytes) as a bare
//                           sig-named file at the dist root
//   dist/<bagSig>/0000…     the two sigbags (dependencies, bees) — dirs
//                           named by bag sig, discovered ONLY via the
//                           manifest's dependenciesBag/beesBag fields
//   dist/.cache/            build cache — never copied or deployed
// Consumers fetch `<base>/<sig>` flat-first and fall back to the legacy
// `__layers__/<sig>.json` | `__bees__/<sig>.js` | `__dependencies__/<sig>.js`
// URL shapes only for OLD deployed content already in the wild; nothing new
// is ever emitted in that layout.

import { spawnSync } from 'child_process'
import { createHash } from 'node:crypto'
import { builtinModules } from 'node:module'
import { TRANSFER_PACKS_MEANING, encodeTransferPack, gzipBytes } from '../../hypercomb-runtime/src/transfer-pack.js'
import { effectSleeper, passiveQueen, viewSleeper } from './passive-queen.js'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build, type Plugin } from 'esbuild'
import { PACKAGE_FONTS } from '../src/presentation/fonts/package-fonts.js'
import { buildPixiRuntime } from '../../scripts/pixi-vendor.mjs'

// -------------------------------------------------
// esm globals
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const PROJECT_ROOT = resolve(__dirname, '..')
const SRC_ROOT = resolve(PROJECT_ROOT, 'src')
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist')

// -------------------------------------------------
// ensure @hypercomb/core is built
// -------------------------------------------------

const CORE_DIST = resolve(PROJECT_ROOT, '..', 'hypercomb-core', 'dist', 'index.js')
if (!existsSync(CORE_DIST)) {
  console.log('⚙ @hypercomb/core not built — building now…')
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: resolve(PROJECT_ROOT, '..', 'hypercomb-core'),
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) throw new Error('@hypercomb/core build failed')
}

const { SignatureService } = await import('@hypercomb/core')

const TARGET = 'es2022'

// domains to exclude from the build output
const EXCLUDED_DOMAINS: string[] = ['revolucionstyle.com']
const NAMESPACE_SEGMENTS_MAX = 3
const PACKAGE_SPECIFIER = '@hypercomb/essentials'
// `pixi.js` is NOT platform: the package carries the renderer as its own
// vendor atom (below), built by the same recipe as a shell's runtime, so a host
// that ships no renderer still runs it. A shell that maps `pixi.js` itself
// keeps its own: import maps are first-wins, and the shells set theirs first.
const PLATFORM_EXTERNALS = ['@hypercomb/core']

/** VENDOR ATOMS (atomic-modules-plan.md, "find the overlap before creating
 *  redundancy"). An npm specifier that two or more source files import is built
 *  ONCE, as its own dependency named by that specifier (`// nostr-tools/pure`,
 *  a bare specifier the way `pixi.js` is), and every other unit leaves it
 *  external. Inlined, each importer carried its own copy: five atoms carried
 *  nostr-tools and its @noble crypto at about 200 KB each. A specifier only one
 *  file imports stays inlined — there is nothing to share. */
const VENDOR_PACKAGES: readonly string[] = (() => {
  const importers = new Map<string, Set<string>>()
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (!['node_modules', 'dist'].includes(name) && !EXCLUDED_DOMAINS.includes(name)) visit(full)
        continue
      }
      if (!/\.ts$/.test(name) || /\.(spec|test|d)\.ts$|selftest\.ts$/.test(name)) continue
      const code = readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
      for (const m of code.matchAll(/(?:^|[;\n])\s*(?:import|export)\s[^'"]*?from\s*'([^'./][^']*)'|\bimport\(\s*'([^'./][^']*)'\s*\)/g)) {
        const spec = m[1] ?? m[2]
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
        if (pkg.startsWith('@hypercomb/') || PLATFORM_EXTERNALS.includes(pkg) || pkg.startsWith('node:') || builtinModules.includes(pkg)) continue
        // Keyed by the SPECIFIER, not the package: `nostr-tools/pure` is its
        // own atom (62 KB) and never the whole index (225 KB), and the import
        // map must carry exactly the name the bundles leave external.
        const files = importers.get(spec) ?? new Set<string>()
        files.add(full)
        importers.set(spec, files)
      }
    }
  }
  visit(SRC_ROOT)
  return [...importers].filter(([, files]) => files.size > 1).map(([pkg]) => pkg).sort()
})()

/** What every bee, atom and namespace bundle leaves to the import map. */
const UNIT_EXTERNALS = [...PLATFORM_EXTERNALS, ...VENDOR_PACKAGES]

// A BEE DECLARES ITS LANE (`readonly lane = 'first-paint' | 'boot'`) and the
// build reads the declaration — never a class-name list or a file suffix.
//
// `first-paint`: bee artifacts that must evaluate before the first visible
// hive frame can settle. Constructor-registered services such as Settings,
// AxialService and LayoutService are namespace dependencies of these
// artifacts, not bee artifacts themselves. The signed root layer publishes the
// resolved sigs as `criticalBees`, an optimization hint; the runtime still
// verifies readiness and can fall back to the full bee wave. (Runtimes today
// accept a hint of exactly their three known classes — hypercomb-runtime
// critical-bees.ts — and take the cold path for any other.)
//
// `boot`: the boot lane's bees, named in the root as `bootBees`.
const LANE_RE = /readonly\s+lane\s*(?::[^=]+)?=\s*['"]([^'"]+)['"]/
const LANES = new Set(['first-paint', 'boot'])
const declaredLane = (source: string, where: string): 'first-paint' | 'boot' | null => {
  const lane = LANE_RE.exec(source)?.[1]
  if (lane === undefined) return null
  if (!LANES.has(lane)) throw new Error(`build-module: ${where} declares unknown lane "${lane}"`)
  return lane as 'first-paint' | 'boot'
}

// Separately owned capability packs may still use domain-shaped roots. The
// package's own capabilities live directly under src/ and publish beneath the
// package specifier instead of pretending to be domains.
const EMIT_DOMAIN_ROOT_NAMESPACE = false

// content manifest (replaces latest.json — supports multiple entry points)
const MANIFEST_FILE = 'manifest.json'

// Genesis label for a freshly built package. This is a STABLE sidecar handle —
// the current git branch (or 'genesis' outside a repo) — NOT a timestamp, so a
// rebuild of identical content keeps manifest.json byte-identical and the
// skip-write below still fires. The deploy step (deploy-azure.ps1) is what
// chains "<previous>-updated-<stamp>" against the remote manifest; locally we
// just stamp the branch. The label never enters rootLayerSig (see the manifest
// comment below) — it is discovery metadata, not part of the package identity.
const resolveGenesisLabel = (): string => {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
    const branch = (r.status === 0 ? r.stdout : '').trim()
    return branch && branch !== 'HEAD' ? branch : 'genesis'
  } catch {
    return 'genesis'
  }
}

// -------------------------------------------------
// build cache — Merkle tree with mtime pre-filter
// -------------------------------------------------

/** Leaf: per-source-file mtime + content hash */
interface FileLeaf { mtime: number; sig: string }

/** Namespace or bee compilation unit cache */
interface UnitCache {
  files: Record<string, FileLeaf>   // relPath → { mtime, sig }
  inputSig: string                  // Merkle hash of all file sigs + entry source
  outputSig: string                 // SHA-256 of compiled output
}

/** Cached layer: input components → layer signature + JSON */
interface LayerCacheEntry {
  inputSig: string     // hash of (beeSigs + depSigs + childLayerSigs + docs)
  layerSig: string     // signature of the output layer JSON
  layerJson: string    // the JSON itself
}

/** Cached bee doc extraction */
interface DocCacheEntry {
  contentSignature: string   // hash of source file content
  doc: BeeDocEntry | null
}

/** Cached bee dependency mapping */
interface BeeDepCacheEntry {
  outputSig: string     // signature of compiled bee output
  depSigs: string[]     // resolved dependency signatures
}

// version 4 = flat delivery layout (bare sig files at the dist root).
// The bump busts every version-3 cache so the first post-flip build can
// never take the "Merkle root unchanged" early exit and re-deploy a dist
// that still holds the typed `__x__` layout.
//
// version 5 = bee units keyed on their WHOLE bundle, not just the entry.
// A bee is bundled with `external: allSpecifiers`, so a cross-namespace
// import via the namespace specifier stays external — but a RELATIVE import
// (`../../link/media.js`) is inlined, and every v4 bee unit recorded exactly
// one file: its own entry. Editing an inlined module therefore left the bee
// cached and the stale copy shipped, silently, while the namespace bundle
// holding the same module rebuilt correctly. Found 2026-08-20: SlidesViewDrone
// shipped a pre-change `embedUrlFor` while the `link` dependency carried the
// new one. The bump busts every v4 unit so each bee re-records its real inputs.
//
// version 6 = the class NAME (and the source file name) declare an artifact's
// role, not just its extends clause, and the best-declared class in a bundle
// wins rather than the first. The doc cache is keyed by SOURCE CONTENT, and
// this change edited the EXTRACTOR, not any source — so every one of the 333
// files previously cached as `doc: null` would hit the cache and stay
// nameless. Bumping is what makes an extractor change take effect at all.
//
// version 7 = the signed root layer carries the render-critical bee sigs. The
// source mtimes do not change when this builder changes, so a version-6 cache
// would otherwise take the whole-build early exit and leave the old root in
// place without the new field.
// version 8 = a NAMESPACE bundle is keyed on everything it really inlined
// (esbuild metafile), as a bee has been since v5, and the quick scan stats
// every recorded input, not just entries. A v7 namespace recorded its member
// entries only, so the bump makes each one re-record its real inputs.
// version 10 = atoms and atomized barrels carry the LAZY marker on line 2.
// version 9 = ATOMIC MODULES (documentation/atomic-modules-plan.md). Every
// non-bee file under an atomized root (games/) builds ALONE as a dependency
// atom with its own specifier, and every unit reaches it through the import
// map instead of inlining it. Source content did not change, the builder did,
// so every v8 bee/namespace that inlined a game file must rebuild.
interface BuildCache {
  version: 10
  /** BUILD_SHAPE when this cache was written. */
  shape?: string
  /** DOCS_SHAPE when this cache was written: how layer docs are derived. */
  docsShape?: string
  rootHash: string                            // Merkle root of all unit hashes
  rootLayerSig: string                        // last output root signature
  namespaces: Record<string, UnitCache>
  bees: Record<string, UnitCache>
  /** relPath → atom unit; `imports` = the atom specifiers it statically imports. */
  atoms?: Record<string, UnitCache & { imports: string[] }>
  layerCache?: Record<string, LayerCacheEntry>
  docCache?: Record<string, DocCacheEntry>
  beeDepCache?: Record<string, BeeDepCacheEntry>
}

/** How the layer docs are derived. The docs ride inside the layers, so a
 *  change here must reach them even when no source file moved — the "nothing
 *  changed" early exit asks this too. Bump it with any change to what a doc
 *  carries. queen-passive:1 = queens carry `passive` (passive-queen.ts). */
const DOCS_SHAPE = 'queen-passive:1|renders:1|wakesOn:1'

const CACHE_FILE = join(PROJECT_ROOT, '.build-cache.json')
const OUTPUT_CACHE_DIR = join(DIST_ROOT, '.cache')

const loadCache = (): BuildCache | null => {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    if (raw?.version === 10) return raw
  } catch {}
  return null
}

const saveCache = (c: BuildCache): void =>
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2), 'utf8')

/**
 * For each file: if mtime matches cache, reuse cached sig.
 * Otherwise read + hash the file (and record new mtime).
 * Returns the per-file leaves and a combined inputSig (Merkle node).
 */
const resolveUnitInputs = async (
  files: string[],
  cachedFiles: Record<string, FileLeaf> | undefined,
  extra?: string
): Promise<{ leaves: Record<string, FileLeaf>; inputSig: string; changed: boolean }> => {
  const sorted = [...files].sort()
  const leaves: Record<string, FileLeaf> = {}
  let changed = false
  const sigParts: string[] = []

  for (const f of sorted) {
    const relKey = f  // absolute path as key
    const st = statSync(f)
    const mtime = st.mtimeMs
    const prev = cachedFiles?.[relKey]

    if (prev && prev.mtime === mtime) {
      // mtime match — trust cached content hash, skip file read
      leaves[relKey] = prev
      sigParts.push(prev.sig)
    } else {
      // mtime changed or no cache — read + hash
      const content = readFileSync(f, 'utf8')
      const sig = await SignatureService.sign(toArrayBuffer(textToBytes(content)))
      leaves[relKey] = { mtime, sig }
      changed = changed || (prev?.sig !== sig)  // content actually changed?
      sigParts.push(sig)
    }
  }

  if (extra) sigParts.push(extra)

  // Merkle node = hash of concatenated child sigs
  const inputSig = await SignatureService.sign(
    toArrayBuffer(textToBytes(sigParts.join(':')))
  )

  // If we had no previous cache at all, it's changed
  if (!cachedFiles) changed = true
  // If the combined sig differs from what we'd compute, mark changed
  // (handles case where mtime changed but content didn't — still need to check inputSig)

  return { leaves, inputSig, changed }
}

/**
 * Compute Merkle root from all unit inputSigs.
 */
const computeRootHash = async (unitSigs: string[]): Promise<string> =>
  SignatureService.sign(toArrayBuffer(textToBytes(unitSigs.sort().join(':'))))

// -------------------------------------------------
// helpers
// -------------------------------------------------

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const relPosix = (from: string, to: string): string =>
  relative(from, to).replace(/\\/g, '/') || ''

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const names = readdirSync(dir).slice().sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

const isSource = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')

// exclude test files from artifact pipeline. spec files import vitest;
// when bundled into a namespace dep and loaded in the browser, vitest
// throws "failed to find the runner" at the first beforeEach call,
// crashing every consumer of that namespace. selftest files are NODE
// harnesses (run via tsx) that execute their whole suite at module load
// and may call process.exit — bundling the arkanoid selftest into the
// games/arkanoid namespace dep made the bare `process` throw at import
// time in the browser and took the whole dependency down (the 2026-07-16
// "ReferenceError: process is not defined" dependency-loader failure).
const isSpecFile = (f: string): boolean =>
  f.endsWith('.spec.ts') || f.endsWith('.spec.js') ||
  f.endsWith('.test.ts') || f.endsWith('.test.js') ||
  f.endsWith('selftest.ts') || f.endsWith('selftest.js')

// exclude key-only files from artifact pipeline
const isKeysFile = (f: string): boolean => {
  if (f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js')) return true
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'essentials-keys.ts' || base === 'essentials-keys.js'
}

/** Module-scope registration — the same spellings the doctrine ratchet reads. */
const SELF_REGISTRATION =
  /\bioc\s*\??\.\s*register\s*(?:\?\.)?\s*(?:<[^>]*>)?\s*\(|registerShellSurface\s*\(|^(?:publishService|registerLlmProvider)\s*\(|\bwhenReady\s*(?:\?\.)?\s*(?:<[\s\S]{0,200}?>)?\s*(?:\?\.)?\s*\([\s\S]{0,400}?\.(?:register|add|addProvider)\s*(?:\?\.)?\s*\(|^register\s*(?:<[^>]*>)?\s*\(|^[\w$.]+(?:\(\))?\s*\??\.\s*register\s*(?:\?\.)?\s*\(/m

const registersItself = (f: string): boolean => {
  const code = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return SELF_REGISTRATION.test(code)
}

/** A bee is a behaviour the hive registers: every drone and worker, and —
 *  under an atomized root — every queen that registers ITSELF, because a word
 *  is a behaviour too (jwize, 2026-09-22). A queen its feature's bee registers
 *  (the game queens) stays a dependency of that bee. Outside the atomized
 *  roots a queen still rides its namespace bundle, where its sibling files
 *  are shared; as a lone bee it would carry private copies of them. */
const isBee = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js') || f.endsWith('.worker.ts') || f.endsWith('.worker.js')
  || (/\.(queen|bee)\.[tj]s$/.test(f) && isAtomizedRelPath(relPosix(SRC_ROOT, f)) && registersItself(f))

const isEntry = (f: string): boolean =>
  f.endsWith('.entry.ts') || f.endsWith('.entry.js')

const isIndexFile = (f: string): boolean => {
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'index.ts' || base === 'index.js'
}

const stripExt = (p: string): string =>
  p.slice(0, -extname(p).length)

const textToBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const isSig = (v: string): boolean =>
  /^[a-f0-9]{64}$/i.test(v)

// -------------------------------------------------
// bee doc extraction (from TypeScript source)
// -------------------------------------------------

interface BeeDocEntry {
  className: string
  kind: 'drone' | 'worker' | 'queen' | 'bee'
  description: string
  effects: string[]
  listens: string[]
  emits: string[]
  deps: Record<string, string>
  grammar: { example: string; meaning?: string }[]
  links: { label: string; url: string; purpose?: string }[]
  command: string | null
  aliases: string[]
  /** A queen whose loading only readies her word: she sleeps until it is
   *  used (passive-queen.ts). Decided fresh every build — it depends on the
   *  other sources, not only her own, so it never rides the doc cache. */
  passive?: boolean
  /** The views a sleeping renderer answers (passive-queen.ts viewSleeper). */
  renders?: string[]
  /** The effects that wake a sleeping bee (passive-queen.ts effectSleeper). */
  wakesOn?: string[]
}

/** Every source file of the package, for rules that ask what OTHER files say
 *  (passive-queen.ts). Generated indexes name every key and are left out. */
let packageSources: Map<string, string> | null = null
const allPackageSources = (): Map<string, string> => {
  if (packageSources) return packageSources
  packageSources = new Map()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) && !/^(essentials-keys|side-effects|preload-effects)\.ts$/.test(entry.name)) {
        packageSources!.set(relative(SRC_ROOT, full).replace(/\\/g, '/'), readFileSync(full, 'utf8'))
      }
    }
  }
  walk(SRC_ROOT)
  return packageSources
}

const kindFromName = (className: string): BeeDocEntry['kind'] | null =>
  /QueenBee$|Queen$/.test(className) ? 'queen'
  : /Worker$/.test(className) ? 'worker'
  : /Drone$/.test(className) ? 'drone'
  : /Bee$/.test(className) ? 'bee'
  : null

/** The role a source file names itself for: `*.queen.ts`, `*.drone.ts`, … A
 *  supporting `*.service.ts` ships as a bee sig too, so it is named as one. */
const kindFromFile = (path: string): BeeDocEntry['kind'] | null => {
  const m = path.match(/\.(drone|worker|queen|bee|service)\.ts$/)
  if (!m) return null
  return m[1] === 'service' ? 'bee' : m[1] as BeeDocEntry['kind']
}

const extractBeeDoc = (sourceText: string, sourcePath = ''): BeeDocEntry | null => {
  // Three declarations of the same fact, in order of specificity: the base
  // class, the class NAME, then the FILE name. A *Drone extending EventTarget
  // is still a drone; so is a HistoryRecorder in history-recorder.drone.ts.
  // Requiring the extends clause left all of them with no doc at all, so the
  // installer had only the signature to render as their name.
  //
  // A file may declare several classes, so the artifact is the best-declared
  // one, not the first one: exported outranks internal, and a recognised base
  // or role-suffixed name outranks a bare helper. Taking the first match named
  // layer-committer.drone.ts after its internal CommitMachine.
  const candidates = [...sourceText.matchAll(
    /(?:^|\n)\s*(export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?/g,
  )].map(m => {
    const className = m[2]
    const extendsName = m[3] ?? ''
    const fromBase: BeeDocEntry['kind'] | null =
      extendsName === 'QueenBee' ? 'queen'
      : extendsName === 'Drone' ? 'drone'
      : extendsName === 'Worker' ? 'worker'
      : extendsName === 'Bee' ? 'bee'
      : null
    return {
      className,
      kind: fromBase ?? kindFromName(className) ?? kindFromFile(sourcePath),
      rank: (m[1] ? 2 : 0) + (fromBase || kindFromName(className) ? 1 : 0),
    }
  }).filter(c => c.kind)

  if (!candidates.length) return null
  const best = candidates.reduce((a, b) => (b.rank > a.rank ? b : a))
  const className = best.className
  const kind = best.kind as BeeDocEntry['kind']

  // description — single-line or multi-line string literal
  const descMatch = sourceText.match(
    /(?:override\s+)?description\s*=\s*\n?\s*['"`]([^'"`]+)['"`]/
  )

  // effects array
  const effectsMatch = sourceText.match(
    /(?:override\s+)?effects\s*=\s*\[([^\]]*)\]/
  )
  const effects = effectsMatch
    ? [...effectsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // listens array (may span multiple lines)
  const listensMatch = sourceText.match(
    /(?:override\s+)?listens\s*=\s*\[([\s\S]*?)\]/
  )
  const listens = listensMatch
    ? [...listensMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // emits array (may span multiple lines)
  const emitsMatch = sourceText.match(
    /(?:override\s+)?emits\s*=\s*\[([\s\S]*?)\]/
  )
  const emits = emitsMatch
    ? [...emitsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  // deps object (may span multiple lines)
  const depsMatch = sourceText.match(
    /(?:override\s+)?deps\s*=\s*\{([\s\S]*?)\}/
  )
  const deps: Record<string, string> = {}
  if (depsMatch) {
    for (const m of depsMatch[1].matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) {
      deps[m[1]] = m[2]
    }
  }

  // queen: command
  const cmdMatch = sourceText.match(
    /(?:readonly\s+)?command\s*=\s*['"]([^'"]+)['"]/
  )

  // queen: aliases
  const aliasMatch = sourceText.match(
    /(?:override\s+)?(?:readonly\s+)?aliases\s*=\s*\[([^\]]*)\]/
  )
  const aliases = aliasMatch
    ? [...aliasMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
    : []

  return {
    className,
    kind,
    description: descMatch?.[1]?.trim() ?? '',
    effects,
    listens,
    emits,
    deps,
    grammar: [],
    links: [],
    command: cmdMatch?.[1] ?? null,
    aliases,
  }
}

// `.js`-suffixed refs INSIDE layer JSON (bees/dependencies fields) are a
// wire-format legacy consumers already normalise away (`bare()` below and in
// every fetcher). Kept so layer sigs don't churn; on-disk names are bare.
const jsFileName = (sig: string): string => `${sig}.js`

// Flat emission: every content file is a BARE sig-named file at the dist
// root — no extension, no typed dir. Kind travels in the manifest.
const writeSigFile = (dir: string, sig: string, bytes: Uint8Array | string): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
}

const splitPath = (p: string): string[] =>
  p.split('/').filter(Boolean)

const uniq = (xs: string[]): string[] => Array.from(new Set(xs))

const uniqSorted = (xs: string[]): string[] =>
  uniq(xs).sort((a, b) => a.localeCompare(b))

const namespaceRelDirFromRelDir = (relDir: string): string => {
  const parts = splitPath(relDir)
  return parts.slice(0, Math.min(NAMESPACE_SEGMENTS_MAX, parts.length)).join('/')
}

const isDomainNamespace = (namespaceRelDir: string): boolean =>
  splitPath(namespaceRelDir)[0]?.includes('.') ?? false

const specifierFromNamespaceRelDir = (namespaceRelDir: string): string =>
  isDomainNamespace(namespaceRelDir)
    ? `@${namespaceRelDir}`
    : `${PACKAGE_SPECIFIER}/${namespaceRelDir}`

// -------------------------------------------------
// atomic modules (documentation/atomic-modules-plan.md)
// -------------------------------------------------
//
// Under an atomized root, a feature is ONE bee plus dependency ATOMS: every
// non-bee file compiles alone, sig-named, headed by its own specifier
// (`// @hypercomb/essentials/games/solomon/labyrinth`), and every unit that
// imports it — bee, atom, or namespace bundle — reaches it through the import
// map instead of inlining a copy. The namespace bundle becomes a BARREL of
// `export *` lines, so a consumer of `@hypercomb/essentials/games/solomon`
// keeps working unchanged. Atoms nest: an atom imports atoms the same way.

/** The one list of atomized domains, shared with the doctrine ratchets. */
const ATOMIZED_ROOTS: readonly string[] =
  (JSON.parse(readFileSync(join(PROJECT_ROOT, 'atomized-roots.json'), 'utf8')) as { roots: string[] }).roots

/** THE BUILD'S SHAPE, folded into every unit's input signature. Which domains
 *  are atomized decides what a unit inlines and what it reaches by specifier —
 *  without touching a single source file — so a unit's cache must miss when
 *  the list moves, and so must the whole-build early exit. The vendor
 *  packages decide the same thing for npm code, so they are folded in too.
 *
 *  So do the build's own scripts: a change to how a unit is compiled leaves
 *  every source file untouched, and a warm cache would keep shipping the old
 *  bytes (observed 2026-09-26: a checkout-path fix to this file still built
 *  the old root until dist was moved aside). */
const BUILD_SCRIPTS_SIG = createHash('sha256')
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(readFileSync(join(__dirname, 'passive-queen.ts')))
  .digest('hex')
const BUILD_SHAPE = `atomized:${[...ATOMIZED_ROOTS].sort().join(',')}|vendor:${VENDOR_PACKAGES.join(',')}|scripts:${BUILD_SCRIPTS_SIG}`

const isAtomizedRelPath = (relPath: string): boolean =>
  ATOMIZED_ROOTS.some(root => relPath === root || relPath.startsWith(`${root}/`))

const atomSpecifier = (relPath: string): string =>
  `${PACKAGE_SPECIFIER}/${stripExt(relPath)}`

/** LINE 2 of every atom and atomized barrel. An atom registers nothing, so it
 *  has no reason to load until something imports it: the runtime's
 *  DependencyLoader skips a dependency carrying this line instead of
 *  blob-importing it at boot, and the atom loads once, through the import
 *  map, when a bee reaches it. Keep in step with `LAZY_MARKER` in
 *  hypercomb-runtime/src/dependency-loader.ts. */
const LAZY_MARKER_LINE = '// lazy — an atom: it loads through the import map when something imports it'

/** The bee files under the atomized roots, filled once discovery has run. */
const atomizedBees = new Set<string>()

/** Relative imports that land on an atom become that atom's specifier,
 *  external — the one rule that makes a copy impossible. `self` is the entry
 *  being compiled, which must of course be inlined into itself.
 *
 *  A BEE NEVER CONTAINS ANOTHER BEE. An import that lands on a bee under an
 *  atomized root becomes an empty module: the runtime loads that bee on its
 *  own, and a unit that wants it waits for it to register (the IoC census),
 *  never compiles in a second copy. A NAMED import of a bee's value fails
 *  the build here, loudly, rather than shipping a copy. */
const atomExternalPlugin = (atomByAbs: ReadonlyMap<string, string>, self?: string): Plugin => ({
  name: 'atom-external',
  setup(b) {
    b.onResolve({ filter: /^\.\.?\// }, args => {
      if (args.kind === 'entry-point') return undefined
      const base = resolve(args.resolveDir, args.path)
      const candidates = base.endsWith('.js')
        ? [base.slice(0, -3) + '.ts', base]
        : [base, `${base}.ts`, join(base, 'index.ts')]
      for (const candidate of candidates) {
        if (candidate === self) return undefined
        const specifier = atomByAbs.get(candidate)
        if (specifier) return { path: specifier, external: true }
        // Named relative to src/: the path lands in the bundle, and an absolute
        // one would make the bytes (and the root) depend on the checkout.
        if (atomizedBees.has(candidate)) return { path: relative(SRC_ROOT, candidate).replace(/\\/g, '/'), namespace: 'bee-elsewhere' }
      }
      return undefined
    })
    b.onLoad({ filter: /.*/, namespace: 'bee-elsewhere' }, () => ({ contents: 'export {}', loader: 'js' }))
  },
})

/** Static import cycles among atoms, each as its member specifiers. Inlining
 *  used to hide a cycle; as separate modules a cycle can read a binding in
 *  its temporal dead zone at load, so the build refuses one outright. */
const atomCycles = (graph: ReadonlyMap<string, readonly string[]>): string[][] => {
  let counter = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const cycles: string[][] = []
  const visit = (v: string): void => {
    index.set(v, counter); low.set(v, counter++); stack.push(v); onStack.add(v)
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)) }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) !== index.get(v)) return
    const members: string[] = []
    let w: string
    do { w = stack.pop()!; onStack.delete(w); members.push(w) } while (w !== v)
    if (members.length > 1 || (graph.get(v) ?? []).includes(v)) cycles.push(members.sort())
  }
  for (const v of [...graph.keys()].sort()) if (!index.has(v)) visit(v)
  return cycles
}

const prefixesForNamespaceRelDir = (nsRelDir: string): string[] => {
  const parts = splitPath(nsRelDir)
  const out: string[] = []
  const start = isDomainNamespace(nsRelDir)
    ? (EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2)
    : 1
  for (let i = start; i <= Math.min(parts.length, NAMESPACE_SEGMENTS_MAX); i++) {
    out.push(parts.slice(0, i).join('/'))
  }
  return out
}

const addToBucket = (
  map: Map<string, { bees: string[]; deps: string[] }>,
  relDir: string,
  fileName: string,
  kind: 'dep' | 'bee'
): void => {
  const bucket = map.get(relDir) ?? { bees: [], deps: [] }
  if (kind === 'dep') bucket.deps.push(fileName)
  else bucket.bees.push(fileName)
  map.set(relDir, bucket)
}

// -------------------------------------------------
// discovery
// -------------------------------------------------

type SourceFile = {
  entry: string
  relPath: string
  relDir: string
  kind: 'dependency' | 'bee'
}

const discoverSources = (): SourceFile[] =>
  walkFiles(SRC_ROOT)
    .filter(isSource)
    .filter(f => !isSpecFile(f))
    .filter(f => !isKeysFile(f))
    .filter(f => !isIndexFile(f))
    .filter(f => {
      const relPath = relPosix(SRC_ROOT, f)
      if (relPath === 'types' || relPath.startsWith('types/')) return false
      const domain = relPath.split('/')[0]
      if (EXCLUDED_DOMAINS.includes(domain)) return false
      if (isEntry(relPath)) return false
      const relDir = relPosix(SRC_ROOT, dirname(f))
      if (!relDir) return false
      return true
    })
    .map(file => ({
      entry: file,
      relPath: relPosix(SRC_ROOT, file),
      relDir: relPosix(SRC_ROOT, dirname(file)),
      kind: isBee(file) ? 'bee' : 'dependency',
    }))

// -------------------------------------------------
// layers
// -------------------------------------------------

type DirNode = { rel: string; children: DirNode[] }

const readDirTree = (root: string, rel: string): DirNode => {
  const children: DirNode[] = []
  const full = join(root, rel)
  const names = readdirSync(full).slice().sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    if (!rel && name === 'types') continue
    if (!rel && EXCLUDED_DOMAINS.includes(name)) continue
    const child = join(full, name)
    if (statSync(child).isDirectory()) {
      children.push(readDirTree(root, rel ? `${rel}/${name}` : name))
    }
  }
  return { rel, children }
}

const signJson = async (value: unknown) => {
  const json = JSON.stringify(value)
  const sig = await SignatureService.sign(toArrayBuffer(textToBytes(json)))
  return { sig, json }
}

// beeline caches populated during build, persisted at end
const newLayerCache: Record<string, LayerCacheEntry> = {}
const newDocCache: Record<string, DocCacheEntry> = {}
const newBeeDepCache: Record<string, BeeDepCacheEntry> = {}
let layerCacheHits = 0
let layerCacheMisses = 0

/** THE PACKAGE'S OWN FACES (presentation/fonts/package-fonts.ts): read from
 *  the shells' canonical font files, signed here, and named by the root layer
 *  as `resources` — each entry the file's signature plus the descriptors a
 *  page needs to declare it — so an install holds them like any other atom
 *  and fonts.boot.drone.ts reads them from signed data, never from source.
 *  Set by main() before the layers. */
const PACKAGE_FONTS_DIR = resolve(PROJECT_ROOT, '..', 'hypercomb-shim', 'public', 'fonts')
type RootResource = { sig: string; kind: 'font'; family: string; style: string; weight: string; display: string; unicodeRange?: string }
let rootResources: RootResource[] = []
const readPackageFonts = (): { bytes: Map<string, Uint8Array>; resources: RootResource[] } => {
  const bytes = new Map<string, Uint8Array>()
  const resources: RootResource[] = []
  for (const font of PACKAGE_FONTS) {
    const file = new Uint8Array(readFileSync(join(PACKAGE_FONTS_DIR, font.file)))
    const sig = createHash('sha256').update(file).digest('hex')
    bytes.set(sig, file)
    resources.push({
      sig, kind: 'font', family: font.family, style: font.style, weight: font.weight, display: font.display,
      ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}),
    })
  }
  resources.sort((a, b) => a.sig.localeCompare(b.sig))
  return { bytes, resources }
}

const buildLayersFromTree = async (
  node: DirNode,
  resourcesByDir: Map<string, { bees: string[]; deps: string[] }>,
  out: Map<string, string>,
  rootDependencies: string[],
  rootCriticalBees: readonly string[],
  rootBootBees: readonly string[],
  docsByDir: Map<string, Record<string, BeeDocEntry>>,
  prevLayerCache?: Record<string, LayerCacheEntry>
): Promise<string | null> => {
  const layers: string[] = []
  for (const c of node.children) {
    const childSig = await buildLayersFromTree(c, resourcesByDir, out, rootDependencies, rootCriticalBees, rootBootBees, docsByDir, prevLayerCache)
    if (childSig) layers.push(childSig)
  }

  const entry = resourcesByDir.get(node.rel) ?? { bees: [], deps: [] }

  if (!entry.bees.length && !entry.deps.length && !layers.length && node.rel) return null

  // beeline: compute layer input signature from all components
  const beeSigs = uniqSorted(entry.bees)
  const depSigs = node.rel ? [] : rootDependencies
  const criticalBeeSigs = node.rel ? [] : uniqSorted([...rootCriticalBees])
  const bootBeeSigs = node.rel ? [] : uniqSorted([...rootBootBees])
  const resources = node.rel ? [] : rootResources
  const docsKey = docsByDir.has(node.rel) ? JSON.stringify(docsByDir.get(node.rel)) : ''
  let folderDocSig = ''
  if (node.rel) {
    const docFile = join(SRC_ROOT, node.rel, '_doc.txt')
    if (existsSync(docFile)) {
      folderDocSig = readFileSync(docFile, 'utf8').trim()
    }
  }

  // shapeDescriptor: enumerates the field names this build emits in
  // the layer JSON. When a writer renames or adds/removes a field,
  // change this string so every cached layer's inputSig differs from
  // prior runs and the cache misses. Without this, a field rename
  // (e.g. `layers` → `cells`) is invisible to the input hash and the
  // cache happily returns the OLD JSON under the OLD sig.
  const shapeDescriptor = node.rel
    ? 'cells:name:bees:dependencies'
    : 'cells:name:bees:dependencies:criticalBees:bootBees:resources'

  const layerInputParts = [
    shapeDescriptor,
    node.rel,
    beeSigs.join(':'),
    depSigs.join(':'),
    layers.join(':'),
    criticalBeeSigs.join(':'),
    bootBeeSigs.join(':'),
    JSON.stringify(resources),
    docsKey,
    folderDocSig,
  ]
  const layerInputSig = await SignatureService.sign(
    toArrayBuffer(textToBytes(layerInputParts.join('|')))
  )

  // beeline: check layer cache
  const cached = prevLayerCache?.[node.rel]
  if (cached && cached.inputSig === layerInputSig) {
    out.set(cached.layerSig, cached.layerJson)
    newLayerCache[node.rel] = cached
    layerCacheHits++
    return cached.layerSig
  }

  // cache miss — build the layer
  const beeDocs = docsByDir.get(node.rel)

  const docs = (beeDocs && Object.keys(beeDocs).length > 0) || folderDocSig
    ? {
        ...(folderDocSig ? { description: folderDocSig } : {}),
        ...(beeDocs && Object.keys(beeDocs).length > 0 ? { bees: beeDocs } : {}),
      }
    : undefined

  // Layer = `{name, cells, bees, dependencies}`. `cells` is the array
  // of child layer sigs — same primitive name as the slim hypercomb.io
  // layer's cells (an array of one useful type with a name). No
  // version, no `rel` ceremony — just the meaningful fields.
  const layer: Record<string, unknown> = {
    name: node.rel.split('/').pop() || 'root',
    cells: layers,
    bees: beeSigs,
    dependencies: depSigs,
  }

  if (!node.rel) layer.criticalBees = criticalBeeSigs
  // THE BOOT LANE (atomic-modules-plan.md, step 6): bees that register a
  // service the runtime or the shell reads before any other bee loads. Named
  // only when there are some, so a package without them is byte-identical.
  if (!node.rel && bootBeeSigs.length) layer.bootBees = bootBeeSigs
  // RESOURCES: the fonts (and later pictures) the package renders with, as
  // exact leaf atoms, each `{ sig, kind, … }`. Optional, so an older
  // installer ignores them and a package without any is byte-identical.
  if (!node.rel && resources.length) layer.resources = resources
  if (docs) layer.docs = docs

  const { sig, json } = await signJson(layer)
  out.set(sig, json)
  newLayerCache[node.rel] = { inputSig: layerInputSig, layerSig: sig, layerJson: json }
  layerCacheMisses++
  return sig
}

// -------------------------------------------------
// build helpers
// -------------------------------------------------

const buildNamespaceDependency = async (
  namespaceRelDir: string,
  directMemberFiles: SourceFile[],
  allNamespaceSpecifiers: string[],
  atomByAbs: ReadonlyMap<string, string>,
): Promise<{ sig: string; bytes: Uint8Array; inputs: string[] } | null> => {
  const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir)

  // An atomized namespace is a BARREL: its members are atoms, so it names
  // them and holds no code of its own.
  if (isAtomizedRelPath(namespaceRelDir)) {
    const lines = directMemberFiles
      .map(f => atomByAbs.get(f.entry))
      .filter((spec): spec is string => !!spec)
      .sort()
      .map(spec => `export * from '${spec}';`)
    if (!lines.length) return null
    const bytes = textToBytes(`// ${namespaceSpecifier}\n${LAZY_MARKER_LINE}\n${lines.join('\n')}\n`)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))
    return { sig, bytes, inputs: directMemberFiles.map(f => f.entry) }
  }
  const namespaceRootFs = join(SRC_ROOT, namespaceRelDir)
  const resolveDir = existsSync(namespaceRootFs) ? namespaceRootFs : SRC_ROOT

  const exportLines = directMemberFiles
    .map(f => {
      const relFromNs = relPosix(namespaceRootFs, f.entry)
      const relNoExt = stripExt(relFromNs)
      const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
      return `export * from '${spec}';`
    })
    .sort()

  const entrySource = exportLines.length ? exportLines.join('\n') + '\n' : 'export {};\n'

  const externals = [
    ...UNIT_EXTERNALS,
    ...allNamespaceSpecifiers.filter(s => s !== namespaceSpecifier),
  ]

  const r = await build({
    stdin: {
      contents: entrySource,
      resolveDir,
      sourcefile: `virtual:${namespaceSpecifier}`,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    sourcemap: false,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
    plugins: [atomExternalPlugin(atomByAbs)],
    metafile: true,
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled || compiled.trim().length === 0) {
    console.log(`[build-module] skipping empty namespace: ${namespaceSpecifier}`)
    return null
  }

  const bytes = textToBytes(`// ${namespaceSpecifier}\n${compiled}`)
  const sig = await SignatureService.sign(toArrayBuffer(bytes))
  // Every real file the bundle inlined (the virtual stdin entry is not one).
  const inputs = Object.keys(r.metafile?.inputs ?? {})
    .map(rel => resolve(process.cwd(), rel))
    .filter(abs => { try { return statSync(abs).isFile() } catch { return false } })
  return { sig, bytes, inputs }
}

/** Compile one bee, and report every file esbuild actually inlined.
 *
 *  The input list is the point: a bee bundles its whole relative import graph,
 *  so ANY of those files changing changes the bee. Keying the cache on the
 *  entry alone (v4) shipped stale bees whenever a shared helper moved. */
const buildBee = async (
  entry: string,
  externals: string[],
  atomByAbs: ReadonlyMap<string, string> = new Map(),
): Promise<{ bytes: Uint8Array; inputs: string[]; imports: string[] }> => {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    sourcemap: false,
    tsconfig: resolve(PROJECT_ROOT, 'tsconfig.json'),
    external: externals,
    plugins: [atomExternalPlugin(atomByAbs, entry)],
    metafile: true,
  })

  const compiled = r.outputFiles?.[0]?.text
  // A types-only atom compiles to nothing and stays an atom, so a barrel's
  // `export *` of it still resolves.
  if (compiled === undefined || (!compiled.trim() && !atomByAbs.has(entry))) throw new Error(`no output: ${entry}`)

  // The atoms this unit STATICALLY imports (a dynamic import cannot close a
  // load-time cycle, so it is left out of the cycle check).
  const atomSpecs = new Set(atomByAbs.values())
  const imports = uniqSorted(
    Object.values(r.metafile?.outputs ?? {})
      .flatMap(o => o.imports)
      .filter(i => i.external && i.kind !== 'dynamic-import' && atomSpecs.has(i.path))
      .map(i => i.path),
  )

  // metafile keys are cwd-relative; virtual/synthetic entries resolve to
  // nothing on disk and are dropped. The entry is always tracked.
  const inputs = Object.keys(r.metafile?.inputs ?? {})
    .map(rel => resolve(process.cwd(), rel))
    .filter(abs => { try { return statSync(abs).isFile() } catch { return false } })
  if (!inputs.includes(entry)) inputs.push(entry)

  return { bytes: textToBytes(compiled.trim() ? compiled : 'export {};\n'), inputs, imports }
}

// -------------------------------------------------
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  const t0 = performance.now()

  const sources = discoverSources()
  if (!sources.length) throw new Error('no sources found')

  // --- Phase 1: Merkle tree mtime scan (cheap: stat only, no file reads) ---

  const cache = loadCache()

  // Classify sources into namespaces and bees
  const deps = sources.filter(s => s.kind === 'dependency')
  const namespaceToMembers = new Map<string, SourceFile[]>()
  const nsDerived = new Set<string>()

  for (const src of deps) {
    const ns = namespaceRelDirFromRelDir(src.relDir)
    nsDerived.add(ns)
    const list = namespaceToMembers.get(ns) ?? []
    list.push(src)
    namespaceToMembers.set(ns, list)
  }

  const nsAll = new Set<string>()
  for (const ns of nsDerived) {
    for (const p of prefixesForNamespaceRelDir(ns)) nsAll.add(p)
  }

  const allNs = Array.from(nsAll).sort()
  const allSpecifiers = allNs.map(specifierFromNamespaceRelDir)
  const beeSources = sources.filter(s => s.kind === 'bee')
  const atomSources = deps.filter(s => isAtomizedRelPath(s.relPath))
  const atomByAbs = new Map(atomSources.map(s => [s.entry, atomSpecifier(s.relPath)] as const))
  for (const s of beeSources) if (isAtomizedRelPath(s.relPath)) atomizedBees.add(s.entry)
  const atomSpecifierSet = new Set(atomByAbs.values())
  const collidingAtoms = atomSources.filter(s => allSpecifiers.includes(atomSpecifier(s.relPath)))
  if (collidingAtoms.length) {
    throw new Error(`atom specifier collides with a namespace: ${collidingAtoms.map(s => s.relPath).join(', ')}`)
  }

  // Quick mtime scan: check if ANY file has a changed mtime — every file a
  // unit really bundled, not only its entries. A bundle inlines modules from
  // other folders through relative imports; checking entries alone let a
  // change to such a module skip the build and ship the old copy (2026-09-22:
  // the commands and safety bundles kept an old Jev rubric that registered
  // over the new one).
  const unitMoved = (cachedUnit: UnitCache, entries: readonly string[]): boolean => {
    for (const entry of entries) if (!cachedUnit.files[entry]) return true
    for (const [file, prev] of Object.entries(cachedUnit.files)) {
      try { if (statSync(file).mtimeMs !== prev.mtime) return true } catch { return true }
    }
    return false
  }
  let anyMtimeChanged = !cache || cache.shape !== BUILD_SHAPE
  if (cache && !anyMtimeChanged) {
    for (const ns of allNs) {
      const cachedUnit = cache.namespaces[ns]
      if (!cachedUnit || unitMoved(cachedUnit, (namespaceToMembers.get(ns) ?? []).map(m => m.entry))) { anyMtimeChanged = true; break }
    }
    if (!anyMtimeChanged) {
      for (const src of beeSources) {
        const cachedUnit = cache.bees[src.relPath]
        if (!cachedUnit || unitMoved(cachedUnit, [src.entry])) { anyMtimeChanged = true; break }
      }
    }
    if (!anyMtimeChanged) {
      for (const src of atomSources) {
        const cachedUnit = cache.atoms?.[src.relPath]
        if (!cachedUnit || unitMoved(cachedUnit, [src.entry])) { anyMtimeChanged = true; break }
      }
      if (Object.keys(cache.atoms ?? {}).length !== atomSources.length) anyMtimeChanged = true
    }
    // Also check file count hasn't changed (files added/removed)
    if (!anyMtimeChanged) {
      const cachedNsCount = Object.keys(cache.namespaces).length
      const cachedBeeCount = Object.keys(cache.bees).length
      if (cachedNsCount !== allNs.length || cachedBeeCount !== beeSources.length) {
        anyMtimeChanged = true
      }
    }
  }

  // --- Early exit: nothing changed at all ---
  if (!anyMtimeChanged && cache && cache.docsShape === DOCS_SHAPE) {
    const manifestFile = join(DIST_ROOT, MANIFEST_FILE)

    // Verify output still exists (not wiped externally)
    if (existsSync(manifestFile)) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3)
      console.log(`[build-module] Merkle root unchanged — skipping build entirely`)
      console.log(`[build-module] root signature: ${cache.rootLayerSig}`)
      console.log(`[build-module] completed in ${elapsed}s`)
      return
    }

    // Output missing — need to reconstruct from .cache/ files
    console.log(`[build-module] Merkle root unchanged but output missing — reconstructing`)
  }

  // --- Phase 2: Preserve .cache/ and manifest.json, clean old root sig directories ---
  if (existsSync(DIST_ROOT)) {
    for (const name of readdirSync(DIST_ROOT)) {
      if (name === '.cache' || name === MANIFEST_FILE) continue
      rmSync(join(DIST_ROOT, name), { recursive: true, force: true })
    }
  }
  ensureDir(DIST_ROOT)
  ensureDir(OUTPUT_CACHE_DIR)

  // --- Phase 3: Per-unit builds with mtime-aware Merkle caching ---

  const resourcesByDir = new Map<string, { bees: string[]; deps: string[] }>()
  const dependencyBytes = new Map<string, Uint8Array>()
  const resourceBytes = new Map<string, Uint8Array>()
  const layers = new Map<string, string>()

  const newNamespaces: Record<string, UnitCache> = {}
  const newBees: Record<string, UnitCache> = {}
  const newAtoms: Record<string, UnitCache & { imports: string[] }> = {}
  const allUnitSigs: string[] = []

  let cacheHits = 0
  let cacheMisses = 0

  for (const ns of allNs) {
    const members = namespaceToMembers.get(ns) ?? []

    // Build the same virtual entry source used by buildNamespaceDependency for hashing
    const namespaceRootFs = join(SRC_ROOT, ns)
    const entrySource = members.length
      ? members.map(f => {
          const relFromNs = relPosix(namespaceRootFs, f.entry)
          const relNoExt = stripExt(relFromNs)
          const spec = relNoExt.startsWith('.') ? relNoExt : `./${relNoExt}`
          return `export * from '${spec}';`
        }).sort().join('\n') + '\n'
      : 'export {};\n'

    // The namespace's inputs are the LAST build's actual bundle contents, as
    // a bee's are (v5): its member entries AND every module they inline from
    // other folders. Keyed on the entries alone, a change to an inlined module
    // never rebuilt the bundle, and the stale copy shipped.
    const recordedNs = cache?.namespaces[ns]
      ? Object.keys(cache.namespaces[ns].files).filter(f => { try { return statSync(f).isFile() } catch { return false } })
      : []
    let { leaves, inputSig } = await resolveUnitInputs(
      [...new Set([...members.map(m => m.entry), ...recordedNs])],
      cache?.namespaces[ns]?.files,
      `${entrySource}|${BUILD_SHAPE}`
    )

    const cachedUnit = cache?.namespaces[ns]
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      const bytes = new Uint8Array(readFileSync(cachedFile))
      dependencyBytes.set(cachedUnit.outputSig, bytes)
      addToBucket(resourcesByDir, ns, jsFileName(cachedUnit.outputSig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(cachedUnit.outputSig), 'dep')
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      allUnitSigs.push(inputSig)
      cacheHits++
    } else {
      const built = await buildNamespaceDependency(ns, members, allSpecifiers, atomByAbs)
      if (!built) continue
      dependencyBytes.set(built.sig, built.bytes)
      addToBucket(resourcesByDir, ns, jsFileName(built.sig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep')
      writeFileSync(join(OUTPUT_CACHE_DIR, `${built.sig}.js`), built.bytes)
      // Re-key on what was really bundled, so the NEXT run sees a change in
      // any inlined module rather than only in the member entries.
      ;({ leaves, inputSig } = await resolveUnitInputs([...new Set([...members.map(m => m.entry), ...built.inputs])], cachedUnit?.files, `${entrySource}|${BUILD_SHAPE}`))
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: built.sig }
      allUnitSigs.push(inputSig)
      cacheMisses++
    }
  }

  console.log(`[build-module] dependencies: ${cacheHits} cached, ${cacheMisses} built`)

  // --- ATOMS: one sig-named dependency per non-bee file under an atomized
  // root. Keyed like a bee on everything it really inlined (files outside the
  // atomized roots are still inlined until their domain is atomized too).
  const atomExternals = [...UNIT_EXTERNALS, ...allSpecifiers, ...atomSpecifierSet]
  const atomAliasBySig = new Map<string, string>()
  let atomHits = 0
  let atomMisses = 0
  for (const src of atomSources) {
    const specifier = atomByAbs.get(src.entry)!
    const cachedUnit = cache?.atoms?.[src.relPath]
    const recorded = cachedUnit
      ? Object.keys(cachedUnit.files).filter(f => { try { return statSync(f).isFile() } catch { return false } })
      : []
    const inputPaths = recorded.includes(src.entry) ? recorded : [src.entry, ...recorded]
    let { leaves, inputSig } = await resolveUnitInputs(inputPaths, cachedUnit?.files, `${specifier}|${BUILD_SHAPE}`)
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    let bytes: Uint8Array
    let sig: string
    let imports: string[]
    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      bytes = new Uint8Array(readFileSync(cachedFile))
      sig = cachedUnit.outputSig
      imports = cachedUnit.imports
      atomHits++
    } else {
      const built = await buildBee(src.entry, atomExternals, atomByAbs)
      bytes = textToBytes(`// ${specifier}\n${LAZY_MARKER_LINE}\n${new TextDecoder().decode(built.bytes)}`)
      sig = await SignatureService.sign(toArrayBuffer(bytes))
      imports = built.imports
      writeFileSync(join(OUTPUT_CACHE_DIR, `${sig}.js`), bytes)
      ;({ leaves, inputSig } = await resolveUnitInputs(built.inputs, cachedUnit?.files, `${specifier}|${BUILD_SHAPE}`))
      atomMisses++
    }
    newAtoms[src.relPath] = { files: leaves, inputSig, outputSig: sig, imports }
    allUnitSigs.push(inputSig)
    dependencyBytes.set(sig, bytes)
    atomAliasBySig.set(sig, specifier)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'dep')
  }
  const cycles = atomCycles(new Map(Object.values(newAtoms).map((unit, i) => [atomByAbs.get(atomSources[i].entry)!, unit.imports])))
  if (cycles.length) {
    throw new Error(`import cycle among atoms — break it before it can load in a dead zone:\n  ${cycles.map(c => c.join(' ↔ ')).join('\n  ')}`)
  }
  console.log(`[build-module] atoms: ${atomHits} cached, ${atomMisses} built across ${ATOMIZED_ROOTS.join(', ')}`)

  // --- VENDOR ATOMS: each shared npm package, bundled once (VENDOR_PACKAGES).
  // The whole package (`export *`): a dynamic or namespace import reaches any
  // export, and one copy costs less than the smallest two.
  for (const pkg of VENDOR_PACKAGES) {
    if (pkg === 'pixi.js') {
      const bytes = textToBytes(`// ${pkg}\n${LAZY_MARKER_LINE}\n${await buildPixiRuntime(PROJECT_ROOT)}`)
      const sig = await SignatureService.sign(toArrayBuffer(bytes))
      dependencyBytes.set(sig, bytes)
      atomAliasBySig.set(sig, pkg)
      continue
    }
    const r = await build({
      stdin: { contents: `export * from '${pkg}';\n`, resolveDir: PROJECT_ROOT, sourcefile: `virtual:vendor:${pkg}`, loader: 'ts' },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      target: TARGET,
      sourcemap: false,
      external: UNIT_EXTERNALS.filter(external => external !== pkg),
    })
    const text = r.outputFiles?.[0]?.text
    if (!text) throw new Error(`no output: vendor ${pkg}`)
    const bytes = textToBytes(`// ${pkg}\n${LAZY_MARKER_LINE}\n${text}`)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))
    dependencyBytes.set(sig, bytes)
    atomAliasBySig.set(sig, pkg)
  }
  if (VENDOR_PACKAGES.length) console.log(`[build-module] vendor atoms: ${VENDOR_PACKAGES.join(', ')}`)

  const rootDependencies = uniqSorted(Array.from(dependencyBytes.keys()).map(jsFileName))
  const dependencySigs = Array.from(dependencyBytes.keys()).sort((a, b) => a.localeCompare(b))

  // class-to-dep reverse index: scan each namespace bundle for exported class names
  const classToDepSig = new Map<string, string>()
  for (const [sig, bytes] of dependencyBytes) {
    const text = new TextDecoder().decode(bytes)
    for (const m of text.matchAll(/(?:var\s+(\w+)\s*=\s*class|class\s+(\w+))/g)) {
      const name = m[1] || m[2]
      if (name) classToDepSig.set(name, sig)
    }
  }
  console.log(`[build-module] class-to-dep index: ${classToDepSig.size} classes across ${dependencyBytes.size} namespaces`)

  // pre-extract docs from ALL source files that extend Bee/Drone/Worker/QueenBee
  // beeline: cache doc extraction by file content signature
  const prevDocCache = cache?.docCache
  const queenDocsByDir = new Map<string, Record<string, BeeDocEntry>>()
  let docCacheHits = 0
  let docCacheMisses = 0

  for (const src of deps) {
    // beeline: check doc cache by content signature from unit cache
    const unitFiles = newNamespaces[namespaceRelDirFromRelDir(src.relDir)]?.files
    const fileLeaf = unitFiles?.[src.entry]
    const prevDoc = fileLeaf?.sig ? prevDocCache?.[src.entry] : undefined

    let doc: BeeDocEntry | null
    if (prevDoc && fileLeaf && prevDoc.contentSignature === fileLeaf.sig) {
      doc = prevDoc.doc
      newDocCache[src.entry] = prevDoc
      docCacheHits++
    } else {
      const tsSource = readFileSync(src.entry, 'utf8')
      doc = extractBeeDoc(tsSource, src.entry)
      if (fileLeaf) {
        newDocCache[src.entry] = { contentSignature: fileLeaf.sig, doc }
      }
      docCacheMisses++
    }

    if (doc && doc.kind === 'queen') {
      const dirDocs = queenDocsByDir.get(src.relDir) ?? {}
      dirDocs[`queen:${doc.className}`] = doc
      queenDocsByDir.set(src.relDir, dirDocs)
    }
  }

  // bees — extract deps from compiled output and map to dep sigs
  const beeDepsMap = new Map<string, string[]>()
  const docsByDir = new Map<string, Record<string, BeeDocEntry>>()
  /** Bees that declare `lane = 'first-paint'`, by their source entry. */
  const firstPaint: { entry: string; sig: string }[] = []
  /** Bees that declare `lane = 'boot'` — the boot lane, named in the root. */
  const bootBees: string[] = []
  const beeExternals = [...UNIT_EXTERNALS, ...allSpecifiers]
  let beeCacheHits = 0
  let beeCacheMisses = 0

  for (const src of beeSources) {
    const cachedUnit = cache?.bees[src.relPath]

    // The unit's inputs are the LAST build's actual bundle contents, not the
    // entry alone — that is the whole point of v5. Cold cache falls back to
    // the entry; the build below then records the real set. A recorded input
    // that has since been deleted is dropped (its absence changes the entry
    // that imported it, which is tracked).
    const recorded = cachedUnit
      ? Object.keys(cachedUnit.files).filter(f => { try { return statSync(f).isFile() } catch { return false } })
      : []
    const inputPaths = recorded.includes(src.entry) ? recorded : [src.entry, ...recorded]

    let { leaves, inputSig } = await resolveUnitInputs(inputPaths, cachedUnit?.files, BUILD_SHAPE)

    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    let bytes: Uint8Array
    let sig: string

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      bytes = new Uint8Array(readFileSync(cachedFile))
      sig = cachedUnit.outputSig
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      beeCacheHits++
    } else {
      const built = await buildBee(src.entry, beeExternals, atomByAbs)
      bytes = built.bytes
      sig = await SignatureService.sign(toArrayBuffer(bytes))
      writeFileSync(join(OUTPUT_CACHE_DIR, `${sig}.js`), bytes)
      // Re-key on what was really bundled, so the NEXT run sees a change in
      // any inlined module rather than only in this file.
      ;({ leaves, inputSig } = await resolveUnitInputs(built.inputs, cachedUnit?.files, BUILD_SHAPE))
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: sig }
      beeCacheMisses++
    }

    allUnitSigs.push(inputSig)

    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'bee')
    const entryRel = relative(SRC_ROOT, src.entry).replace(/\\/g, '/')
    const lane = declaredLane(allPackageSources().get(entryRel) ?? readFileSync(src.entry, 'utf8'), entryRel)
    if (lane === 'boot') bootBees.push(sig)
    if (lane === 'first-paint') firstPaint.push({ entry: entryRel, sig })

    // beeline: cache bee doc extraction by content signature
    const beeFileLeaf = newBees[src.relPath]?.files[src.entry]
    const prevBeeDoc = beeFileLeaf?.sig ? prevDocCache?.[src.entry] : undefined

    let beeDoc: BeeDocEntry | null
    if (prevBeeDoc && beeFileLeaf && prevBeeDoc.contentSignature === beeFileLeaf.sig) {
      beeDoc = prevBeeDoc.doc
      newDocCache[src.entry] = prevBeeDoc
      docCacheHits++
    } else {
      const tsSource = readFileSync(src.entry, 'utf8')
      beeDoc = extractBeeDoc(tsSource, src.entry)
      if (beeFileLeaf) {
        newDocCache[src.entry] = { contentSignature: beeFileLeaf.sig, doc: beeDoc }
      }
      docCacheMisses++
    }

    if (beeDoc?.kind === 'queen') {
      const rel = relative(SRC_ROOT, src.entry).replace(/\\/g, '/')
      const verdict = passiveQueen(rel, allPackageSources().get(rel) ?? readFileSync(src.entry, 'utf8'), allPackageSources())
      beeDoc = { ...beeDoc, passive: verdict.passive }
    } else if (beeDoc) {
      const rel = relative(SRC_ROOT, src.entry).replace(/\\/g, '/')
      const verdict = viewSleeper(rel, allPackageSources().get(rel) ?? readFileSync(src.entry, 'utf8'), allPackageSources())
      if (verdict.sleeps) beeDoc = { ...beeDoc, passive: true, renders: verdict.renders }
      else {
        const woken = effectSleeper(rel, allPackageSources().get(rel) ?? readFileSync(src.entry, 'utf8'), allPackageSources())
        if (woken.sleeps) beeDoc = { ...beeDoc, passive: true, wakesOn: woken.wakesOn }
      }
    }

    if (beeDoc) {
      const dirDocs = docsByDir.get(src.relDir) ?? {}
      dirDocs[sig] = beeDoc
      docsByDir.set(src.relDir, dirDocs)
    }

    // beeline: cache bee dependency mapping by outputSig.
    // CRITICAL: also verify every cached dep sig still exists as a live
    // dependency in this build. If a dep namespace was rebuilt with new
    // contents (its sig changed), the bee's output sig stays the same
    // (deps are externals during bee compile), but the cached dep sigs
    // are now phantom — they reference files that no longer exist on
    // disk. Re-extract from the compiled output in that case.
    const prevBeeDep = cache?.beeDepCache?.[src.relPath]
    const cachedDepsStillLive = prevBeeDep
      ? prevBeeDep.depSigs.every(s => dependencyBytes.has(s))
      : false
    if (prevBeeDep && prevBeeDep.outputSig === sig && cachedDepsStillLive) {
      // beeline hit: same compiled output AND every dep sig still on disk
      if (prevBeeDep.depSigs.length) {
        beeDepsMap.set(sig, prevBeeDep.depSigs)
      }
      newBeeDepCache[src.relPath] = prevBeeDep
    } else {
      // cache miss: extract deps from compiled output
      const text = new TextDecoder().decode(bytes)
      const resolvedDepSigs = new Set<string>()
      const depsMatch = text.match(/deps\s*=\s*\{([^}]+)\}/)
      if (depsMatch) {
        for (const m of depsMatch[1].matchAll(/@[^"'/]+\/(\w+)/g)) {
          const cls = m[1]
          if (cls && classToDepSig.has(cls)) resolvedDepSigs.add(classToDepSig.get(cls)!)
        }
      }
      const sortedDepSigs = [...resolvedDepSigs].sort()
      if (sortedDepSigs.length) {
        beeDepsMap.set(sig, sortedDepSigs)
        const relName = src.relPath.split('/').pop() ?? src.relPath
        console.log(`[build-module] ${relName} → ${resolvedDepSigs.size} dep(s)`)
      }
      newBeeDepCache[src.relPath] = { outputSig: sig, depSigs: sortedDepSigs }
    }
  }

  console.log(`[build-module] bees: ${beeCacheHits} cached, ${beeCacheMisses} built`)

  // Resolve declared intent to content identity. This is deliberately strict:
  // silently emitting a partial or ambiguous startup hint would move a
  // compiler mistake onto the participant's first-paint path. Older roots may
  // omit the field; every root produced by this compiler names each declared
  // bee exactly once.
  if (!firstPaint.length) throw new Error('build-module: no bee declares lane = \'first-paint\'')
  const criticalBees = uniqSorted(firstPaint.map(bee => bee.sig))
  if (criticalBees.length !== firstPaint.length) {
    throw new Error(`build-module: first-paint bees resolved to duplicate signatures: ${firstPaint.map(bee => bee.entry).join(', ')}`)
  }
  for (const sig of criticalBees) {
    if (!isSig(sig)) throw new Error(`build-module: render-critical bee has invalid signature: ${sig}`)
    if (!resourceBytes.has(sig)) throw new Error(`build-module: render-critical bee is outside the bee inventory: ${sig}`)
  }
  console.log(`[build-module] render-critical bees: ${criticalBees.map(sig => sig.slice(0, 12)).join(', ')}`)

  // --- Phase 4: layers + manifest (always regenerated, cheap) ---

  // merge queen docs into docsByDir (queens are keyed by className, not sig)
  for (const [dir, queenDocs] of queenDocsByDir) {
    const dirDocs = docsByDir.get(dir) ?? {}
    Object.assign(dirDocs, queenDocs)
    docsByDir.set(dir, dirDocs)
  }

  const { bytes: packageFontBytes, resources: packageFontResources } = readPackageFonts()
  rootResources = packageFontResources
  const tree = readDirTree(SRC_ROOT, '')
  const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies, criticalBees, uniqSorted(bootBees), docsByDir, cache?.layerCache)
  // The root node (`node.rel === ''`) always builds a layer — the null
  // early-return in buildLayersFromTree is gated on `node.rel`, so only a
  // non-root empty dir returns null. Assert it here so the rest of the
  // pipeline (closure check, manifest key) can treat the root sig as the
  // string it always is.
  if (!rootLayerSig) throw new Error('build-module: root layer produced no signature (empty source tree?)')

  console.log(`[build-module] layers: ${layerCacheHits} cached, ${layerCacheMisses} built`)
  console.log(`[build-module] doc extraction: ${docCacheHits} cached, ${docCacheMisses} parsed`)

  // report doc extraction stats
  let docCount = 0
  for (const dirDocs of docsByDir.values()) docCount += Object.keys(dirDocs).length
  console.log(`[build-module] docs: ${docCount} bee doc(s) extracted across ${docsByDir.size} lineage(s)`)

  // write package — flat bare-sig files at the dist root. No typed dirs:
  // layers, bees and dependencies all land as `dist/<sig>`; the manifest's
  // arrays are what say which sig is which kind.
  for (const [sig, json] of layers) writeSigFile(DIST_ROOT, sig, json)
  for (const [sig, bytes] of dependencyBytes) writeSigFile(DIST_ROOT, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigFile(DIST_ROOT, sig, bytes)
  for (const [sig, bytes] of packageFontBytes) writeSigFile(DIST_ROOT, sig, bytes)

  // Sigbag emission. A bag is a directory named by its content sig; entries
  // are zero-padded index files (0000, 0001, …) whose contents carry the
  // leaf metadata needed to build the importmap directly — no follow-up
  // leaf-file open required.
  //
  // Entry format (two-line text):
  //   line 1: alias (e.g. `@diamondcoreprocessor.com/clipboard`) or empty
  //   line 2: leaf sig
  //
  // Bag sig = SHA-256 of canonical bytestream (entry contents joined by NUL).
  // Format changes propagate to the bag sig automatically — old bags don't
  // collide with new ones.
  //
  // No HEAD pointer file is emitted. Everything written here is content-
  // addressed: the bag dir is named by its sig, entries are named by
  // index, leaves are named by their own sig. Bags live at the DIST ROOT
  // next to the flat sig files, and the receiver discovers them ONLY via
  // the manifest's `dependenciesBag`/`beesBag` fields — never by scanning
  // a dir (under the flat layout a scan can't tell a bag from any other
  // sig-named dir, and scan-and-delete against a shared root is a
  // data-loss trap).
  type BagEntry = { sig: string; content: string }
  /** Conformance-width marker filename. Kept as one expression so the width
   *  lives in a single place on the emitting side. */
  const markerFilename = (index: number): string => String(index).padStart(8, '0')
  const writeBag = async (parentDir: string, entries: BagEntry[]): Promise<string> => {
    const sorted = [...entries].sort((a, b) => a.sig.localeCompare(b.sig))
    const canonical = sorted.map(e => e.content).join('\0')
    const bagSig = await SignatureService.sign(toArrayBuffer(textToBytes(canonical)))
    const bagDir = join(parentDir, bagSig)
    ensureDir(bagDir)
    sorted.forEach((entry, i) => {
      // 8 digits — the marker filename width the conformance contract pins
      // (`conformance/vectors.json` markerFilenameWidth, and protocol's
      // `marker_index` rejects any other width). At 4 a conformant reader
      // classified every entry in these bags as a POOL MEMBER, not a marker.
      // The bag sig is derived from the entry CONTENT, so widening the
      // filenames does not change it — which is exactly why the receiver in
      // `ensure-install.ts` must keep reading the 4-digit names too: an
      // already-deployed dist carries the same bag sig with the old names.
      writeFileSync(join(bagDir, markerFilename(i)), entry.content, 'utf8')
    })
    return bagSig
  }

  // Build alias → sig index for dependencies. Each namespace's compiled
  // output sig pairs with its `@namespace/path` import specifier.
  const depAliasBySig = new Map<string, string>()
  for (const [ns, unit] of Object.entries(newNamespaces)) {
    depAliasBySig.set(unit.outputSig, specifierFromNamespaceRelDir(ns))
  }
  for (const [sig, alias] of atomAliasBySig) depAliasBySig.set(sig, alias)

  const depEntries: BagEntry[] = Array.from(dependencyBytes.keys()).map(sig => {
    const alias = depAliasBySig.get(sig) ?? ''
    return { sig, content: `${alias}\n${sig}\n` }
  })
  const beeEntries: BagEntry[] = Array.from(resourceBytes.keys()).map(sig => ({
    sig,
    content: `\n${sig}\n`,   // empty alias line; layout matches dep entries
  }))

  const dependenciesBag = await writeBag(DIST_ROOT, depEntries)
  const beesBag = await writeBag(DIST_ROOT, beeEntries)
  console.log(`[build-module] bags: dependencies=${dependenciesBag.slice(0, 12)} bees=${beesBag.slice(0, 12)}`)

  // content manifest — package entry keyed by root signature.
  // The package's identity is its rootLayerSig (the merkle hash of the layer
  // tree); its meaning is its sig arrays. `label`/`previous` are SIDECAR
  // discovery metadata — a human-readable branch name and the version this
  // supersedes — in the same non-identity category as dependenciesBag/beesBag.
  // They change manifest.json bytes but NOT rootLayerSig, so naming a package
  // never redefines it. (`at`, the deploy timestamp, is intentionally NOT set
  // here — a fresh timestamp every build would churn the local manifest and
  // defeat the skip-write below. deploy-azure.ps1 sets `at` + `previous` +
  // `generation` (the version counter) against the remote manifest at deploy
  // time; `label` stays this short genesis name.)
  const packageEntry = {
    layers: Array.from(layers.keys()).sort((a, b) => a.localeCompare(b)),
    bees: Array.from(resourceBytes.keys()).sort((a, b) => a.localeCompare(b)),
    dependencies: dependencySigs,
    beeDeps: Object.fromEntries(beeDepsMap),
    dependenciesBag,
    beesBag,
    label: resolveGenesisLabel(),
    previous: null as string | null,
  }

  // ── Closure check ────────────────────────────────────────────────
  // Every signature a layer references (child layers in `cells`, plus
  // `bees` and root `dependencies`) and every dep a bee declares MUST
  // exist on disk AND be listed in the manifest. A dangling reference
  // would publish a manifest that installs "complete" (the receiver only
  // verifies the listed sigs — ensure-install.ts) yet renders BLANK the
  // moment a consumer walks into the missing layer/bee: layer resolution
  // has no host fallback on the render path, so getLayerBySig just returns
  // null and the completeness gate exhausts. Fail the build here, before
  // the manifest is written, so a broken package never ships.
  {
    const onDiskLayers = new Set(layers.keys())
    const onDiskBees = new Set(resourceBytes.keys())
    const onDiskDeps = new Set(dependencyBytes.keys())
    const onDiskResources = new Set(packageFontBytes.keys())
    const inManifestLayers = new Set(packageEntry.layers)
    const inManifestBees = new Set(packageEntry.bees)
    const inManifestDeps = new Set(packageEntry.dependencies)
    // Layer JSON stores bees/deps WITH a `.js` suffix (rootDependencies +
    // entry.bees use jsFileName); cells + every on-disk/manifest map use
    // bare sigs. Normalise to bare before comparing.
    const bare = (s: unknown): string => String(s ?? '').replace(/\.js$/i, '')
    const errors: string[] = []

    if (!onDiskLayers.has(rootLayerSig)) errors.push(`root layer ${rootLayerSig.slice(0, 12)} not written to dist`)
    if (!inManifestLayers.has(rootLayerSig)) errors.push(`root layer ${rootLayerSig.slice(0, 12)} missing from manifest.layers`)

    for (const [sig, json] of layers) {
      let parsed: { name?: string; cells?: unknown[]; bees?: unknown[]; dependencies?: unknown[]; resources?: unknown[]; criticalBees?: unknown[]; bootBees?: unknown[] }
      try { parsed = JSON.parse(json) } catch { errors.push(`layer ${sig.slice(0, 12)} is not valid JSON`); continue }
      const tag = `layer "${parsed.name ?? '?'}" (${sig.slice(0, 12)})`
      for (const child of (Array.isArray(parsed.cells) ? parsed.cells : [])) {
        const c = bare(child)
        if (!onDiskLayers.has(c)) errors.push(`${tag} → child layer ${c.slice(0, 12)} not on disk`)
        else if (!inManifestLayers.has(c)) errors.push(`${tag} → child layer ${c.slice(0, 12)} missing from manifest.layers`)
      }
      for (const beeRef of (Array.isArray(parsed.bees) ? parsed.bees : [])) {
        const b = bare(beeRef)
        if (!onDiskBees.has(b)) errors.push(`${tag} → bee ${b.slice(0, 12)} not on disk`)
        else if (!inManifestBees.has(b)) errors.push(`${tag} → bee ${b.slice(0, 12)} missing from manifest.bees`)
      }
      for (const depRef of (Array.isArray(parsed.dependencies) ? parsed.dependencies : [])) {
        const d = bare(depRef)
        if (!onDiskDeps.has(d)) errors.push(`${tag} → dependency ${d.slice(0, 12)} not on disk`)
        else if (!inManifestDeps.has(d)) errors.push(`${tag} → dependency ${d.slice(0, 12)} missing from manifest.dependencies`)
      }
      for (const resourceRef of (Array.isArray(parsed.resources) ? parsed.resources : [])
        .map(entry => bare(entry && typeof entry === 'object' ? (entry as { sig?: unknown }).sig : entry))) {
        if (!isSig(resourceRef)) errors.push(`${tag} has a resource with an invalid signature: ${resourceRef}`)
        else if (!onDiskResources.has(resourceRef)) errors.push(`${tag} → resource ${resourceRef.slice(0, 12)} not on disk`)
      }
      if (sig === rootLayerSig) {
        const emittedCritical = Array.isArray(parsed.criticalBees) ? parsed.criticalBees.map(bare) : []
        if (JSON.stringify(emittedCritical) !== JSON.stringify(criticalBees)) {
          errors.push(`${tag} has an incomplete, duplicated, or unordered criticalBees hint`)
        }
        for (const criticalRef of emittedCritical) {
          if (!isSig(criticalRef)) errors.push(`${tag} has a critical bee with an invalid signature: ${criticalRef}`)
          else if (!onDiskBees.has(criticalRef)) errors.push(`${tag} has critical bee ${criticalRef.slice(0, 12)} missing on disk`)
          else if (!inManifestBees.has(criticalRef)) errors.push(`${tag} has critical bee ${criticalRef.slice(0, 12)} missing from manifest.bees`)
        }
        for (const bootRef of (Array.isArray(parsed.bootBees) ? parsed.bootBees : []).map(bare)) {
          if (!isSig(bootRef)) errors.push(`${tag} has a boot bee with an invalid signature: ${bootRef}`)
          else if (!onDiskBees.has(bootRef)) errors.push(`${tag} has boot bee ${bootRef.slice(0, 12)} missing on disk`)
          else if (!inManifestBees.has(bootRef)) errors.push(`${tag} has boot bee ${bootRef.slice(0, 12)} missing from manifest.bees`)
        }
      } else if (parsed.criticalBees !== undefined || parsed.bootBees !== undefined) {
        errors.push(`${tag} declares criticalBees or bootBees outside the package root`)
      }
    }

    for (const [beeSig, depList] of beeDepsMap) {
      for (const depRef of (Array.isArray(depList) ? depList : [])) {
        const d = bare(depRef)
        if (!onDiskDeps.has(d)) errors.push(`bee ${bare(beeSig).slice(0, 12)} declares dependency ${d.slice(0, 12)} not on disk`)
        else if (!inManifestDeps.has(d)) errors.push(`bee ${bare(beeSig).slice(0, 12)} dependency ${d.slice(0, 12)} missing from manifest.dependencies`)
      }
    }

    if (errors.length) {
      console.error(`[build-module] CLOSURE CHECK FAILED — ${errors.length} dangling reference(s); manifest NOT written:`)
      for (const e of errors.slice(0, 50)) console.error(`  - ${e}`)
      if (errors.length > 50) console.error(`  …and ${errors.length - 50} more`)
      throw new Error(`build-module: closure check failed (${errors.length} dangling reference(s))`)
    }
    console.log(`[build-module] closure OK — ${onDiskLayers.size} layers, ${onDiskBees.size} bees, ${onDiskDeps.size} deps, no dangling refs`)
  }

  // Single-package manifest: always write only the current rootLayerSig.
  // Merging with prior manifest entries is a footgun — stale package keys
  // accumulate and the runtime loader picks Object.keys(packages)[0], which
  // is the *first inserted* (chronologically oldest) entry. That stale entry
  // then references signatures that no longer exist on disk, breaking install.
  const manifestPath = join(DIST_ROOT, MANIFEST_FILE)
  const manifest = { packages: { [rootLayerSig]: packageEntry } }
  const nextJson = JSON.stringify(manifest, null, 2) + '\n'
  const prevJson = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
  if (nextJson !== prevJson) {
    writeFileSync(manifestPath, nextJson, 'utf8')
    console.log(`[build-module] manifest updated (root ${rootLayerSig.slice(0, 12)})`)
  } else {
    console.log(`[build-module] manifest unchanged — skipped write`)
  }

  // ── the package, as a pool member ────────────────────────────────
  //
  // What a host PUBLISHES is the `host:packages` pool, not a document
  // (documentation/host-packages-pool.md). dist carries its one member so the
  // ship can append it without reading a manifest: the signature, and the
  // branch it was built from underneath — the only thing about this package
  // that is not derivable from its own sealed tree.
  //
  // manifest.json above stays as the BUILD's own bookkeeping: it is what the
  // skip-write compare reads, and copy-content never mirrors it to a target
  // any more, so it does not reach a host.
  //
  // The address is DERIVED — sha256 of the meaning, byte for byte what core's
  // registerPoolMeaning mints and what every client computes for itself.
  const poolAddress = createHash('sha256').update('host:packages', 'utf8').digest('hex')
  const poolDir = join(DIST_ROOT, poolAddress)
  ensureDir(poolDir)
  const memberBytes = `${rootLayerSig}\n${resolveGenesisLabel()}`
  const memberPath = join(poolDir, '00000000')
  if (!existsSync(memberPath) || readFileSync(memberPath, 'utf8') !== memberBytes) {
    writeFileSync(memberPath, memberBytes, 'utf8')
  }
  writeFileSync(join(poolDir, 'index.html'), '00000000', 'utf8')

  // ── the transfer pack (hypercomb-runtime/src/transfer-pack.ts) ─────
  //
  // Every file of this package in ONE content-addressed file, so a cold
  // install is one request instead of hundreds, and one member of the
  // `transfer:packs` pool — named by the root, holding the pack's signature.
  // A DERIVED record: the reader re-hashes every member against its own name,
  // and a reader with no pack installs the same package from loose files.
  const packMembers: Array<[string, Uint8Array]> = [
    ...[...layers].map(([sig, json]): [string, Uint8Array] => [sig, textToBytes(json)]),
    ...dependencyBytes,
    ...resourceBytes,
  ]
  const packPlain = encodeTransferPack(packMembers)
  const packBytes = await gzipBytes(packPlain)
  const packSig = await SignatureService.sign(toArrayBuffer(packBytes))
  writeSigFile(DIST_ROOT, packSig, packBytes)
  const packPoolDir = join(DIST_ROOT, createHash('sha256').update(TRANSFER_PACKS_MEANING, 'utf8').digest('hex'))
  ensureDir(packPoolDir)
  writeFileSync(join(packPoolDir, rootLayerSig), packSig, 'utf8')
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1)
  console.log(`[build-module] transfer pack ${packSig.slice(0, 12)}: ${packMembers.length} files, ${mb(packPlain.byteLength)} MB → ${mb(packBytes.byteLength)} MB gzip`)

  // --- Phase 5: persist Merkle cache + GC ---

  const rootHash = await computeRootHash(allUnitSigs)
  saveCache({
    version: 10,
    shape: BUILD_SHAPE,
    docsShape: DOCS_SHAPE,
    rootHash,
    rootLayerSig,
    namespaces: newNamespaces,
    bees: newBees,
    atoms: newAtoms,
    layerCache: newLayerCache,
    docCache: newDocCache,
    beeDepCache: newBeeDepCache,
  })

  const liveSigs = new Set([...dependencyBytes.keys(), ...resourceBytes.keys()])
  for (const name of readdirSync(OUTPUT_CACHE_DIR)) {
    const sig = name.replace(/\.js$/, '')
    if (isSig(sig) && !liveSigs.has(sig)) rmSync(join(OUTPUT_CACHE_DIR, name), { force: true })
  }

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2)

  // The build's only job is to produce dist/. DELIVERY is copy-content.ts
  // (the host's content dir — the relay serves it) plus stamp-install-channel
  // .ts (the root into the publisher-signed hive index). There is no separate
  // deploy step and no second destination: Azure blob storage was the ORIGINAL
  // delivery standard and is not a host — it holds no publisher key and signs
  // no sentinel, so it can never vouch for a root.
  console.log(`[build-module] root signature: ${rootLayerSig}`)
  console.log(`[build-module] output: ${DIST_ROOT}`)
  console.log(`[build-module] completed in ${elapsed}s`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
