// sharing/device-sync.spec.ts — the walk between two devices over a real,
// proven link: new bags, bags the peer is ahead on, complete-before-marker,
// forks, and what it leaves alone. Atoms are real sha256-named bytes, so an
// atom the peer lacks or mangles is caught the way it would be in the app.

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { SignatureService } from '@hypercomb/core'
import { mintDelegation, type EventSigner, type NostrEventLike } from './device-delegation.js'
import { DeviceLink, type BagHead, type LinkChannel, type LinkIdentity } from './device-link.js'
import { syncFromPeer, type Pull, type SyncStore } from './device-sync.js'

const signerOf = (secret: Uint8Array): EventSigner => ({
  signEvent: async evt => finalizeEvent(evt, secret) as unknown as NostrEventLike,
})
const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)

const pipe = (): [LinkChannel, LinkChannel] => {
  const make = (): LinkChannel & { peer?: LinkChannel; closed: boolean } => ({
    closed: false, onmessage: null, onclose: null,
    send(text: string) { const to = this.peer; queueMicrotask(() => { if (!this.closed && to && !(to as any).closed) to.onmessage?.(text) }) },
    close() { if (this.closed) return; this.closed = true; const to = this.peer as any; queueMicrotask(() => { if (to && !to.closed) { to.closed = true; to.onclose?.() } }) },
  })
  const a = make(); const b = make(); a.peer = b; b.peer = a
  return [a, b]
}

// --- a device: a heap of sha256-named atoms and bags of markers -----------------

type Device = { heap: Map<string, Uint8Array>; bags: Map<string, string[]> }
const device = (): Device => ({ heap: new Map(), bags: new Map() })

const sha = async (bytes: Uint8Array) => SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
const put = async (d: Device, text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const sig = await sha(bytes)
  d.heap.set(sig, bytes)
  return sig
}
/** A layer naming children — the walk follows the signatures it finds in the text. */
const layer = (d: Device, name: string, children: string[] = []) => put(d, JSON.stringify({ name, cells: children }))

const bagSig = (n: number) => n.toString(16).padStart(64, 'b')
const markerAt = (i: number) => String(i).padStart(8, '0')

const headsOf = (d: Device): BagHead[] =>
  [...d.bags].filter(([, layers]) => layers.length).map(([bag, layers]) => ({ bag, name: markerAt(layers.length - 1), layer: layers[layers.length - 1]! }))

const storeOf = (d: Device, refuse = false): SyncStore => ({
  heads: async () => headsOf(d),
  markerLayer: async (bag, name) => d.bags.get(bag)?.[Number(name)] ?? null,
  appendMarker: async (bag, name, l) => {
    const layers = d.bags.get(bag) ?? []
    if (refuse || Number(name) !== layers.length) return false
    d.bags.set(bag, [...layers, l])
    return true
  },
})

/** The replication walk, reduced: fetch what is missing, hash it against its name, follow what it names. */
const pullInto = (d: Device): Pull => async (root, fetch) => {
  const todo = [root]; const seen = new Set<string>()
  while (todo.length) {
    const sig = todo.pop()!
    if (seen.has(sig)) continue
    seen.add(sig)
    let bytes = d.heap.get(sig) ?? null
    if (!bytes) {
      const got = await fetch(sig)
      if (!got || (await sha(got)) !== sig) return false
      d.heap.set(sig, got); bytes = got
    }
    for (const m of new TextDecoder().decode(bytes).matchAll(/[a-f0-9]{64}/g)) todo.push(m[0])
  }
  return true
}

const connect = async (source: Device, backup: Device, sourceServesHeads = true) => {
  const grant = (await mintDelegation(signerOf(masterSecret), laptop))!
  const sourceId: LinkIdentity = { signer: signerOf(masterSecret), self: master, master, grant: null, known: () => [] }
  const backupId: LinkIdentity = { signer: signerOf(laptopSecret), self: laptop, master, grant, known: () => [] }
  const [a, b] = pipe()
  const sourceServe = sourceServesHeads
    ? { atom: async (s: string) => source.heap.get(s) ?? null, heads: async () => headsOf(source), marker: async (bag: string, name: string) => source.bags.get(bag)?.[Number(name)] ?? null }
    : async (s: string) => source.heap.get(s) ?? null
  const sourceLink = new DeviceLink(a, sourceId, sourceServe)
  const backupLink = new DeviceLink(b, backupId, async () => null)
  sourceLink.start(); backupLink.start()
  await Promise.all([sourceLink.ready, backupLink.ready])
  return backupLink
}

describe('the walk', () => {
  it('a new backup takes the whole tree, history and all, from any device', async () => {
    const source = device(); const backup = device()
    const leaf = await put(source, 'leaf')
    const l0 = await layer(source, 'root v0'); const l1 = await layer(source, 'root v1', [leaf]); const l2 = await layer(source, 'root v2', [leaf])
    const c0 = await layer(source, 'child v0', [leaf])
    source.bags.set(bagSig(1), [l0, l1, l2]); source.bags.set(bagSig(2), [c0])

    const link = await connect(source, backup)
    const progress: number[] = []
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup), p => progress.push(p.markers))

    expect(summary).toMatchObject({ ok: true, bags: 2, advanced: 2, markers: 4, level: 0, forks: [], failed: [] })
    expect(backup.bags.get(bagSig(1))).toEqual([l0, l1, l2])
    expect(backup.bags.get(bagSig(2))).toEqual([c0])
    for (const sig of [leaf, l0, l1, l2, c0]) expect(backup.heap.has(sig)).toBe(true)
    expect(progress.at(-1)).toBe(4)
  })

  it('only adds: a second press moves nothing, and a bag the peer is ahead on takes just the new markers', async () => {
    const source = device(); const backup = device()
    const l0 = await layer(source, 'v0'); const l1 = await layer(source, 'v1'); const l2 = await layer(source, 'v2')
    source.bags.set(bagSig(1), [l0, l1])
    const link = await connect(source, backup)
    await syncFromPeer(link, storeOf(backup), pullInto(backup))

    expect(await syncFromPeer(link, storeOf(backup), pullInto(backup))).toMatchObject({ advanced: 0, markers: 0, level: 1 })

    source.bags.set(bagSig(1), [l0, l1, l2])
    expect(await syncFromPeer(link, storeOf(backup), pullInto(backup))).toMatchObject({ advanced: 1, markers: 1 })
    expect(backup.bags.get(bagSig(1))).toEqual([l0, l1, l2])
  })

  it('leaves a bag it is ahead on alone, and a bag only it holds', async () => {
    const source = device(); const backup = device()
    const l0 = await layer(source, 'v0')
    source.bags.set(bagSig(1), [l0])
    const mineOnly = await layer(backup, 'mine only'); const ahead = await layer(backup, 'ahead')
    backup.heap.set(l0, source.heap.get(l0)!)
    backup.bags.set(bagSig(1), [l0, ahead]); backup.bags.set(bagSig(9), [mineOnly])

    const link = await connect(source, backup)
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup))
    expect(summary).toMatchObject({ ok: true, advanced: 0, markers: 0, level: 1, forks: [], failed: [] })
    expect(backup.bags.get(bagSig(1))).toEqual([l0, ahead])
    expect(backup.bags.get(bagSig(9))).toEqual([mineOnly])
  })

  it('records a fork and touches neither side: same point, two different next layers', async () => {
    const source = device(); const backup = device()
    const shared = await layer(source, 'shared')
    backup.heap.set(shared, source.heap.get(shared)!)
    const theirs = await layer(source, 'their edit'); const mine = await layer(backup, 'my edit')
    source.bags.set(bagSig(1), [shared, theirs, await layer(source, 'their later edit')])
    backup.bags.set(bagSig(1), [shared, mine])

    const link = await connect(source, backup)
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup))
    expect(summary.forks).toEqual([{ bag: bagSig(1), name: markerAt(1), mine, theirs }])
    expect(summary).toMatchObject({ advanced: 0, markers: 0 })
    expect(backup.bags.get(bagSig(1))).toEqual([shared, mine])
  })

  it('takes a marker only after its layer is wholly here — a missing atom stops that bag, not the others', async () => {
    const source = device(); const backup = device()
    const goodLeaf = await put(source, 'good leaf')
    const good = await layer(source, 'good', [goodLeaf])
    // A layer naming an atom the source does not hold.
    const phantom = await sha(new TextEncoder().encode('never stored'))
    const broken = await layer(source, 'broken', [phantom])
    source.bags.set(bagSig(1), [broken]); source.bags.set(bagSig(2), [good])

    const link = await connect(source, backup)
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup))
    expect(summary.failed).toEqual([{ bag: bagSig(1), reason: `layer for ${markerAt(0)} incomplete` }])
    expect(backup.bags.has(bagSig(1))).toBe(false)
    expect(backup.bags.get(bagSig(2))).toEqual([good])
    expect(summary).toMatchObject({ advanced: 1, markers: 1 })
  })

  it('refuses an atom whose bytes do not hash to its name', async () => {
    const source = device(); const backup = device()
    const leaf = await put(source, 'honest')
    const l0 = await layer(source, 'v0', [leaf])
    source.heap.set(leaf, new TextEncoder().encode('swapped in transit'))
    source.bags.set(bagSig(1), [l0])
    const link = await connect(source, backup)
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup))
    expect(summary.failed).toHaveLength(1)
    expect(backup.bags.has(bagSig(1))).toBe(false)
    expect(backup.heap.has(leaf)).toBe(false)
  })

  it('reports a marker the store would not take, and says not-ok for a peer that serves no heads', async () => {
    const source = device(); const backup = device()
    source.bags.set(bagSig(1), [await layer(source, 'v0')])
    const link = await connect(source, backup)
    const refused = await syncFromPeer(link, storeOf(backup, true), pullInto(backup))
    expect(refused.failed).toEqual([{ bag: bagSig(1), reason: `marker ${markerAt(0)} not appended` }])

    const atomsOnly = await connect(source, device(), false)
    expect(await syncFromPeer(atomsOnly, storeOf(device()), pullInto(device()))).toMatchObject({ ok: false, bags: 0 })
  })

  it('pages a large tree', async () => {
    const source = device(); const backup = device()
    const l = await layer(source, 'same')
    for (let i = 0; i < 450; i++) source.bags.set(bagSig(100 + i), [l])
    const link = await connect(source, backup)
    const summary = await syncFromPeer(link, storeOf(backup), pullInto(backup))
    expect(summary).toMatchObject({ ok: true, bags: 450, advanced: 450, markers: 450 })
    expect(backup.bags.size).toBe(450)
  })
})
