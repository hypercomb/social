// hypercomb-essentials/scripts/build-module.ts
// hypercomb-essentials/scripts/build-module.ts
// MINIMAL UPGRADE:
// - exclude *.keys.ts / *.keys.js at discovery time
// - add install.manifest.json at dist/<rootSignature>/install.manifest.json with only signatures (no root field)
// - nothing else changed (deploy, layers, signing untouched)

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, relative, resolve } from 'path'
import { build } from 'esbuild'

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
const PLATFORM_EXTERNALS = ['@hypercomb/core', 'pixi.js']

// hard rule: never generate @<domain> root aggregator
const EMIT_DOMAIN_ROOT_NAMESPACE = false

// content manifest (replaces latest.json — supports multiple entry points)
const MANIFEST_FILE = 'manifest.json'

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

interface BuildCache {
  version: 3
  rootHash: string                            // Merkle root of all unit hashes
  rootLayerSig: string                        // last output root signature
  namespaces: Record<string, UnitCache>
  bees: Record<string, UnitCache>
  layerCache?: Record<string, LayerCacheEntry>
  docCache?: Record<string, DocCacheEntry>
  beeDepCache?: Record<string, BeeDepCacheEntry>
}

const CACHE_FILE = join(PROJECT_ROOT, '.build-cache.json')
const OUTPUT_CACHE_DIR = join(DIST_ROOT, '.cache')

const loadCache = (): BuildCache | null => {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    if (raw?.version === 3) return raw
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

const deployToAzure = (): void => {
  if (process.argv.includes('--local')) return

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (!existsSync(ps1)) return

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
    { stdio: 'inherit' }
  )

  if (result.status !== 0) throw new Error('deployment failed')
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

// exclude key-only files from artifact pipeline
const isKeysFile = (f: string): boolean => {
  if (f.endsWith('.keys.ts') || f.endsWith('.keys.js') || f.endsWith('-keys.ts') || f.endsWith('-keys.js')) return true
  const base = f.replace(/\\/g, '/').split('/').pop() ?? ''
  return base === 'essentials-keys.ts' || base === 'essentials-keys.js'
}

const isBee = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js') || f.endsWith('.worker.ts') || f.endsWith('.worker.js')

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
}

const extractBeeDoc = (sourceText: string): BeeDocEntry | null => {
  // class name + kind from extends clause
  const classMatch = sourceText.match(
    /export\s+class\s+(\w+)\s+extends\s+(QueenBee|Worker|Drone|Bee)\b/
  )
  if (!classMatch) return null

  const className = classMatch[1]
  const extendsName = classMatch[2]
  const kind: BeeDocEntry['kind'] =
    extendsName === 'QueenBee' ? 'queen'
    : extendsName === 'Drone' ? 'drone'
    : extendsName === 'Worker' ? 'worker'
    : 'bee'

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

const jsFileName = (sig: string): string => `${sig}.js`

const writeSigJsFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, jsFileName(sig)), bytes)
}

const layerFileName = (sig: string): string => `${sig}.json`

const writeLayerJsonFile = (dir: string, sig: string, json: string): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, layerFileName(sig)), json, 'utf8')
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

const specifierFromNamespaceRelDir = (namespaceRelDir: string): string =>
  `@${namespaceRelDir}`

const prefixesForNamespaceRelDir = (nsRelDir: string): string[] => {
  const parts = splitPath(nsRelDir)
  const out: string[] = []
  const start = EMIT_DOMAIN_ROOT_NAMESPACE ? 1 : 2
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

const buildLayersFromTree = async (
  node: DirNode,
  resourcesByDir: Map<string, { bees: string[]; deps: string[] }>,
  out: Map<string, string>,
  rootDependencies: string[],
  docsByDir: Map<string, Record<string, BeeDocEntry>>,
  prevLayerCache?: Record<string, LayerCacheEntry>
): Promise<string | null> => {
  const layers: string[] = []
  for (const c of node.children) {
    const childSig = await buildLayersFromTree(c, resourcesByDir, out, rootDependencies, docsByDir, prevLayerCache)
    if (childSig) layers.push(childSig)
  }

  const entry = resourcesByDir.get(node.rel) ?? { bees: [], deps: [] }

  if (!entry.bees.length && !entry.deps.length && !layers.length && node.rel) return null

  // beeline: compute layer input signature from all components
  const beeSigs = uniqSorted(entry.bees)
  const depSigs = node.rel ? [] : rootDependencies
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
  const shapeDescriptor = 'cells:name:bees:dependencies'

  const layerInputParts = [
    shapeDescriptor,
    node.rel,
    beeSigs.join(':'),
    depSigs.join(':'),
    layers.join(':'),
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
  allNamespaceSpecifiers: string[]
): Promise<{ sig: string; bytes: Uint8Array } | null> => {
  const namespaceSpecifier = specifierFromNamespaceRelDir(namespaceRelDir)
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
    ...PLATFORM_EXTERNALS,
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
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled || compiled.trim().length === 0) {
    console.log(`[build-module] skipping empty namespace: ${namespaceSpecifier}`)
    return null
  }

  const bytes = textToBytes(`// ${namespaceSpecifier}\n${compiled}`)
  const sig = await SignatureService.sign(toArrayBuffer(bytes))
  return { sig, bytes }
}

const buildBee = async (entry: string, externals: string[]): Promise<Uint8Array> => {
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
  })

  const compiled = r.outputFiles?.[0]?.text
  if (!compiled) throw new Error(`no output: ${entry}`)
  return textToBytes(compiled)
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

  // Quick mtime scan: check if ANY file has a changed mtime
  let anyMtimeChanged = !cache
  if (cache && !anyMtimeChanged) {
    // Check namespace files
    for (const ns of allNs) {
      const members = namespaceToMembers.get(ns) ?? []
      const cachedUnit = cache.namespaces[ns]
      if (!cachedUnit) { anyMtimeChanged = true; break }
      for (const m of members) {
        const prev = cachedUnit.files[m.entry]
        if (!prev) { anyMtimeChanged = true; break }
        const mt = statSync(m.entry).mtimeMs
        if (mt !== prev.mtime) { anyMtimeChanged = true; break }
      }
      if (anyMtimeChanged) break
    }
    // Check bee files
    if (!anyMtimeChanged) {
      for (const src of beeSources) {
        const cachedUnit = cache.bees[src.relPath]
        if (!cachedUnit) { anyMtimeChanged = true; break }
        const prev = cachedUnit.files[src.entry]
        if (!prev) { anyMtimeChanged = true; break }
        const mt = statSync(src.entry).mtimeMs
        if (mt !== prev.mtime) { anyMtimeChanged = true; break }
      }
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
  if (!anyMtimeChanged && cache) {
    const manifestFile = join(DIST_ROOT, MANIFEST_FILE)
    const skipDeploy = process.argv.includes('--local')

    // Verify output still exists (not wiped externally)
    if (existsSync(manifestFile)) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(3)
      console.log(`[build-module] Merkle root unchanged — skipping build entirely`)
      console.log(`[build-module] root signature: ${cache.rootLayerSig}`)
      if (skipDeploy) {
        console.log(`[build-module] --local: skipping Azure deploy`)
      } else {
        console.log(`[build-module] deploying cached output to Azure`)
        deployToAzure()
      }
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

    const { leaves, inputSig } = await resolveUnitInputs(
      members.map(m => m.entry),
      cache?.namespaces[ns]?.files,
      entrySource
    )

    allUnitSigs.push(inputSig)
    const cachedUnit = cache?.namespaces[ns]
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      const bytes = new Uint8Array(readFileSync(cachedFile))
      dependencyBytes.set(cachedUnit.outputSig, bytes)
      addToBucket(resourcesByDir, ns, jsFileName(cachedUnit.outputSig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(cachedUnit.outputSig), 'dep')
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      cacheHits++
    } else {
      const built = await buildNamespaceDependency(ns, members, allSpecifiers)
      if (!built) continue
      dependencyBytes.set(built.sig, built.bytes)
      addToBucket(resourcesByDir, ns, jsFileName(built.sig), 'dep')
      for (const f of members) addToBucket(resourcesByDir, f.relDir, jsFileName(built.sig), 'dep')
      writeFileSync(join(OUTPUT_CACHE_DIR, `${built.sig}.js`), built.bytes)
      newNamespaces[ns] = { files: leaves, inputSig, outputSig: built.sig }
      cacheMisses++
    }
  }

  console.log(`[build-module] dependencies: ${cacheHits} cached, ${cacheMisses} built`)

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
      doc = extractBeeDoc(tsSource)
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
  const beeExternals = [...PLATFORM_EXTERNALS, ...allSpecifiers]
  let beeCacheHits = 0
  let beeCacheMisses = 0

  for (const src of beeSources) {
    const { leaves, inputSig } = await resolveUnitInputs(
      [src.entry],
      cache?.bees[src.relPath]?.files
    )

    allUnitSigs.push(inputSig)
    const cachedUnit = cache?.bees[src.relPath]
    const cachedFile = cachedUnit ? join(OUTPUT_CACHE_DIR, `${cachedUnit.outputSig}.js`) : null

    let bytes: Uint8Array
    let sig: string

    if (cachedUnit?.inputSig === inputSig && cachedFile && existsSync(cachedFile)) {
      bytes = new Uint8Array(readFileSync(cachedFile))
      sig = cachedUnit.outputSig
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: cachedUnit.outputSig }
      beeCacheHits++
    } else {
      bytes = await buildBee(src.entry, beeExternals)
      sig = await SignatureService.sign(toArrayBuffer(bytes))
      writeFileSync(join(OUTPUT_CACHE_DIR, `${sig}.js`), bytes)
      newBees[src.relPath] = { files: leaves, inputSig, outputSig: sig }
      beeCacheMisses++
    }

    resourceBytes.set(sig, bytes)
    addToBucket(resourcesByDir, src.relDir, jsFileName(sig), 'bee')

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
      beeDoc = extractBeeDoc(tsSource)
      if (beeFileLeaf) {
        newDocCache[src.entry] = { contentSignature: beeFileLeaf.sig, doc: beeDoc }
      }
      docCacheMisses++
    }

    if (beeDoc) {
      const dirDocs = docsByDir.get(src.relDir) ?? {}
      dirDocs[sig] = beeDoc
      docsByDir.set(src.relDir, dirDocs)
    }

    // beeline: cache bee dependency mapping by outputSig
    const prevBeeDep = cache?.beeDepCache?.[src.relPath]
    if (prevBeeDep && prevBeeDep.outputSig === sig) {
      // beeline hit: same compiled output → same deps
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

  // --- Phase 4: layers + manifest (always regenerated, cheap) ---

  // merge queen docs into docsByDir (queens are keyed by className, not sig)
  for (const [dir, queenDocs] of queenDocsByDir) {
    const dirDocs = docsByDir.get(dir) ?? {}
    Object.assign(dirDocs, queenDocs)
    docsByDir.set(dir, dirDocs)
  }

  const tree = readDirTree(SRC_ROOT, '')
  const rootLayerSig = await buildLayersFromTree(tree, resourcesByDir, layers, rootDependencies, docsByDir, cache?.layerCache)

  console.log(`[build-module] layers: ${layerCacheHits} cached, ${layerCacheMisses} built`)
  console.log(`[build-module] doc extraction: ${docCacheHits} cached, ${docCacheMisses} parsed`)

  // report doc extraction stats
  let docCount = 0
  for (const dirDocs of docsByDir.values()) docCount += Object.keys(dirDocs).length
  console.log(`[build-module] docs: ${docCount} bee doc(s) extracted across ${docsByDir.size} lineage(s)`)

  // write package — flat at dist root
  const layersDir  = join(DIST_ROOT, '__layers__')
  const resDir     = join(DIST_ROOT, '__bees__')
  const depDir     = join(DIST_ROOT, '__dependencies__')

  ensureDir(layersDir)
  ensureDir(resDir)
  ensureDir(depDir)

  for (const [sig, json] of layers) writeLayerJsonFile(layersDir, sig, json)
  for (const [sig, bytes] of dependencyBytes) writeSigJsFile(depDir, sig, bytes)
  for (const [sig, bytes] of resourceBytes) writeSigJsFile(resDir, sig, bytes)

  // content manifest — package entry keyed by root signature.
  // No version field; the package's identity is its rootLayerSig and
  // its meaning is its sig arrays. Adding a version pollutes the
  // canonical bytes with ceremony that doesn't affect what the
  // package IS.
  const packageEntry = {
    layers: Array.from(layers.keys()).sort((a, b) => a.localeCompare(b)),
    bees: Array.from(resourceBytes.keys()).sort((a, b) => a.localeCompare(b)),
    dependencies: dependencySigs,
    beeDeps: Object.fromEntries(beeDepsMap),
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

  // --- Phase 5: persist Merkle cache + GC ---

  const rootHash = await computeRootHash(allUnitSigs)
  saveCache({
    version: 3,
    rootHash,
    rootLayerSig,
    namespaces: newNamespaces,
    bees: newBees,
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

  // deploy (skip with --local flag)
  const skipDeploy = process.argv.includes('--local')
  if (skipDeploy) {
    console.log(`[build-module] --local: skipping Azure deploy`)
    console.log(`[build-module] root signature: ${rootLayerSig}`)
    console.log(`[build-module] output: ${DIST_ROOT}`)
    console.log(`[build-module] completed in ${elapsed}s`)
  } else {
    deployToAzure()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
