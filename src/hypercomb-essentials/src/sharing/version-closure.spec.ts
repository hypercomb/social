// version-closure.spec.ts — ONE CLOSURE, TWO WALKERS. What a builder carries
// with a revision (hypercomb-shim host/builds.mjs closureOf) and what the
// browser takes for it (version-pools.ts revisionClosure) must be one set:
// a file the browser's walk misses is a revision it holds only in part, and
// one the builder's misses is a file the browser asks for and never gets.
// Both walk the same pool here, with every part a revision record carries.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
// @ts-ignore — plain ESM tooling, no declarations
import { closureOf } from '../../../hypercomb-shim/host/builds.mjs'
// @ts-ignore — plain ESM tooling, no declarations
import { hostTree } from '../../../hypercomb-shim/host/source-tree.mjs'
import { revisionClosure } from './version-pools.js'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
let pool = ''
beforeEach(async () => { pool = await mkdtemp(resolve(tmpdir(), 'hc-closure-spec-')) })
afterEach(async () => { await rm(pool, { recursive: true, force: true }) })

const keep = async (bytes: Buffer): Promise<string> => { const sig = sha(bytes); await writeFile(resolve(pool, sig), bytes); return sig }
const record = (value: unknown): Promise<string> => keep(Buffer.from(JSON.stringify(value)))
const text = (value: string): Promise<string> => keep(Buffer.from(value))
const readRecord = async (sig: string): Promise<unknown> => {
  try { return JSON.parse((await readFile(resolve(pool, sig))).toString('utf8')) } catch { return null }
}

/** A revision with every part: install, source and workspace layers, atoms,
 *  conversations, a host tree (units, files, two paths sharing one envelope,
 *  a spot's beehavior with its bee and dependencies, a package atom), and the
 *  draft it was built from, which deletes a file. */
const revision = async (n: number, shared: { draft: string }) => {
  const main = await text(`// main ${n}\n`)
  const install = await record({ name: 'install', files: { 'main.js': main, 'index.html': await text('<html>') } })
  const source = await record({ name: 'source', files: { 'src/main.ts': await text(`// source ${n}\n`) } })
  const workspace = await record({ name: 'workspace', files: { 'src/main.ts': await text(`// source ${n}\n`), 'package.json': await text('{ "name": "x" }\n') } })
  const bee = await record({ meta: 1, bee: await text(`// bee ${n}\n`), relation: 'bee' })
  const dependency = await text(`// @x/dep ${n}\n`)
  const behaviour = await record({ name: 'LineageDrone', bee, dependencies: [dependency], children: [] })
  const atomNode = await record({ name: 'src/dep.ts', dependency, children: [await record({ meta: 1, layer: await record({ name: 'src/dep.ts', content: await record({ meta: 1, resource: await text(`dep ${n}`), relation: 'content' }) }), relation: 'children' })] })
  const { root: tree } = await hostTree({
    units: [
      { name: 'build', files: new Map([['src/build.mjs', Buffer.from('tool')]]) },
      { name: 'bundle', output: await text(`bundle ${n}`), files: new Map([['src/main.ts', Buffer.from(`// source ${n}\n`)], ['vendor/a/pure.js', Buffer.from('vendor')], ['vendor/b/pure.js', Buffer.from('vendor')]]) },
      { name: 'lineage', files: new Map(), beehaviors: [behaviour, atomNode] },
    ],
    host: await text(`host ${n}`), library: await text('library'), hostPackage: await text('package'), keep,
  })
  return record({
    name: 'build', label: 'host-drafts', version: `0.0.${n}`, parent: null,
    install, source, workspace, tree,
    atoms: [await text(`atom ${n}`)], conversations: [await text(`conversation ${n}`)],
    draft: shared.draft, ask: 'a'.repeat(64),
  })
}

describe('one closure, two walkers', () => {
  it('the browser reaches exactly what the builder carries', async () => {
    await mkdir(pool, { recursive: true })
    const deleted = await text('gone')
    const files = await record({ name: 'draft-files', files: { 'src/main.ts': await text('// draft\n'), 'src/old.ts': null } })
    const base = await record({ name: 'build', label: 'host', version: '0.0.0', workspace: await record({ name: 'workspace', files: { 'src/old.ts': deleted } }) })
    const draft = await record({ name: 'draft', label: 'host', base, files, at: '2026-10-12T00:00:00.000Z' })
    const one = await revision(1, { draft })
    const two = await revision(2, { draft })
    // A name nothing holds still belongs to the closure: the builder could
    // not carry it, and the browser must ask for it.
    const missing = await record({ name: 'build', label: 'host-drafts', version: '0.0.3', workspace: 'b'.repeat(64), tree: 'c'.repeat(64) })

    for (const sigs of [[one], [one, two], [two, missing]]) {
      const node: Set<string> = await closureOf(pool, sigs)
      const browser = await revisionClosure(sigs, readRecord)
      expect([...browser].sort()).toEqual([...node].sort())
    }
    const whole = await revisionClosure([one], readRecord)
    // Sanity: the walk went all the way down, and never into the base.
    expect(whole.has(draft) && whole.has(files) && whole.has(await text('// draft\n'))).toBe(true)
    expect(whole.has(await text('// bee 1\n')) && whole.has(await text('dep 1')) && whole.has(await text('vendor'))).toBe(true)
    expect(whole.has(base) || whole.has(deleted)).toBe(false)
  })

  it('a signature met as a leaf before it is met as a record is still walked, by both', async () => {
    await mkdir(pool, { recursive: true })
    // A file whose bytes are exactly another file's tree record: its content
    // names that record as a resource (a leaf) before the record's own unit
    // is reached.
    const two = sha('two')
    const envelope = JSON.stringify({ meta: 1, resource: two, relation: 'content' })
    const node = JSON.stringify({ name: 'src/b/two.ts', content: sha(envelope) })
    const { root: tree } = await hostTree({
      units: [
        { name: 'a', files: new Map([['src/a/fixture.json', Buffer.from(node)]]) },
        { name: 'b', files: new Map([['src/b/two.ts', Buffer.from('two')]]) },
      ],
      host: await text('host'), library: await text('library'), hostPackage: await text('package'), keep,
    })
    const revision = await record({ name: 'build', label: 'host-drafts', version: '0.0.9', tree })
    const node_: Set<string> = await closureOf(pool, [revision])
    const browser = await revisionClosure([revision], readRecord)
    expect([...browser].sort()).toEqual([...node_].sort())
    expect(browser.has(sha(envelope)) && browser.has(two)).toBe(true)
  })
})
