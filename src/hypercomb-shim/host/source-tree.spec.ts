// source-tree.spec.ts — A REVISION CARRIES ITS SOURCE AS ITS TILES.
// Never a side list of paths. A package: each file a child of the unit it
// was built into, each unit a beehavior or atom of the tile its folder is,
// each tile naming the cell the package runs. A host: each file a child of
// the unit its build compiled, each unit naming what it produced, a spot
// holding its beehaviors. The pool alone writes either back out.
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as builds from './builds.mjs'
import { hostTree, packageTree, walkTree } from './source-tree.mjs'

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
  root = await mkdtemp(resolve(tmpdir(), 'hc-source-tree-'))
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
      expect(files['source']).toEqual(['~ src/hypercomb-essentials/src/pan/lift.ts'])
    } finally {
      SOURCES['src/pan/lift.ts'] = 'export const lift = 1\n'
    }
  })
})

describe('the host as its tiles', () => {
  const b = (text: string) => Buffer.from(text)
  const hostUnits = (main: string, behaviour: string) => [
    // A unit named like a record kind must never be read as one.
    { name: 'build', files: new Map([['src/hypercomb-shim/build.mjs', b('tool')]]) },
    { name: 'processor', install: 'hypercomb-core.runtime.js', files: new Map([['src/hypercomb-core/src/processor.ts', b('processor')]]) },
    // Two vendored copies of the same bytes: one envelope, two files.
    { name: 'bundle', output: 'h'.repeat(64), files: new Map([['src/hypercomb-shim/src/main.ts', b(main)], ['node_modules/nostr-tools/lib/pure.js', b('vendor')], ['node_modules/other/lib/pure.js', b('vendor')]]) },
    { name: 'lineage', files: new Map(), beehaviors: [behaviour] },
  ]

  it('hangs each file under the unit its build compiled, each unit naming what it produced', async () => {
    const store = resolve(root, 'store'); await mkdir(store, { recursive: true })
    const keep = async (bytes: Buffer) => { const sig = sha(bytes); await writeFile(resolve(store, sig), bytes); return sig }
    const behaviour = await keep(b(JSON.stringify({ name: 'lineage', bee: await keep(b(JSON.stringify({ meta: 1, bee: 'e'.repeat(64), relation: 'bee' }))), children: [] })))
    const { root: tree, files } = await hostTree({ units: hostUnits('main', behaviour), host: 'h'.repeat(64), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64), keep })
    const read = readerOf(store)
    const host = await read(tree)
    expect(host).toMatchObject({ name: 'host', host: 'h'.repeat(64), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64) })
    const units = await Promise.all(host.children.map(async (c: string) => read((await read(c)).layer)))
    expect(units.map((u: { name: string }) => u.name)).toEqual(['build', 'processor', 'bundle', 'lineage'])
    expect(units[1]).toMatchObject({ install: 'hypercomb-core.runtime.js' })
    expect(units[2]).toMatchObject({ output: 'h'.repeat(64) })
    const lineageKids = await Promise.all(units[3].children.map((c: string) => read(c)))
    expect(lineageKids).toEqual([{ meta: 1, layer: behaviour, relation: 'beehavior' }])
    expect(files).toBe(5)
    const walked = await walkTree(tree, read)
    expect([...walked.files.keys()].sort()).toEqual(['node_modules/nostr-tools/lib/pure.js', 'node_modules/other/lib/pure.js', 'src/hypercomb-core/src/processor.ts', 'src/hypercomb-shim/build.mjs', 'src/hypercomb-shim/src/main.ts'])
    expect(walked.reach.has(behaviour)).toBe(true)
    expect(walked.reach.has('e'.repeat(64))).toBe(true)
  })

  it('stages, and writes a host\'s source back out from the pool alone', async () => {
    const atom = b('atom')
    const made = await builds.recordBuild({
      label: 'host', signed: [atom], install: new Map([['main.js', b('kernel')]]),
      units: hostUnits('main v1', 'f'.repeat(64)), host: sha(atom), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64),
    })
    expect(made.record.tree).toMatch(/^[a-f0-9]{64}$/)
    expect(made.record.source).toBeUndefined()
    const { record } = await builds.promote('host', { sync: false, sign: false })
    const out = resolve(root, 'host-source')
    // A promotion reads its revisions right past the unit named "build".
    expect((await builds.revisions()).map(r => r.sig)).toEqual([(await builds.findRevision('host')).sig])
    expect((await builds.writeSource(record.version, out)).files).toBe(5)
    expect(await readFile(resolve(out, 'node_modules/other/lib/pure.js'), 'utf8')).toBe('vendor')
    expect(await readFile(resolve(out, 'src/hypercomb-shim/src/main.ts'), 'utf8')).toBe('main v1')
    expect(await readFile(resolve(out, 'node_modules/nostr-tools/lib/pure.js'), 'utf8')).toBe('vendor')
  })

  it('measures a tree against a flat layer before it by path: only what changed shows', async () => {
    // A revision from before trees: its source is a flat layer.
    const pool = builds.poolDir(builds.BUILDS_MEANING)
    await mkdir(pool, { recursive: true })
    const put = async (bytes: Buffer) => { const sig = sha(bytes); await writeFile(resolve(pool, sig), bytes); return sig }
    const files: Record<string, string> = {}
    for (const [path, text] of [['src/hypercomb-shim/build.mjs', 'tool'], ['src/hypercomb-core/src/processor.ts', 'processor'], ['src/hypercomb-shim/src/main.ts', 'main v1'], ['node_modules/nostr-tools/lib/pure.js', 'vendor'], ['node_modules/other/lib/pure.js', 'vendor']]) files[path!] = await put(b(text!))
    const source = await put(b(JSON.stringify({ name: 'source', files })))
    const install = await put(b(JSON.stringify({ name: 'install', files: { 'main.js': await put(b('kernel')) } })))
    const old = await put(b(JSON.stringify({ name: 'build', label: 'host', version: '2026.9.1.1', parent: null, install, host: 'h'.repeat(64), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64), atoms: [], source })))
    await writeFile(resolve(pool, 'head'), old + '\n')

    const made = await builds.recordBuild({
      label: 'host', signed: [], install: new Map([['main.js', b('kernel')]]),
      units: hostUnits('main v2', 'f'.repeat(64)), host: 'h'.repeat(64), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64),
    })
    const { parts, files: changed } = await builds.changesOf(pool, made.record)
    expect(parts).toEqual(['source', 'tree'])
    expect(changed.source).toEqual(['~ src/hypercomb-shim/src/main.ts'])
  })
})
