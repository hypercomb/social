// scripts/build-module.ts

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { resolve, join, relative, dirname } from 'path'
import { build } from 'esbuild'
import { PayloadCanonical, SignatureService, type Drone } from '@hypercomb/core'
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
    const base = file.replace(/^.*[\\/]/, '').replace(/\.drone\.(ts|js)$/, '')
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

const readDirTreeFiltered = (
  srcRoot: string,
  relDir: string,
  included: Set<string>
): DirNode | null => {
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
  dirToDrones: Map<string, string[]>,
  layersDir: string
): Promise<string> => {
  const childLayer: string[] = []

  for (const child of node.children) {
    const sig = await buildLayersBottomUp(child, dirToDrones, layersDir)
    childLayer.push(sig)
  }

  const layer = {
    version: 1,
    name: baseNameFromRel(node.rel),
    drones: sortUnique(dirToDrones.get(node.rel) ?? []),
    children: sortUnique(childLayer),
  }

  const signed = await signJson(layer)
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

  const layersDir = resolve(distDir, '__layers__')
  const resourcesDir = resolve(distDir, '__resources__')

  mkdirSync(layersDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  if (!Array.isArray(HostedDrones) || HostedDrones.length === 0) {
    throw new Error('no drones exported from src/index.ts')
  }

  const sourceIndex = buildDroneSourceIndex()
  const srcRoot = resolve('./src')

  const built: { droneSig: string; dirRel: string }[] = []

  for (const DroneCtor of HostedDrones as HostedEntry[]) {
    const instance = new DroneCtor()
    const fileBase = toKebab(instance.constructor.name)
    const entryPath = resolveDroneEntry(fileBase, sourceIndex)

    const bundledSource = await bundleDrone(entryPath)

    const draft = PayloadCanonical.createEmpty()

    draft.drone.name = instance.name
    draft.drone.description = instance.description ?? ''
    draft.drone.grammar = instance.grammar ?? []
    draft.drone.links = instance.links ?? []
    ;(draft.drone as any).effects = (instance as any).effects ?? []

    draft.source.entry = 'bundle.js'
    draft.source.files = { 'bundle.js': toBase64(bundledSource) }

    const { signature: droneSig } = await PayloadCanonical.compute(draft)
    writeFileSync(join(resourcesDir, droneSig), JSON.stringify(draft), 'utf8')

    built.push({ droneSig, dirRel: dirRelFromEntry(srcRoot, entryPath) })
  }

  const dirToDrones = new Map<string, string[]>()
  for (const d of built) {
    const list = dirToDrones.get(d.dirRel) ?? []
    list.push(d.droneSig)
    dirToDrones.set(d.dirRel, list)
  }

  const included = new Set<string>([''])
  for (const d of built) {
    let rel = d.dirRel
    included.add(rel)
    while (rel.includes('/')) {
      rel = rel.split('/').slice(0, -1).join('/')
      included.add(rel)
    }
  }

  const tree = readDirTreeFiltered(srcRoot, '', included)
  if (!tree) throw new Error('no layer tree could be constructed')

  const rootLayerSig = await buildLayersBottomUp(tree, dirToDrones, layersDir)

  // -----------------------------------------
  // nest under root signature
  // -----------------------------------------

  const rootDir = resolve(distDir, rootLayerSig)
  mkdirSync(rootDir)

  mkdirSync(join(rootDir, '__layers__'))
  mkdirSync(join(rootDir, '__resources__'))

  for (const f of readdirSync(layersDir)) {
    writeFileSync(
      join(rootDir, '__layers__', f),
      readFileSync(join(layersDir, f))
    )
  }

  for (const f of readdirSync(resourcesDir)) {
    writeFileSync(
      join(rootDir, '__resources__', f),
      readFileSync(join(resourcesDir, f))
    )
  }

  rmSync(layersDir, { recursive: true, force: true })
  rmSync(resourcesDir, { recursive: true, force: true })

  console.log('module built')
  console.log(`root signature: ${rootLayerSig}`)
  console.log(`drones packaged: ${built.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
