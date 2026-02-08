// scripts/build-module.ts
// production build

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, join, relative, resolve, extname, basename } from 'path'
import { build } from 'esbuild'
import { SignatureService } from '@hypercomb/core'

// -------------------------------------------------
// esm globals
// -------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// -------------------------------------------------
// config
// -------------------------------------------------

const SRC_ROOT = resolve('./src')
const DIST_ROOT = resolve('./dist')
const TARGET = 'es2022'

// -------------------------------------------------
// helpers
// -------------------------------------------------

const relPosix = (from: string, to: string): string =>
  relative(from, to).replace(/\\/g, '/') || ''

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

const isDrone = (file: string): boolean =>
  file.endsWith('.drone.ts') || file.endsWith('.drone.js')

const stripExt = (p: string): string =>
  p.slice(0, -extname(p).length)

const textToBytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text)

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const isSig = (v: string): boolean => /^[a-f0-9]{64}$/i.test(v)

const writeSigFile = (dir: string, sig: string, bytes: Uint8Array): void => {
  if (!isSig(sig)) throw new Error(`invalid signature: ${sig}`)
  writeFileSync(join(dir, sig), bytes)
}

// -------------------------------------------------
// discovery
// -------------------------------------------------

type SourceFile = {
  entry: string
  relDir: string
  kind: 'drone' | 'dependency'
}

const discoverSources = (): SourceFile[] => {
  return walkFiles(SRC_ROOT)
    .filter(file => {
      // only ts/js
      if (!file.endsWith('.ts') && !file.endsWith('.js')) return false
      if (file.endsWith('.d.ts')) return false

      // compute rel dir
      const relDir = relPosix(SRC_ROOT, dirname(file))

      // ❌ skip root-level files
      if (!relDir) return false

      return true
    })
    .map(file => {
      const relDir = relPosix(SRC_ROOT, dirname(file))
      return {
        entry: file,
        relDir,
        kind: isDrone(file) ? 'drone' : 'dependency'
      }
    })
}


// -------------------------------------------------
// compile
// -------------------------------------------------

const compileDependency = async (entry: string): Promise<string> => {
  const r = await build({
    entryPoints: [entry],
    bundle: false,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json')
  })

  if (!r.outputFiles?.length) {
    throw new Error(`no output for dependency ${entry}`)
  }

  return r.outputFiles[0].text
}

const compileDrone = async (entry: string): Promise<string> => {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: TARGET,
    tsconfig: resolve('./tsconfig.json'),
    external: [
      '@hypercomb/core',
      'pixi.js',
      '@essentials/*'
    ],
    sourcemap: false,
    minify: false
  })

  if (!r.outputFiles?.length) {
    throw new Error(`no output for drone ${entry}`)
  }

  return r.outputFiles[0].text
}

// -------------------------------------------------
// layers
// -------------------------------------------------

type DirNode = { rel: string; children: DirNode[] }

const readDirTree = (root: string, rel: string): DirNode => {
  const full = join(root, rel)
  const children: DirNode[] = []

  for (const name of readdirSync(full)) {
    const child = join(full, name)
    if (statSync(child).isDirectory()) {
      children.push(readDirTree(root, rel ? `${rel}/${name}` : name))
    }
  }

  children.sort((a, b) => a.rel.localeCompare(b.rel))
  return { rel, children }
}

const signJson = async (value: unknown) => {
  const json = JSON.stringify(value)
  const sig = await SignatureService.sign(
    toArrayBuffer(textToBytes(json))
  )
  return { sig, json }
}

const buildLayers = async (
  node: DirNode,
  resourcesByDir: Map<string, { drones: string[]; deps: string[] }>,
  out: Map<string, string>
): Promise<string> => {
  const children: string[] = []

  for (const c of node.children) {
    children.push(await buildLayers(c, resourcesByDir, out))
  }

  const entry = resourcesByDir.get(node.rel) ?? { drones: [], deps: [] }

  const layer = {
    version: 1,
    name: node.rel.split('/').pop() || 'root',
    rel: node.rel,
    drones: entry.drones,
    dependencies: entry.deps,
    children
  }

  const { sig, json } = await signJson(layer)
  out.set(sig, json)
  return sig
}

// -------------------------------------------------
// main
// -------------------------------------------------

const main = async (): Promise<void> => {
  rmSync(DIST_ROOT, { recursive: true, force: true })
  ensureDir(DIST_ROOT)

  const sources = discoverSources()
  if (!sources.length) throw new Error('no sources found')

  const resourcesByDir = new Map<
    string,
    { drones: string[]; deps: string[] }
  >()

  const resourceBytes = new Map<string, Uint8Array>()

  for (const src of sources) {
    const compiled =
      src.kind === 'dependency'
        ? await compileDependency(src.entry)
        : await compileDrone(src.entry)

    const name =
      src.relDir
        ? `${src.relDir}/${basename(stripExt(src.entry))}`
        : basename(stripExt(src.entry))

    const header = `// @hypercomb ${JSON.stringify({
      name,
      kind: src.kind
    })}\n`

    const bytes = textToBytes(header + compiled)
    const sig = await SignatureService.sign(toArrayBuffer(bytes))

    resourceBytes.set(sig, bytes)

    const bucket =
      resourcesByDir.get(src.relDir) ?? { drones: [], deps: [] }

    if (src.kind === 'drone') bucket.drones.push(sig)
    else bucket.deps.push(sig)

    resourcesByDir.set(src.relDir, bucket)
  }

  const tree = readDirTree(SRC_ROOT, '')
  const layers = new Map<string, string>()
  const rootLayerSig = await buildLayers(tree, resourcesByDir, layers)

  const rootDir = join(DIST_ROOT, rootLayerSig)
  const layersDir = join(rootDir, '__layers__')
  const resourcesDir = join(rootDir, '__resources__')

  ensureDir(layersDir)
  ensureDir(resourcesDir)

  for (const [sig, json] of layers) {
    writeFileSync(join(layersDir, sig), json, 'utf8')
  }

  for (const [sig, bytes] of resourceBytes) {
    writeSigFile(resourcesDir, sig, bytes)
  }

  const ps1 = resolve(__dirname, 'deploy-azure.ps1')
  if (existsSync(ps1)) {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Signature', rootLayerSig],
      { stdio: 'inherit' }
    )

    if (r.status !== 0) throw new Error('deployment failed')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
