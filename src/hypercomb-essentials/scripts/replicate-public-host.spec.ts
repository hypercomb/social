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
  PUBLIC_INSTALL_HOST, PUBLIC_INSTALL_HOST_ENV, RETRY_AFTER_MS, TYPESCRIPT_TIMEOUTS, askTimeoutMs, localAtoms, publicInstallHost,
  replicateRevision, replicateTypescript, replicationOrder, replicationVerdict, typescriptVerdict,
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

describe('replicateTypescript — the host takes the source atoms the layers name', () => {
  /** A package whose two folder layers each name a source atom (the root
   *  names none: a file directly in src/ has no atom); `big` adds two layers
   *  whose atoms are over a mebibyte. */
  function aTypedPackage(big = false) {
    const layers = new Map<string, Uint8Array>()
    const atoms = new Map<string, Uint8Array>()
    const put = (into: Map<string, Uint8Array>, text: string): string => { const bytes = utf8(text); const sig = sha(bytes); into.set(sig, bytes); return sig }
    const childAtom = put(atoms, '// @hypercomb/typescript/child\n// src/child/a.ts\nexport const a = 1\n')
    const sharingAtom = put(atoms, '// @hypercomb/typescript/sharing\n// src/sharing/b.ts\nexport const b = 1\n')
    const large = big ? [put(atoms, `// @hypercomb/typescript/large\n${'x'.repeat(1_200_000)}`), put(atoms, `// @hypercomb/typescript/larger\n${'y'.repeat(1_500_000)}`)] : []
    const cells = [
      put(layers, JSON.stringify({ name: 'child', cells: [], bees: [], dependencies: [], typescript: childAtom })),
      put(layers, JSON.stringify({ name: 'sharing', cells: [], bees: [], dependencies: [], typescript: sharingAtom })),
      ...large.map((atom, at) => put(layers, JSON.stringify({ name: `large${at}`, cells: [], bees: [], dependencies: [], typescript: atom }))),
    ]
    const root = put(layers, JSON.stringify({ name: 'essentials', cells, bees: [], dependencies: [] }))
    return { layers, atoms, root, childAtom, sharingAtom, large }
  }

  /** The worker's contract for a bare read, faked, with a count of reads in flight. */
  function aTypedHost(farm: Map<string, Uint8Array>, options: { head?: string; flaky?: Set<string>; lies?: Set<string>; sizes?: Map<string, number> } = {}) {
    const heap = new Map<string, Uint8Array>()
    const asked: string[] = []
    const missedOnce = new Set<string>()
    let inFlight = 0
    let largeInFlight = 0
    let mostLargeInFlight = 0
    const fetchImpl = async (url: string): Promise<Response> => {
      asked.push(url)
      const path = new URL(url).pathname
      const atom = path.match(/^\/([a-f0-9]{64})$/)
      if (!atom) {
        if (path === `/content/${POOL}/`) return new Response('00000000\n')
        if (path === `/content/${POOL}/00000000`) return new Response(`${options.head ?? STALE}\nessentials`)
        return new Response('<!doctype html><title>origin</title>', { headers: { 'content-type': 'text/html' } })
      }
      const sig = atom[1]!
      const isLarge = (farm.get(sig)?.byteLength ?? 0) > 1_048_576
      inFlight++
      if (isLarge) { largeInFlight++; mostLargeInFlight = Math.max(mostLargeInFlight, largeInFlight, inFlight) }
      try {
        await new Promise(done => setTimeout(done, 1))
        if (options.lies?.has(sig)) return new Response('not these bytes')
        if (heap.has(sig)) return new Response(heap.get(sig)! as BodyInit)
        if (options.flaky?.has(sig) && !missedOnce.has(sig)) { missedOnce.add(sig); return new Response('missing', { status: 404 }) }
        const farmed = farm.get(sig)
        if (!farmed) return new Response('sig not held\n', { status: 404 })
        heap.set(sig, farmed)
        return new Response(farmed as BodyInit, { headers: { 'x-read-through': 'farm' } })
      } finally {
        inFlight--
        if (isLarge) largeInFlight--
      }
    }
    return { heap, asked, fetchImpl, mostLargeInFlight: () => mostLargeInFlight }
  }

  const run = (pkg: ReturnType<typeof aTypedPackage>, host: ReturnType<typeof aTypedHost>, over: Partial<Parameters<typeof replicateTypescript>[0]> = {}) => {
    const sleeps: number[] = []
    const lines: string[] = []
    return replicateTypescript({
      root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.layers), readHosted: reader(pkg.atoms), fetchImpl: host.fetchImpl,
      sleep: async ms => { sleeps.push(ms) }, log: line => lines.push(line), ...over,
    }).then(report => ({ report, sleeps, lines }))
  }

  it('asks exactly the named atoms, each by its bare signature, and nothing else', async () => {
    const pkg = aTypedPackage()
    const host = aTypedHost(pkg.atoms)
    const { report, sleeps } = await run(pkg, host)
    expect(host.asked.sort()).toEqual([pkg.childAtom, pkg.sharingAtom].map(sig => `https://hypercomb.com/${sig}`).sort())
    expect(report).toMatchObject({ named: 2, absentHere: [], held: 0, failed: [], head: null, ok: true })
    expect(report.copied.sort()).toEqual([pkg.childAtom, pkg.sharingAtom].sort())
    expect(sleeps).toEqual([])
    expect(typescriptVerdict(report)).toEqual([
      expect.stringMatching(/^\[replicate\] TypeScript: hypercomb\.com holds 2 of 2 source atom\(s\) of [0-9a-f]{12}… — 2 copied from its farm \(0\.1 KB\), 0 already held$/),
    ])
    // Idempotent: the second run copies nothing.
    const again = (await run(pkg, host)).report
    expect(again).toMatchObject({ ok: true, copied: [], held: 2 })
  })

  it('a root whose layers carry no slot asks the host nothing', async () => {
    const pkg = aPackage()
    const host = aTypedHost(new Map())
    const report = await replicateTypescript({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.atoms), readHosted: reader(pkg.atoms), fetchImpl: host.fetchImpl, log: () => {} })
    expect(report).toMatchObject({ named: 0, ok: true })
    expect(host.asked).toEqual([])
    expect(typescriptVerdict(report)).toEqual([expect.stringMatching(/names no source atoms$/)])
  })

  it('an atom this machine\'s host does not hold is reported and never asked for', async () => {
    const pkg = aTypedPackage()
    const host = aTypedHost(pkg.atoms)
    const hosted = new Map(pkg.atoms)
    hosted.delete(pkg.childAtom)
    const { report } = await run(pkg, host, { readHosted: reader(hosted) })
    expect(report.absentHere).toEqual([pkg.childAtom])
    expect(host.asked).toEqual([`https://hypercomb.com/${pkg.sharingAtom}`])
    expect(report.ok).toBe(false)
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/TYPESCRIPT NOT HOSTED — hypercomb\.com did not take 1 of 2 source atom\(s\)/)
    expect(text).toMatch(/1 atom\(s\) are not in this machine's relay content dir — publish again from this checkout/)
  })

  it('a host on this root that refuses every atom is not waited on: its worker does not take TypeScript yet', async () => {
    const pkg = aTypedPackage()
    const host = aTypedHost(new Map())
    let headReads = 0
    const { report, sleeps } = await run(pkg, host, { poolHead: async () => { headReads++; return { answered: true, head: pkg.root } } })
    expect(report.ok).toBe(false)
    expect(report.failed).toHaveLength(2)
    expect(sleeps).toEqual([])
    // The head is what tells a worker without the change from a host that is behind.
    expect(headReads).toBe(1)
    expect(report).toMatchObject({ headRead: true, answered: true, head: pkg.root })
    expect(host.asked).toHaveLength(2)
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/TYPESCRIPT NOT HOSTED — hypercomb\.com did not take 2 of 2 source atom\(s\) of [0-9a-f]{12}… \(first: [0-9a-f]{12}… — HTTP 404\)/)
    expect(text).toMatch(/The package is published and installs as before/)
    expect(text).toMatch(/hypercomb\.com announces this root and still refused every atom: its worker does not take TypeScript yet\. Deploy hypercomb-relay\/blossom-worker, then: npm run replicate:revision -- --sig /)
    expect(text).toContain(pkg.root)
  })

  it('a host that is behind took none because it is not on this root: the worker is not blamed', async () => {
    // The publish's confirm found the host behind, and the pass ran anyway.
    // The farm gives a root's TypeScript only once the host announces it, so
    // every atom is refused exactly as a worker without the change would.
    const pkg = aTypedPackage()
    const host = aTypedHost(new Map(), { head: STALE })
    const { report, sleeps } = await run(pkg, host, { current: false })
    expect(sleeps).toEqual([])
    expect(report).toMatchObject({ ok: false, headRead: true, answered: true, head: STALE, current: false })
    expect(report.failed).toHaveLength(2)
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/hypercomb\.com is not on this root yet \(its pool offers bbbbbbbbbbbb…\), and its farm gives a root's TypeScript only once it announces that root\. When it does: npm run replicate:revision -- --sig /)
    expect(text).not.toMatch(/worker|Deploy|superseded/)
    // The same with nobody having looked first, and with a pool that lists nothing.
    expect(typescriptVerdict({ ...report, current: undefined }).join('\n')).toMatch(/is not on this root yet \(its pool offers bbbbbbbbbbbb…\)/)
    const empty = typescriptVerdict({ ...report, head: null }).join('\n')
    expect(empty).toMatch(/is not on this root yet \(its pool lists no package\)/)
    expect(empty).not.toMatch(/worker|Deploy/)
  })

  it('a pool that cannot be read says so, and blames nothing', async () => {
    const pkg = aTypedPackage()
    const { report } = await run(pkg, aTypedHost(new Map()), { poolHead: async () => ({ answered: false, head: null }) })
    expect(report).toMatchObject({ headRead: true, answered: false, head: null })
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/hypercomb\.com's pool could not be read \(offline\?\), so why is not known\. With this machine on: npm run replicate:revision -- --sig /)
    expect(text).not.toMatch(/worker|Deploy/)
  })

  it('a pool read that throws or never answers does not hold the pass', async () => {
    const pkg = aTypedPackage()
    const thrown = await run(pkg, aTypedHost(new Map()), { poolHead: async () => { throw new Error('dns') } })
    expect(thrown.report).toMatchObject({ headRead: true, answered: false })
    expect(thrown.report.error).toBeUndefined()
    const hung = await run(pkg, aTypedHost(new Map()), { poolHead: () => new Promise(() => {}), askTimeoutMs: () => 20 })
    expect(hung.report).toMatchObject({ headRead: true, answered: false, head: null })
  })

  it('some taken and one missed: exactly one wait and one second ask for the miss', async () => {
    const pkg = aTypedPackage()
    const host = aTypedHost(pkg.atoms, { flaky: new Set([pkg.childAtom]) })
    const { report, sleeps } = await run(pkg, host, { poolHead: async () => ({ answered: true, head: pkg.root }) })
    expect(sleeps).toEqual([RETRY_AFTER_MS])
    expect(host.asked.filter(url => url.endsWith(pkg.childAtom))).toHaveLength(2)
    expect(host.asked.filter(url => url.endsWith(pkg.sharingAtom))).toHaveLength(1)
    expect(report).toMatchObject({ ok: true, failed: [], head: pkg.root })
  })

  it('a miss that stays a miss says to run it again with this machine on', async () => {
    const pkg = aTypedPackage()
    const farm = new Map(pkg.atoms)
    farm.delete(pkg.childAtom)
    const { report, sleeps } = await run(pkg, aTypedHost(farm), { poolHead: async () => ({ answered: true, head: pkg.root }) })
    expect(sleeps).toHaveLength(1)
    expect(report.failed).toEqual([{ sig: pkg.childAtom, why: 'HTTP 404' }])
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/hypercomb\.com announces this root but could not read the atoms from its farm, this machine's host\. With this machine on: npm run replicate:revision -- --sig /)
    expect(text).not.toMatch(/worker|Deploy/)
  })

  it('a host that was on this root and now announces another was superseded: not waited on, and no retry is printed', async () => {
    const pkg = aTypedPackage()
    const farm = new Map(pkg.atoms)
    farm.delete(pkg.childAtom)
    const host = aTypedHost(farm, { head: STALE })
    const { report, sleeps } = await run(pkg, host, { current: true })
    expect(sleeps).toEqual([])
    expect(report.head).toBe(STALE)
    expect(report.ok).toBe(false)
    expect(host.asked.filter(url => url.endsWith(pkg.childAtom))).toHaveLength(1)
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(/hypercomb\.com now announces bbbbbbbbbbbb…: this revision was superseded\. The folders both revisions share are held, the rest are hosted with that revision/)
    expect(text).not.toMatch(/npm run replicate:revision/)
    expect(text).not.toMatch(/worker|Deploy/)
  })

  it('every ask carries a clock sized to its atom', async () => {
    expect(askTimeoutMs(0)).toBe(30_000)
    // The largest folder, about 4 MB through a home uplink: minutes, not seconds.
    expect(askTimeoutMs(4 * 1_048_576)).toBeGreaterThanOrEqual(180_000)
    expect(askTimeoutMs(4 * 1_048_576)).toBeLessThanOrEqual(300_000)
    const pkg = aTypedPackage(true)
    const host = aTypedHost(pkg.atoms)
    const signals: Array<AbortSignal | null | undefined> = []
    const clocks: number[] = []
    const { report } = await run(pkg, host, {
      fetchImpl: (url, init) => { signals.push(init?.signal); return host.fetchImpl(url) },
      askTimeoutMs: bytes => { clocks.push(bytes); return askTimeoutMs(bytes) },
    })
    expect(report).toMatchObject({ ok: true, timedOut: 0, stopped: false })
    expect(signals).toHaveLength(4)
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal)
    expect([...clocks].sort((a, b) => a - b)).toEqual([...pkg.atoms.values()].map(bytes => bytes.byteLength).sort((a, b) => a - b))
  })

  it('a host whose answers never settle ends the pass after a few timeouts in a row, and the verdict says so', async () => {
    // A stalled stream used to hold the publish for minutes after PUBLISHED.
    // This fetch never settles and ignores its signal; only the ask's own
    // clock can end it. Ten atoms, so some are left when the pass stops.
    const layers = new Map<string, Uint8Array>()
    const atoms = new Map<string, Uint8Array>()
    const put = (into: Map<string, Uint8Array>, text: string): string => { const bytes = utf8(text); const sig = sha(bytes); into.set(sig, bytes); return sig }
    const cells = Array.from({ length: 10 }, (_, at) => put(layers, JSON.stringify({
      name: `folder${at}`, cells: [], bees: [], dependencies: [], typescript: put(atoms, `// @hypercomb/typescript/folder${at}\n`),
    })))
    const root = put(layers, JSON.stringify({ name: 'essentials', cells, bees: [], dependencies: [] }))
    const asked: string[] = []
    const sleeps: number[] = []
    const started = Date.now()
    const report = await replicateTypescript({
      root, host: 'hypercomb.com', readLocal: reader(layers), readHosted: reader(atoms), current: true,
      fetchImpl: url => { asked.push(url); return new Promise<Response>(() => {}) },
      askTimeoutMs: () => 25, sleep: async ms => { sleeps.push(ms) }, log: () => {},
    })
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(report).toMatchObject({ ok: false, named: 10, stopped: true, headRead: true, answered: false, copied: [], held: 0 })
    expect(report.timedOut).toBeGreaterThanOrEqual(TYPESCRIPT_TIMEOUTS)
    expect(report.failed).toHaveLength(10)
    const unasked = report.failed.filter(failure => failure.why.startsWith('not asked'))
    expect(unasked.length).toBeGreaterThan(0)
    // An atom not asked for made no request; the rest are the atoms and the pool read.
    const atomAsks = asked.filter(url => /\/[a-f0-9]{64}$/.test(url))
    expect(atomAsks).toHaveLength(10 - unasked.length)
    expect(report.failed.filter(failure => /^no answer in \d+ s$/.test(failure.why))).toHaveLength(report.timedOut)
    // A stalled host is not waited on for the retry either.
    expect(sleeps).toEqual([])
    const text = typescriptVerdict(report).join('\n')
    expect(text).toMatch(new RegExp(`The pass stopped after ${TYPESCRIPT_TIMEOUTS} asks in a row got no answer in time; ${unasked.length} atom\\(s\\) were not asked for`))
    expect(text).not.toMatch(/worker|Deploy/)
  })

  it('a timeout between answers does not stop the pass: only a run of them does', async () => {
    const pkg = aTypedPackage(true)
    const host = aTypedHost(pkg.atoms)
    const stalls = new Set([pkg.large[1]!])
    const { report } = await run(pkg, host, {
      fetchImpl: url => stalls.has(url.slice(-64)) ? new Promise<Response>(() => {}) : host.fetchImpl(url),
      askTimeoutMs: () => 40, poolHead: async () => ({ answered: true, head: pkg.root }), retryAfterMs: 0,
    })
    expect(report.stopped).toBe(false)
    expect(report.copied).toHaveLength(3)
    expect(report.failed.map(failure => failure.sig)).toEqual([pkg.large[1]])
    expect(typescriptVerdict(report).join('\n')).not.toMatch(/The pass stopped/)
  })

  it('bytes that do not hash to their name are a failure', async () => {
    const pkg = aTypedPackage()
    const host = aTypedHost(pkg.atoms, { lies: new Set([pkg.childAtom]) })
    const { report } = await run(pkg, host, { poolHead: async () => ({ answered: true, head: pkg.root }) })
    expect(report.failed).toEqual([{ sig: pkg.childAtom, why: 'bytes that are not its name' }])
    expect(report.ok).toBe(false)
  })

  it('atoms over a mebibyte are asked for alone, largest first', async () => {
    const pkg = aTypedPackage(true)
    const host = aTypedHost(pkg.atoms)
    const { report } = await run(pkg, host)
    expect(report).toMatchObject({ ok: true, named: 4 })
    expect(host.mostLargeInFlight()).toBe(1)
    expect(host.asked.slice(0, 2)).toEqual([pkg.large[1], pkg.large[0]].map(sig => `https://hypercomb.com/${sig}`))
  })

  it('a fault on this machine is a report, never a throw', async () => {
    const pkg = aTypedPackage()
    const report = await replicateTypescript({ root: pkg.root, host: 'hypercomb.com', readLocal: async () => { throw new Error('disk gone') }, readHosted: reader(pkg.atoms), fetchImpl: aTypedHost(pkg.atoms).fetchImpl, log: () => {} })
    expect(report.ok).toBe(true)
    expect(report.named).toBe(0)
    const broken = await replicateTypescript({ root: pkg.root, host: 'hypercomb.com', readLocal: reader(pkg.layers), readHosted: async () => { throw new Error('disk gone') }, log: () => {} })
    expect(broken).toMatchObject({ ok: false, error: 'disk gone' })
    expect(typescriptVerdict(broken)).toEqual([expect.stringMatching(/TypeScript: not asked of hypercomb\.com \(disk gone\); the package is published and installs as before/)])
    expect((await replicateTypescript({ root: 'nope', host: 'hypercomb.com' })).ok).toBe(false)
  })
})
