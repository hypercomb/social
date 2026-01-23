// scripts/build-module.ts
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { resolve, join, relative, dirname } from 'path'
import { build } from 'esbuild'
import { PayloadCanonical, SignatureService, type DronePayloadV1, type Drone } from '@hypercomb/core'
import { HostedDrones } from '../src'

// -----------------------------------------
// config
// -----------------------------------------
const MODULE_NAME = '@hypercomb/essentials'

type HostedEntry = new () => Drone

// -----------------------------------------
// helpers
// -----------------------------------------
const toKebab = (value: string): string =>
  value
    .replace(/Drone$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()

const toBase64 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64')

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

const sortUnique = (items: readonly string[]): string[] => {
  const set = new Set(items)
  return [...set].sort((a, b) => a.localeCompare(b))
}

const relPosix = (root: string, full: string): string => {
  const rel = relative(root, full).replace(/\\/g, '/')
  return rel === '.' ? '' : rel
}

const dirRelFromEntry = (srcRoot: string, entryPath: string): string =>
  relPosix(srcRoot, dirname(entryPath))

const baseNameFromRel = (rel: string): string =>
  rel === '' ? MODULE_NAME : rel.split('/').filter(Boolean).pop() ?? MODULE_NAME

const signJson = async (value: any): Promise<{ signature: string; json: string }> => {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  const signature = await SignatureService.sign(toArrayBuffer(bytes))
  return { signature, json }
}

// -----------------------------------------
// source indexing (drones only)
// -----------------------------------------
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

const buildDroneSourceIndex = (): Map<string, string> => {
  const index = new Map<string, string>()
  const srcRoot = resolve('./src')
  const all = walkFiles(srcRoot)

  for (const file of all) {
    if (!file.endsWith('.drone.ts') && !file.endsWith('.drone.js')) continue
    const base = file.replace(/^.*[\\\/]/, '').replace(/\.drone\.(ts|js)$/, '')
    if (!index.has(base)) index.set(base, file)
  }

  return index
}

const resolveDroneEntry = (fileBase: string, index: Map<string, string>): string => {
  const candidate = index.get(fileBase)
  if (!candidate) throw new Error(`drone source not found for "${fileBase}"`)
  return candidate
}

// -----------------------------------------
// bundler
// -----------------------------------------
const bundleDrone = async (entryFile: string): Promise<string> => {
  const result = await build({
    entryPoints: [resolve(entryFile)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    target: 'es2022',
    tsconfig: resolve('./tsconfig.json'),
    absWorkingDir: process.cwd(),
    external: ['@hypercomb/core'],
  })

  return result.outputFiles[0].text
}

// -----------------------------------------
// honeycomb layers
// -----------------------------------------
type DirNode = {
  rel: string
  children: DirNode[]
}

const collectIncludedDirs = (srcRoot: string, entryPaths: readonly string[]): Set<string> => {
  const included = new Set<string>()
  included.add('')

  for (const entry of entryPaths) {
    let rel = dirRelFromEntry(srcRoot, entry)
    included.add(rel)

    while (rel.includes('/')) {
      rel = rel.split('/').slice(0, -1).join('/')
      included.add(rel)
    }

    included.add('')
  }

  return included
}

const readDirTreeFiltered = (srcRoot: string, relDir: string, included: Set<string>): DirNode | null => {
  const full = join(srcRoot, relDir)
  if (!existsSync(full) || !statSync(full).isDirectory()) return null

  const children: DirNode[] = []

  for (const name of readdirSync(full)) {
    const childFull = join(full, name)
    if (!statSync(childFull).isDirectory()) continue

    const childRel = relDir ? `${relDir}/${name}` : name
    const child = readDirTreeFiltered(srcRoot, childRel, included)
    if (child) children.push(child)
  }

  children.sort((a, b) => a.rel.localeCompare(b.rel))

  if (!included.has(relDir) && children.length === 0) return null
  return { rel: relDir, children }
}

const buildLayersBottomUp = async (
  node: DirNode,
  dirToDroneSigs: Map<string, string[]>,
  layersDir: string
): Promise<string> => {
  // build children first (leaf -> root)
  const childLayerSigs: string[] = []
  for (const child of node.children) {
    const sig = await buildLayersBottomUp(child, dirToDroneSigs, layersDir)
    childLayerSigs.push(sig)
  }

  // exact honeycomb layer format v1
  const layer = {
    version: 1,
    name: baseNameFromRel(node.rel),
    droneSigs: sortUnique(dirToDroneSigs.get(node.rel) ?? []),
    childrenSigs: sortUnique(childLayerSigs),
  }

  const signed = await signJson(layer)

  // file name must equal the signature
  writeFileSync(join(layersDir, signed.signature), signed.json, 'utf8')

  return signed.signature
}

// -----------------------------------------
// main
// -----------------------------------------
const main = async (): Promise<void> => {
  const distDir = resolve('./dist')
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })

  const layersDir = resolve(distDir, 'layers')
  const resourcesDir = resolve(distDir, 'resources')
  const rootsDir = resolve(distDir, 'roots')

  mkdirSync(layersDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })
  mkdirSync(rootsDir, { recursive: true })

  if (!Array.isArray(HostedDrones) || HostedDrones.length === 0) {
    throw new Error('no drones exported from src/index.ts')
  }

  // -----------------------------------------
  // 1) build drones -> dist/resources/<droneSig>
  // -----------------------------------------
  const sourceIndex = buildDroneSourceIndex()
  const srcRoot = resolve('./src')

  const built: { droneSig: string; dirRel: string }[] = []

  for (const DroneCtor of HostedDrones as HostedEntry[]) {
    const instance = new DroneCtor()

    const fileBase = toKebab(instance.constructor.name)
    const entryPath = resolveDroneEntry(fileBase, sourceIndex)

    const bundledSource = await bundleDrone(entryPath)

    const draft = PayloadCanonical.createEmpty()

    // signed meaning (drone)
    draft.drone.name = instance.name
    draft.drone.description = instance.description ?? ''
    draft.drone.grammar = instance.grammar ?? []
    draft.drone.links = instance.links ?? []
    ;(draft.drone as any).effects = (instance as any).effects ?? []

    // unsigned source (bundled)
    draft.source.entry = 'bundle.js'
    draft.source.files = { 'bundle.js': toBase64(bundledSource) }

    const { signature: droneSig } = await PayloadCanonical.compute(draft)

    // drones are resources for later loading (heartbeats)
    writeFileSync(join(resourcesDir, droneSig), JSON.stringify(draft), 'utf8')

    built.push({ droneSig, dirRel: dirRelFromEntry(srcRoot, entryPath) })
  }

  // -----------------------------------------
  // 2) map drones to their folder layer
  // -----------------------------------------
  const dirToDroneSigs = new Map<string, string[]>()

  for (const d of built) {
    const list = dirToDroneSigs.get(d.dirRel) ?? []
    list.push(d.droneSig)
    dirToDroneSigs.set(d.dirRel, list)
  }

  // -----------------------------------------
  // 3) build a dir tree only for folders that contain exported drones (and their ancestors)
  // -----------------------------------------
  const entryPaths = built.map(x => resolve(srcRoot, x.dirRel)).map(p => p) // not used directly; included dirs is computed from real entry files below
  void entryPaths

  const droneEntryFiles = built.map(x => x.dirRel)
  void droneEntryFiles

  // rebuild included dirs from the actual entry files we bundled
  const included = collectIncludedDirs(
    srcRoot,
    built.map(x => resolve(srcRoot, x.dirRel, '__marker__')).map(p => dirname(p)) // forces dir rel collection only
  )

  // note:
  // included above needs the actual entry file paths to be perfect.
  // to keep it exact, we recompute from the sourceIndex lookup directly.
  included.clear()
  included.add('')

  for (const DroneCtor of HostedDrones as HostedEntry[]) {
    const instance = new DroneCtor()
    const fileBase = toKebab(instance.constructor.name)
    const entryPath = resolveDroneEntry(fileBase, sourceIndex)
    const dirRel = dirRelFromEntry(srcRoot, entryPath)

    let rel = dirRel
    included.add(rel)
    while (rel.includes('/')) {
      rel = rel.split('/').slice(0, -1).join('/')
      included.add(rel)
    }
    included.add('')
  }

  const tree = readDirTreeFiltered(srcRoot, '', included)
  if (!tree) throw new Error('no layer tree could be constructed')

  // -----------------------------------------
  // 4) build honeycomb layers (leaf -> root)
  // -----------------------------------------
  const rootLayerSig = await buildLayersBottomUp(tree, dirToDroneSigs, layersDir)

  // -----------------------------------------
  // 5) root pointers
  // -----------------------------------------
  writeFileSync(join(rootsDir, 'current-root'), rootLayerSig, 'utf8')

  console.log('module built')
  console.log(`root layer: ${rootLayerSig}`)
  console.log(`drones packaged: ${built.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
