// @vitest-environment node
//
// replicate-public-host.spec.ts — a published revision reaches the public
// install host by REPLICATION: the host is asked for every atom by signature
// and reads it from its farm, the root last — before the stamp, inside a
// publish — and its pool names the root once the index does and it holds the
// whole package.
// Nothing is uploaded and nothing is built. The host here is a fake of the
// worker's contract (blossom-worker/worker.js: readThroughFarm,
// installedPackage) — no network is touched.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PUBLIC_INSTALL_HOST, PUBLIC_INSTALL_HOST_ENV, RETRY_AFTER_MS, localAtoms, publicInstallHost,
  replicateRevision, replicationOrder, replicationVerdict,
} from './replicate-public-host.js'

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const POOL = sha(utf8('host:packages'))
const STALE = 'b'.repeat(64)

/** A package as publish makes one: root → child layer → a bee and a dependency. */
function aPackage() {
  const atoms = new Map<string, Uint8Array>()
  const add = (text: string): string => { const bytes = utf8(text); const sig = sha(bytes); atoms.set(sig, bytes); return sig }
  const bee = add('export class Bee { pulse() { return 1 } }')
  const dependency = add('// @hypercomb/essentials/thing\nexport const thing = 1')
  const child = add(JSON.stringify({ name: 'child', cells: [], bees: [`${bee}.js`], dependencies: [dependency] }))
  const root = add(JSON.stringify({ name: 'essentials', cells: [{ sig: child }], bees: [], dependencies: [] }))
  return { atoms, bee, dependency, child, root }
}

/**
 * The worker's contract, faked: a bare `/<sig>` read answers from the heap, or
 * from the farm (kept, and marked); `/content/<sig>` is the heap or the
 * origin's 404; the pool under /content/ names the signed root once the heap
 * holds its whole package (heapHoldsPackage — here, every atom the farm was
 * given), else the origin's staged (older) package; the flat pool address is
 * the origin's page.
 */
function aHost(signed: string, farm: Map<string, Uint8Array>, options: { derives?: boolean; lies?: Set<string>; flaky?: Set<string> } = {}) {
  const heap = new Map<string, Uint8Array>()
  const bare: string[] = []
  const missedOnce = new Set<string>()
  const page = () => new Response('<!doctype html><title>origin</title>', { headers: { 'content-type': 'text/html' } })
  const fetchImpl = async (url: string): Promise<Response> => {
    const path = new URL(url).pathname
    const atom = path.match(/^\/([a-f0-9]{64})$/)
    if (atom) {
      const sig = atom[1]!
      bare.push(sig)
      if (options.lies?.has(sig)) return new Response('not these bytes')
      if (heap.has(sig)) return new Response(heap.get(sig)!)
      if (options.flaky?.has(sig) && !missedOnce.has(sig)) { missedOnce.add(sig); return new Response('missing', { status: 404 }) }
      const farmed = farm.get(sig)
      if (!farmed) return new Response('sig not held\n', { status: 404 })
      heap.set(sig, farmed)
      return new Response(farmed, { headers: { 'x-read-through': 'farm' } })
    }
    const content = path.match(/^\/content\/([a-f0-9]{64})$/)
    if (content) return heap.has(content[1]!) ? new Response(heap.get(content[1]!)!) : new Response('nope', { status: 404 })
    const derived = options.derives !== false && heap.has(signed) && [...farm.keys()].every(sig => heap.has(sig))
    if (path === `/content/${POOL}/`) return new Response('00000000\n', { headers: { 'cache-control': 'no-store' } })
    if (path === `/content/${POOL}/00000000`) return new Response(`${derived ? signed : STALE}\nessentials`)
    return page()
  }
  return { heap, bare, fetchImpl }
}

const reader = (atoms: Map<string, Uint8Array>) => async (sig: string) => atoms.get(sig) ?? null

describe('replicateRevision — the host takes the root by signature', () => {
  it('pulls every atom through the host\'s farm, everything an atom names before it, the root last — and the pool flips', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms)
    const lines: string[] = []
    const sleeps: number[] = []
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async ms => { sleeps.push(ms) }, log: line => lines.push(line) })

    expect(report.ok).toBe(true)
    expect(report.stage).toBe('done')
    expect(report.copied.sort()).toEqual([...pkg.atoms.keys()].sort())
    expect(report.held).toBe(0)
    expect(report.head).toBe(pkg.root)
    expect(report.rootServed).toBe(true)
    expect(sleeps).toEqual([])
    // The order the host was asked in.
    expect(host.bare.at(-1)).toBe(pkg.root)
    expect(host.bare.indexOf(pkg.child)).toBeGreaterThan(host.bare.indexOf(pkg.bee))
    expect(host.bare.indexOf(pkg.child)).toBeGreaterThan(host.bare.indexOf(pkg.dependency))
    // It logs what it copied.
    const text = lines.join('\n')
    expect(text).toMatch(/hypercomb\.com copied 4 atom\(s\)/)
    for (const sig of pkg.atoms.keys()) expect(text).toContain(sig.slice(0, 12))
    expect(replicationVerdict(report).lines.join('\n')).toMatch(/offers .* to cold installs — current/)
  })

  it('is idempotent: a second run copies nothing and is still current', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms)
    const run = () => replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl, sleep: async () => {}, log: () => {} })
    await run()
    const again = await run()
    expect(again.ok).toBe(true)
    expect(again.copied).toEqual([])
    expect(again.held).toBe(4)
  })

  it('asks the host nothing when this machine does not hold the whole package', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms)
    const partial = new Map(pkg.atoms)
    partial.delete(pkg.dependency)
    // …and bytes here that are not their name are no better than none.
    partial.set(pkg.bee, utf8('tampered'))
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(partial), fetchImpl: host.fetchImpl, log: () => {} })
    expect(report.ok).toBe(false)
    expect(report.stage).toBe('local')
    expect(report.local.holes.sort()).toEqual([pkg.bee, pkg.dependency].sort())
    expect(host.bare).toEqual([])
    expect(replicationVerdict(report).lines.join('\n')).toMatch(/REPLICATION NOT STARTED — hypercomb\.com was asked nothing/)
  })

  it('asks once more after the farm\'s miss window — and a miss the retry answers is taken', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms, { flaky: new Set([pkg.bee]) })
    const sleeps: number[] = []
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async ms => { sleeps.push(ms) }, log: () => {} })
    expect(sleeps[0]).toBe(RETRY_AFTER_MS)
    expect(RETRY_AFTER_MS).toBeGreaterThan(60_000)
    expect(report.ok).toBe(true)
    expect(host.bare.filter(sig => sig === pkg.bee)).toHaveLength(2)
  })

  it('never asks for the root while an atom under it is missing — the host keeps its older, complete package', async () => {
    const pkg = aPackage()
    const machine = new Map(pkg.atoms)
    machine.delete(pkg.dependency)   // the farm cannot give it
    const host = aHost(pkg.root, machine)
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async () => {}, log: () => {} })
    expect(report.ok).toBe(false)
    expect(report.stage).toBe('atoms')
    expect(report.failed).toEqual([{ sig: pkg.dependency, why: 'HTTP 404' }])
    expect(host.bare).not.toContain(pkg.root)
    expect(host.heap.has(pkg.root)).toBe(false)
    const text = replicationVerdict(report).lines.join('\n')
    expect(text).toMatch(/REPLICATION OWED — hypercomb\.com could not take 1 atom/)
    expect(text).toMatch(/The stamp stands: install:essentials is/)
    expect(text).toContain(`npm run replicate:revision -- --sig ${pkg.root}`)
  })

  it('believes no answer it did not hash: a host that serves other bytes has not taken the atom', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms, { lies: new Set([pkg.bee]) })
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async () => {}, log: () => {} })
    expect(report.ok).toBe(false)
    expect(report.failed).toEqual([{ sig: pkg.bee, why: 'bytes that are not its name' }])
  })

  it('a host whose worker has no farm took nothing, and the verdict says where to look', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, new Map())
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async () => {}, log: () => {} })
    expect(report.failed).toHaveLength(3)
    const verdict = replicationVerdict(report)
    expect(verdict.state).toBe('unknown')
    expect(verdict.lines.join('\n')).toMatch(/is its worker deployed with a farm\?/)
  })

  it('holding every atom is not enough: the pool a cold client reads must name the root', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms, { derives: false })
    const sleeps: number[] = []
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async ms => { sleeps.push(ms) }, log: () => {} })
    expect(report.ok).toBe(false)
    expect(report.stage).toBe('pool')
    expect(report.head).toBe(STALE)
    expect(report.rootServed).toBe(true)
    expect(sleeps.length).toBeGreaterThan(0)   // the index is edge-cached a few seconds
    const verdict = replicationVerdict(report)
    expect(verdict.state).toBe('behind')
    expect(verdict.lines.join('\n')).toMatch(/holds the package, but its pool still offers bbbbbbbbbbbb…[\s\S]*"installs": "essentials"/)
  })
})

describe('a publish pulls before its stamp, and reads the pool after it', () => {
  it('stage pull takes the whole package and reads no pool', async () => {
    const pkg = aPackage()
    const host = aHost(STALE, pkg.atoms)   // the index still names the previous root
    const asked: string[] = []
    const fetchImpl = async (url: string) => { asked.push(url); return host.fetchImpl(url) }
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), fetchImpl, stage: 'pull', sleep: async () => {}, log: () => {} })
    expect(report.ok).toBe(true)
    expect(report.stage).toBe('pulled')
    expect([...pkg.atoms.keys()].every(sig => host.heap.has(sig))).toBe(true)
    expect(asked.some(url => url.includes(POOL))).toBe(false)
    expect(replicationVerdict(report, 'essentials', false).lines.join('\n')).toMatch(/holds .*'s whole package — the stamp may name it/)
  })

  it('stage confirm asks for no atom — only the pool and the root as a cold client would', async () => {
    const pkg = aPackage()
    const host = aHost(pkg.root, pkg.atoms)
    for (const [sig, bytes] of pkg.atoms) host.heap.set(sig, bytes)
    const report = await replicateRevision({ root: pkg.root, host: 'hypercomb.com', fetchImpl: host.fetchImpl, stage: 'confirm', sleep: async () => {}, log: () => {} })
    expect(report.ok).toBe(true)
    expect(report.stage).toBe('done')
    expect(host.bare).toEqual([])
  })

  it('a pull that fails says nothing was announced, never that a stamp stands', () => {
    const failed = { host: 'hypercomb.com', root: 'a'.repeat(64), stage: 'local' as const,
      local: { atoms: 0, holes: ['c'.repeat(64)], refused: [], limited: false },
      copied: [], held: 0, copiedBytes: 0, failed: [], head: null, answered: false, rootServed: false, ok: false }
    const text = replicationVerdict(failed, 'essentials', false).lines.join('\n')
    expect(text).toMatch(/NOTHING WAS ANNOUNCED/)
    expect(text).toMatch(/this machine does not hold the whole package \(1 missing, 0 refused\)/)
    expect(text).not.toMatch(/stamp stands/)
  })
})

describe('replicationOrder', () => {
  it('puts every atom after every atom of the closure it names, and the root last', () => {
    const pkg = aPackage()
    const order = replicationOrder(pkg.root, [pkg.root, pkg.child, pkg.bee, pkg.dependency], sig => pkg.atoms.get(sig))
    expect(order.at(-1)).toBe(pkg.root)
    expect(order.indexOf(pkg.child)).toBeGreaterThan(order.indexOf(pkg.bee))
    expect(order.indexOf(pkg.child)).toBeGreaterThan(order.indexOf(pkg.dependency))
    // An atom the walk held but no literal reaches still goes before the root.
    const stray = 'f'.repeat(64)
    expect(replicationOrder(pkg.root, [pkg.root, pkg.child, pkg.bee, pkg.dependency, stray], sig => pkg.atoms.get(sig)).slice(-2)).toEqual([stray, pkg.root])
  })
})

describe('the host is named once, and the environment can move it', () => {
  it('defaults to the public install host, moves with the variable, and is skipped by empty or none', () => {
    expect(publicInstallHost({})).toBe(PUBLIC_INSTALL_HOST)
    expect(publicInstallHost({ [PUBLIC_INSTALL_HOST_ENV]: 'https://Other.Example/' })).toBe('other.example')
    expect(publicInstallHost({ [PUBLIC_INSTALL_HOST_ENV]: '' })).toBeNull()
    expect(publicInstallHost({ [PUBLIC_INSTALL_HOST_ENV]: 'none' })).toBeNull()
  })
})

describe('localAtoms', () => {
  it('reads an atom from the first dir that holds it as a file — a sig-named directory is a pool, never an atom', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replicate-local-'))
    try {
      const [a, b] = [join(dir, 'relay'), join(dir, 'dist')]
      mkdirSync(a)
      mkdirSync(b)
      const bytes = utf8('a layer')
      const sig = sha(bytes)
      mkdirSync(join(a, sig))            // a pool at the address, in the first dir
      writeFileSync(join(b, sig), bytes)  // the atom, in the second
      const read = localAtoms([a, b])
      expect(Buffer.from((await read(sig))!).toString()).toBe('a layer')
      expect(await read('c'.repeat(64))).toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
