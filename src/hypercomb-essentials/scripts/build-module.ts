// hypercomb-essentials/scripts/build-module.ts
// builds folder namespaces into signature-addressed esm files
// outputs a root layer (directory name = root layer signature) containing:
// - __dependencies__/<sig>  (real source code, no *-keys.* ever bundled)
// - __drones__/<sig>        (real drone code)
// - __layers__/<sig>.install.json (root + per-domain layer install manifests)
// plus a stable dev/dist manifest file (package-name.manifest.js) that points at /dev/<rootSig>/
//
// rules:
// - namespaces: @<domain>/<up to 2 subfolders>
// - folders define modules; files never define modules
// - only explicit symbol exports (no export *)
// - exclude any file ending with "-keys.ts/js" from dependencies entirely
// - exclude any "*.drone.ts/js" from dependencies entirely
// - if any non-keys code imports a "-keys" module, build hard-fails
// - no sourcemaps (dependencies/drones remain code-only files)

import { createHash } from 'crypto'
import { build, type Plugin } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import ts from 'typescript'
import { fileURLToPath } from 'url'

// -------------------------------------------------
// anchors
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const PROJECT_ROOT = resolve(__dirname, '..')
const SRC_ROOT = resolve(PROJECT_ROOT, 'src')
const DIST_ROOT = resolve(PROJECT_ROOT, 'dist')

// dev root (hypercomb-web)
const DEV_ROOT = resolve(PROJECT_ROOT, '../hypercomb-web/public/dev')

// namespace depth: @domain/<seg>/<seg>
const NAMESPACE_DEPTH = 2

const TARGET = 'es2022'

// output dirs inside root layer folder
const DEP_DIRNAME = '__dependencies__'
const DRONE_DIRNAME = '__drones__'
const LAYER_DIRNAME = '__layers__'

// installer suffix expectation
const LAYER_INSTALL_SUFFIX = '.install.json'

// platform/vendor externals (do not bundle)
const EXTERNALS = ['@hypercomb/core', 'pixi.js']

// build flags
const MINIFY = !process.argv.includes('--no-minify')

// -------------------------------------------------
// helpers
// -------------------------------------------------

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const toPosix = (p: string): string => p.replace(/\\/g, '/')

const relFrom = (root: string, full: string): string =>
  toPosix(full.replace(root, '').replace(/^[\\/]/, ''))

const isTsOrJs = (f: string): boolean =>
  (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts')

const isDrone = (f: string): boolean =>
  f.endsWith('.drone.ts') || f.endsWith('.drone.js')

const isKeysFile = (f: string): boolean =>
  f.endsWith('-keys.ts') || f.endsWith('-keys.js')

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

const sha256HexText = (text: string): string =>
  sha256Hex(Buffer.from(text, 'utf8'))

const isSignature = (s: string): boolean =>
  /^[0-9a-f]{64}$/i.test(s)

const getPackageName = (): string => {
  const pkgPath = join(PROJECT_ROOT, 'package.json')
  if (!existsSync(pkgPath)) return 'manifest'
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
    return (pkg.name ?? 'manifest').replace(/^@/, '').replace(/[\/\\]/g, '-')
  } catch {
    return 'manifest'
  }
}

const MANIFEST_BASENAME = `${getPackageName()}.manifest.js`

const DEV_MANIFEST_FILE = join(DEV_ROOT, MANIFEST_BASENAME)
const DIST_MANIFEST_FILE = join(DIST_ROOT, MANIFEST_BASENAME)

const tryGetPreviousRootSig = (manifestPath: string): string | null => {
  if (!existsSync(manifestPath)) return null
  const txt = readFileSync(manifestPath, 'utf8')
  const m = txt.match(/\/dev\/([0-9a-f]{64})\//i)
  return m ? m[1] : null
}

const safeRmDir = (dir: string): void => {
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

// -------------------------------------------------
// export parsing (explicit symbol exports only)
// -------------------------------------------------

type ExportInfo = { value: string[]; type: string[] }

const parseExports = (file: string): ExportInfo => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: ExportInfo = { value: [], type: [] }

  source.forEachChild(node => {
    if (ts.canHaveModifiers(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isEnumDeclaration(node)) {
        if (node.name) out.value.push(node.name.text)
      }

      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(d => {
          if (ts.isIdentifier(d.name)) out.value.push(d.name.text)
        })
      }

      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        out.type.push(node.name.text)
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      node.exportClause.elements.forEach(e => {
        const name = (e.name || e.propertyName)?.text
        if (name) out.value.push(name)
      })
    }
  })

  out.value = Array.from(new Set(out.value)).sort()
  out.type = Array.from(new Set(out.type)).sort()

  return out
}

// -------------------------------------------------
// discovery
// -------------------------------------------------

type NamespaceBucket = { domain: string; ns: string; nsRootDir: string; files: string[] }

const discoverDomains = (): string[] => {
  if (!existsSync(SRC_ROOT)) return []
  return readdirSync(SRC_ROOT).filter(name => {
    if (name === 'types') return false
    const full = join(SRC_ROOT, name)
    return existsSync(full) && statSync(full).isDirectory()
  }).sort()
}

const getNamespaceForFile = (domain: string, file: string): { ns: string; nsRootDir: string } => {
  const domainRoot = join(SRC_ROOT, domain)
  const rel = relFrom(domainRoot, file)
  const parts = rel.split('/')
  parts.pop() // filename

  if (parts.length === 0) return { ns: `@${domain}`, nsRootDir: domainRoot }

  const slice = parts.slice(0, NAMESPACE_DEPTH)
  const nsPath = slice.join('/')
  return { ns: `@${domain}/${nsPath}`, nsRootDir: join(domainRoot, ...slice) }
}

const discoverNamespaces = (domains: string[]): Map<string, NamespaceBucket> => {
  const buckets = new Map<string, NamespaceBucket>()

  for (const domain of domains) {
    const domainRoot = join(SRC_ROOT, domain)
    const files = walkFiles(domainRoot).filter(isTsOrJs)

    for (const file of files) {
      const { ns, nsRootDir } = getNamespaceForFile(domain, file)
      const b = buckets.get(ns) ?? { domain, ns, nsRootDir, files: [] }
      b.files.push(file)
      buckets.set(ns, b)
    }
  }

  for (const b of buckets.values()) {
    b.files = Array.from(new Set(b.files)).sort()
  }

  return buckets
}

const discoverDrones = (domains: string[]): { domain: string; file: string }[] => {
  const out: { domain: string; file: string }[] = []
  for (const domain of domains) {
    const domainRoot = join(SRC_ROOT, domain)
    const files = walkFiles(domainRoot).filter(f => isTsOrJs(f) && isDrone(f))
    for (const file of files) out.push({ domain, file })
  }
  return out.sort((a, b) => (a.domain + a.file).localeCompare(b.domain + b.file))
}

// -------------------------------------------------
// esbuild plugins
// -------------------------------------------------

const makeDomainExternalPlugin = (domains: string[]): Plugin => {
  const roots = new Set(domains.map(d => `@${d}`))
  return {
    name: 'externalize-domain-imports',
    setup: (b) => {
      b.onResolve({ filter: /^@/ }, (args) => {
        for (const root of roots) {
          if (args.path === root || args.path.startsWith(`${root}/`)) {
            return { path: args.path, external: true }
          }
        }
        return null
      })
    }
  }
}

const makeBlockKeysImportsPlugin = (): Plugin => {
  const isKeysPath = (p: string): boolean => {
    const pp = p.replace(/\\/g, '/')
    if (pp.endsWith('-keys')) return true
    if (pp.endsWith('-keys.ts') || pp.endsWith('-keys.js')) return true
    return /\/[^\/]+-keys(\.ts|\.js)?$/i.test(pp)
  }

  return {
    name: 'block-keys-imports',
    setup: (b) => {
      b.onResolve({ filter: /.*/ }, (args) => {
        // only block for normal code resolutions (relative/absolute/package)
        if (!args.path) return null
        if (!isKeysPath(args.path)) return null

        // allow the build system itself to read keys files when scanning src;
        // this block is specifically for bundling: no keys in output.
        return {
          errors: [
            {
              text: `[build-module] keys modules are not allowed in bundles: "${args.path}" imported by "${args.importer}"`
            }
          ]
        }
      })
    }
  }
}

// -------------------------------------------------
// barrel generation (dependencies entry)
// -------------------------------------------------

const makeBarrelContents = (bucket: NamespaceBucket): string => {
  const nsRootDir = bucket.nsRootDir

  type ModuleExport = { modRel: string; exp: ExportInfo }
  const modules: ModuleExport[] = []

  for (const file of bucket.files) {
    if (!isTsOrJs(file)) continue
    if (isDrone(file)) continue
    if (isKeysFile(file)) continue

    const base = file.replace(extname(file), '').split(/[\\/]/).pop() ?? ''
    if (base === 'index') continue

    const exp = parseExports(file)
    if (!exp.value.length && !exp.type.length) continue

    const rel = relFrom(nsRootDir, file).replace(extname(file), '')
    const modRel = './' + rel

    modules.push({ modRel, exp })
  }

  modules.sort((a, b) => a.modRel.localeCompare(b.modRel))

  let out = `// auto-generated by scripts/build-module.ts\n// namespace barrel for ${bucket.ns}\n// do not edit manually\n\n`
  for (const m of modules) {
    if (m.exp.value.length) out += `export { ${m.exp.value.join(', ')} } from '${m.modRel}'\n`
    if (m.exp.type.length) out += `export type { ${m.exp.type.join(', ')} } from '${m.modRel}'\n`
  }
  if (modules.length === 0) out += `export {}\n`

  return out
}

// -------------------------------------------------
// builders
// -------------------------------------------------

const pickJsOutput = (out: { path: string; contents: Uint8Array }[]): Uint8Array => {
  // stdin builds often return "<stdout>" so do not rely on ".js"
  const js = out.find(f => !toPosix(f.path).endsWith('.map')) ?? null
  if (!js) throw new Error('[build-module] missing js output (no non-map output file)')
  return js.contents
}

const buildDependency = async (bucket: NamespaceBucket, plugins: Plugin[]): Promise<Uint8Array> => {
  const result = await build({
    absWorkingDir: PROJECT_ROOT,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: TARGET,
    minify: MINIFY,
    sourcemap: false,
    sourcesContent: false,
    external: EXTERNALS,
    plugins,
    stdin: { contents: makeBarrelContents(bucket), loader: 'ts', resolveDir: bucket.nsRootDir }
  })

  return pickJsOutput(result.outputFiles)
}

const buildDrone = async (file: string, plugins: Plugin[]): Promise<Uint8Array> => {
  const result = await build({
    absWorkingDir: PROJECT_ROOT,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: TARGET,
    minify: MINIFY,
    sourcemap: false,
    sourcesContent: false,
    external: EXTERNALS,
    plugins,
    entryPoints: [file]
  })

  return pickJsOutput(result.outputFiles)
}

// -------------------------------------------------
// output writers
// -------------------------------------------------

type BuiltDep = { ns: string; domain: string; sig: string; bytes: Uint8Array }
type BuiltDrone = { domain: string; sig: string; bytes: Uint8Array; sourceFile: string }

const writeRootSigFile = (rootBase: string, rootSig: string, dirName: string, fileName: string, bytes: Uint8Array): void => {
  const dir = join(rootBase, rootSig, dirName)
  ensureDir(dir)
  writeFileSync(join(dir, fileName), bytes)
}

const writeRootTextFile = (rootBase: string, rootSig: string, dirName: string, fileName: string, text: string): void => {
  const dir = join(rootBase, rootSig, dirName)
  ensureDir(dir)
  writeFileSync(join(dir, fileName), text, 'utf8')
}

const writeManifest = (rootSig: string, imports: Record<string, string>): void => {
  const manifest = { root: `/dev/${rootSig}/`, imports }

  const text =
`// auto-generated by scripts/build-module.ts
// do not edit manually

export const manifest = ${JSON.stringify(manifest, null, 2)}
export const imports = manifest.imports
export default manifest
`

  ensureDir(dirname(DEV_MANIFEST_FILE))
  ensureDir(dirname(DIST_MANIFEST_FILE))

  writeFileSync(DEV_MANIFEST_FILE, text, 'utf8')
  writeFileSync(DIST_MANIFEST_FILE, text, 'utf8')
}

// -------------------------------------------------
// layer install json
// -------------------------------------------------

type LayerInstall = { domain: string; dependencies: string[]; drones: string[]; children: string[]; resources: string[] }

const stableJson = (obj: unknown): string => JSON.stringify(obj, null, 2)

const makeDomainLayer = (domain: string, depSigs: string[], droneSigs: string[]): { sig: string; text: string } => {
  const layer: LayerInstall = { domain, dependencies: depSigs.slice().sort(), drones: droneSigs.slice().sort(), children: [], resources: [] }
  const text = stableJson(layer)
  return { sig: sha256HexText(text), text }
}

const makeRootLayer = (name: string, childSigs: string[]): { sig: string; text: string } => {
  const layer: LayerInstall = { domain: name, dependencies: [], drones: [], children: childSigs.slice().sort(), resources: [] }
  const text = stableJson(layer)
  return { sig: sha256HexText(text), text }
}

// -------------------------------------------------
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  ensureDir(DIST_ROOT)
  ensureDir(DEV_ROOT)

  // remove the previous root sig folder referenced by this package's manifest (only)
  const prevDev = tryGetPreviousRootSig(DEV_MANIFEST_FILE)
  const prevDist = tryGetPreviousRootSig(DIST_MANIFEST_FILE)
  if (prevDev && isSignature(prevDev)) safeRmDir(join(DEV_ROOT, prevDev))
  if (prevDist && isSignature(prevDist)) safeRmDir(join(DIST_ROOT, prevDist))

  const domains = discoverDomains()
  if (!domains.length) return

  const plugins: Plugin[] = [makeBlockKeysImportsPlugin(), makeDomainExternalPlugin(domains)]

  // build dependencies (namespace barrels)
  const buckets = Array.from(discoverNamespaces(domains).values()).sort((a, b) => a.ns.localeCompare(b.ns))
  const deps: BuiltDep[] = []

  for (const b of buckets) {
    const bytes = await buildDependency(b, plugins)
    const sig = sha256Hex(bytes)
    deps.push({ ns: b.ns, domain: b.domain, sig, bytes })
    console.log(`[build-module] dep ${b.ns} -> ${sig}`)
  }

  // build drones (each .drone.ts)
  const droneFiles = discoverDrones(domains)
  const drones: BuiltDrone[] = []

  for (const d of droneFiles) {
    const bytes = await buildDrone(d.file, plugins)
    const sig = sha256Hex(bytes)
    drones.push({ domain: d.domain, sig, bytes, sourceFile: d.file })
    console.log(`[build-module] drone ${relFrom(SRC_ROOT, d.file)} -> ${sig}`)
  }

  // build per-domain layers
  const domainLayers: { domain: string; sig: string; text: string }[] = []
  for (const domain of domains) {
    const depSigs = deps.filter(x => x.domain === domain).map(x => x.sig)
    const droneSigs = drones.filter(x => x.domain === domain).map(x => x.sig)
    const layer = makeDomainLayer(domain, depSigs, droneSigs)
    domainLayers.push({ domain, sig: layer.sig, text: layer.text })
  }

  // root layer signature = output folder name
  const rootName = getPackageName()
  const rootLayer = makeRootLayer(rootName, domainLayers.map(x => x.sig))
  const rootSig = rootLayer.sig

  // write dependencies + drones + layers into dev/dist under /<rootSig>/
  for (const d of deps) {
    writeRootSigFile(DEV_ROOT, rootSig, DEP_DIRNAME, d.sig, d.bytes)
    writeRootSigFile(DIST_ROOT, rootSig, DEP_DIRNAME, d.sig, d.bytes)
  }

  for (const dr of drones) {
    writeRootSigFile(DEV_ROOT, rootSig, DRONE_DIRNAME, dr.sig, dr.bytes)
    writeRootSigFile(DIST_ROOT, rootSig, DRONE_DIRNAME, dr.sig, dr.bytes)
  }

  // write root + domain layer install manifests
  writeRootTextFile(DEV_ROOT, rootSig, LAYER_DIRNAME, `${rootSig}${LAYER_INSTALL_SUFFIX}`, rootLayer.text)
  writeRootTextFile(DIST_ROOT, rootSig, LAYER_DIRNAME, `${rootSig}${LAYER_INSTALL_SUFFIX}`, rootLayer.text)

  for (const l of domainLayers) {
    writeRootTextFile(DEV_ROOT, rootSig, LAYER_DIRNAME, `${l.sig}${LAYER_INSTALL_SUFFIX}`, l.text)
    writeRootTextFile(DIST_ROOT, rootSig, LAYER_DIRNAME, `${l.sig}${LAYER_INSTALL_SUFFIX}`, l.text)
  }

  // manifest (stable file name) points at /dev/<rootSig>/
  const imports: Record<string, string> = {}
  for (const d of deps) {
    imports[d.ns] = `/dev/${rootSig}/${DEP_DIRNAME}/${d.sig}`
  }

  writeManifest(rootSig, imports)

  console.log(`[build-module] root layer -> ${rootSig}${LAYER_INSTALL_SUFFIX}`)
  console.log(`[build-module] wrote ${DEV_MANIFEST_FILE}`)
}
  
main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
