// package-tree.spec.ts — A PACKAGE REVISION CARRIES ITS SOURCE AS ITS TILES.
// Never a side list of paths: each file is a child of the unit it was built
// into, each unit a beehavior or atom of the tile its folder is, and each
// tile names the cell the package runs. The pool alone writes it back out.
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as builds from './builds.mjs'
import { packageTree, walkTree } from './package-tree.mjs'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
let root: string, repo: string, pkg: string

const write = async (path: string, text: string | Buffer) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
const SOURCES: Record<string, string> = {
  'package.json': '{ "name": "hypercomb-essentials" }\n',
  'scripts/build-module.ts': 'export const build = 1\n',
  'src/pan/pan.drone.ts': 'import { lift } from "@x/pan/lift"\nexport class PanningDrone {}\n',
  'src/pan/pan.drone.spec.ts': 'it("pans", () => {})\n',
  'src/pan/lift.ts': 'export const lift = 1\n',
  'src/pan/icon.svg': '<svg/>\n',
}

/** A built package, the shape build-module leaves: dist (manifest, cells,
 *  bees, dependencies by their first-line specifier) and the build cache. */
const build = async () => {
  for (const [path, text] of Object.entries(SOURCES)) await write(resolve(pkg, path), text)
  const dist = resolve(pkg, 'dist')
  const keep = async (bytes: string) => { const sig = sha(bytes); await write(resolve(dist, sig), bytes); return sig }
  const dep = await keep('// @x/pan/lift\nexport const lift = 1\n')
  const bee = await keep('import { lift } from "@x/pan/lift"\nclass PanningDrone {}\n')
  const cell = await keep(JSON.stringify({ name: 'pan', cells: [], bees: [`${bee}.js`], dependencies: [], docs: { bees: { [`${bee}.js`]: { className: 'PanningDrone' } } } }))
  const top = await keep(JSON.stringify({ name: 'root', cells: [cell], bees: [], dependencies: [`${dep}.js`], resources: [] }))
  await write(resolve(dist, 'manifest.json'), JSON.stringify({ packages: { [top]: { layers: [cell] } } }))
  const unit = (path: string, outputSig: string) => ({
    files: { [`/elsewhere/checkout/hypercomb-essentials/${path}`]: { sig: sha(SOURCES[path]!) } }, outputSig,
  })
  await write(resolve(pkg, '.build-cache.json'), JSON.stringify({
    bees: { 'pan/pan.drone.ts': unit('src/pan/pan.drone.ts', bee) },
    atoms: { 'pan/lift.ts': unit('src/pan/lift.ts', dep) },
    namespaces: { pan: { files: {}, outputSig: 'b'.repeat(64) } },
  }))
  return { top, cell, bee, dep }
}

const readerOf = (dir: string) => async (sig: string) => { try { return JSON.parse(await readFile(resolve(dir, sig), 'utf8')) } catch { return null } }

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'hc-package-tree-'))
  repo = resolve(root, 'repo')
  pkg = resolve(repo, 'src', 'hypercomb-essentials')
  process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'pools')
})
afterEach(async () => {
  delete process.env.HYPERCOMB_POOLS_DIR
  await rm(root, { recursive: true, force: true })
})

describe('the package as its tiles', () => {
  it('hangs each file under the unit it was built into, each unit under its tile, each tile on its cell', async () => {
    const { top, cell, bee, dep } = await build()
    const store = resolve(root, 'store')
    await mkdir(store, { recursive: true })
    const keep = async (bytes: Buffer) => { const sig = sha(bytes); await writeFile(resolve(store, sig), bytes); return sig }
    const made = await packageTree({ packageDir: pkg, repoRoot: repo, keep })
    const read = readerOf(store)
    const kids = async (node: { children?: string[] }) => Promise.all((node.children ?? []).map(async c => ({ relation: (await read(c)).relation, node: await read((await read(c)).layer) })))

    const pkgTile = await read(made.root)
    expect(pkgTile).toMatchObject({ name: 'hypercomb-essentials', package: top })
    const topKids = await kids(pkgTile)
    expect(topKids.map(k => k.node.name)).toEqual(['scripts', 'src', 'src/hypercomb-essentials/package.json'])

    const pan = (await kids((await kids(pkgTile)).find(k => k.node.name === 'src')!.node))[0]!.node
    expect(pan).toMatchObject({ name: 'pan', cell, namespace: 'b'.repeat(64) })
    const [behaviour, atom, icon] = await kids(pan)
    expect(behaviour!.relation).toBe('beehavior')
    expect(behaviour!.node).toMatchObject({ name: 'PanningDrone', dependencies: [dep] })
    expect(await read(behaviour!.node.bee)).toMatchObject({ meta: 1, bee, relation: 'bee' })
    // The bee's source and the spec that tests it ride with the beehavior.
    expect((await kids(behaviour!.node)).map(k => k.node.name)).toEqual([
      'src/hypercomb-essentials/src/pan/pan.drone.spec.ts', 'src/hypercomb-essentials/src/pan/pan.drone.ts'])
    expect(atom).toMatchObject({ relation: 'dependency', node: { name: 'src/hypercomb-essentials/src/pan/lift.ts', dependency: dep } })
    expect(icon!.node.name).toBe('src/hypercomb-essentials/src/pan/icon.svg')
    expect(made.atoms).toEqual([bee, cell, dep, top].sort())
  })

  it('holds every file exactly once, and nothing a build made', async () => {
    await build()
    const store = resolve(root, 'store'); await mkdir(store, { recursive: true })
    const made = await packageTree({ packageDir: pkg, repoRoot: repo, keep: async (b: Buffer) => { const s = sha(b); await writeFile(resolve(store, s), b); return s } })
    const { files } = await walkTree(made.root, readerOf(store))
    expect([...files.keys()].sort()).toEqual(Object.keys(SOURCES).map(p => `src/hypercomb-essentials/${p}`).sort())
    for (const [path, sig] of files) expect(sig).toBe(sha(SOURCES[path.replace('src/hypercomb-essentials/', '')]!))
    expect(made.files).toBe(Object.keys(SOURCES).length)
  })

  it('refuses a source edited after the package was built', async () => {
    await build()
    await writeFile(resolve(pkg, 'src/pan/pan.drone.ts'), 'export class PanningDrone { edited = true }\n')
    await expect(packageTree({ packageDir: pkg, repoRoot: repo, keep: async (b: Buffer) => sha(b) }))
      .rejects.toThrow(/pan\.drone\.ts changed since the package was built/)
  })
})

describe('a package revision in the version pool', () => {
  it('stages, promotes, and writes its source back out from the pool alone', async () => {
    const { top } = await build()
    const made = await builds.recordPackage({ packageDir: pkg, repoRoot: repo })
    expect(made.record).toMatchObject({ name: 'build', label: 'hypercomb-essentials', version: 'staged', package: top })
    const { record } = await builds.promote('hypercomb-essentials', { sync: false, sign: false })

    // Nothing but the pool: the checkout is gone.
    await rm(pkg, { recursive: true, force: true })
    const out = resolve(root, 'out')
    // A story's name is its newest promotion.
    expect((await builds.findRevision('hypercomb-essentials')).record.version).toBe(record.version)
    const written = await builds.writeSource(record.version, out)
    expect(written.files).toBe(Object.keys(SOURCES).length)
    for (const [path, text] of Object.entries(SOURCES)) {
      expect(await readFile(resolve(out, 'src/hypercomb-essentials', path), 'utf8')).toBe(text)
    }
    await expect(builds.writeOut(record.version, resolve(root, 'origin'))).rejects.toThrow(/is a package, not an origin/)
  })

  it('travels whole: what is published reaches every tile, file and atom', async () => {
    await build()
    await builds.recordPackage({ packageDir: pkg, repoRoot: repo })
    const { record } = await builds.promote('hypercomb-essentials', { sync: false, sign: false })
    const pool = builds.poolDir(builds.BUILDS_MEANING)
    const travels = (await builds.published())[builds.BUILDS_MEANING]!
    const held = (await readdir(pool)).filter(n => /^[a-f0-9]{64}$/.test(n))
    // Everything the pool holds for this revision is carried: nothing is left behind.
    expect(held.filter(n => !travels.has(n))).toEqual([])
    for (const atom of record.atoms) expect(travels.has(atom)).toBe(true)
  })

  it('shows what a revision changed against its own story, file by file', async () => {
    await build()
    await builds.recordPackage({ packageDir: pkg, repoRoot: repo })
    await builds.promote('hypercomb-essentials', { sync: false, sign: false })
    SOURCES['src/pan/lift.ts'] = 'export const lift = 2\n'
    try {
      await build()
      const made = await builds.recordPackage({ packageDir: pkg, repoRoot: repo })
      const pool = builds.poolDir(builds.BUILDS_MEANING)
      const { parts, files } = await builds.changesOf(pool, made.record)
      // The edit compiled to the same bytes: the package it runs is the same
      // one, and only its source moved — which the tree still records.
      expect(parts).toEqual(['tree'])
      expect(files['tree']).toEqual(['~ src/hypercomb-essentials/src/pan/lift.ts'])
    } finally {
      SOURCES['src/pan/lift.ts'] = 'export const lift = 1\n'
    }
  })
})
