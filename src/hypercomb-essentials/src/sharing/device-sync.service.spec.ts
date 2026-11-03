// sharing/device-sync.service.spec.ts — two whole devices. Each has its own
// in-memory store and its own service; they are joined by a fake relay and fake
// WebRTC peers, and they pull with a walker that keeps the runtime's contract. One
// presses sync; the other answers. Real secp256k1 keys and real NIP-44.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})
// jsdom's Blob has no arrayBuffer(); a real browser's does.
vi.stubGlobal('Blob', NodeBlob)

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { EffectBus } from '@hypercomb/core'
import { mintDelegation, type NostrEventLike } from './device-delegation.js'
import { emptyPairing, encodeToken, recordMinted, savePairing, takeToken } from './device-pairing.js'
import { DeviceSyncService, type DeviceSyncState, type SyncDeps } from './device-sync.service.js'
import { markersOf, memStore, putAtom, lay, sha, FakePeer, relay } from './device-sync.fixtures.js'

const masterSecret = generateSecretKey()
const laptopSecret = generateSecretKey()
const master = getPublicKey(masterSecret)
const laptop = getPublicKey(laptopSecret)
const bag = (n: number) => n.toString(16).padStart(64, 'a')

const signerOf = (secret: Uint8Array) => ({
  getPublicKeyHex: async () => getPublicKey(secret),
  knownPublicKeyHex: async () => getPublicKey(secret),
  signEvent: async (evt: any) => finalizeEvent(evt, secret) as unknown as NostrEventLike,
  nip44Encrypt: async (peer: string, text: string) => nip44.encrypt(text, nip44.getConversationKey(secret, peer)),
  nip44Decrypt: async (peer: string, payload: string) => { try { return nip44.decrypt(payload, nip44.getConversationKey(secret, peer)) } catch { return null } },
})

/**
 * The runtime's walker, by its contract: fetch what is missing, hash it against
 * its name before admitting it, follow the signatures it names, report holes and
 * refusals. (Essentials cannot import the runtime, so the real one is covered by
 * hypercomb-runtime/src/replication-walker.spec.ts; the service only needs this shape.)
 */
const walker: SyncDeps['walker'] = {
  async resolveSignatureClosure(root, io) {
    const result = { holes: [] as string[], refused: [] as string[], limited: false }
    const queue = [root]; const seen = new Set(queue)
    while (queue.length) {
      const signature = queue.pop()!
      let bytes = await io.read(signature)
      if (!bytes) {
        bytes = await io.fetch(signature)
        if (!bytes) { result.holes.push(signature); continue }
        if ((await sha(bytes)) !== signature) { result.refused.push(signature); continue }
        await io.write(signature, bytes)
      }
      for (const m of new TextDecoder().decode(bytes).matchAll(/[a-f0-9]{64}/g)) if (!seen.has(m[0])) { seen.add(m[0]); queue.push(m[0]) }
    }
    return result
  },
  isComplete: result => !result.limited && result.holes.length === 0 && result.refused.length === 0,
}

type Device = { store: ReturnType<typeof memStore>; service: DeviceSyncService; deps: SyncDeps }

const device = (net: ReturnType<typeof relay>, secret: Uint8Array, connectMs?: number): Device => {
  const store = memStore()
  const deps: SyncDeps = {
    store: store as unknown as SyncDeps['store'],
    mesh: net.meshFor(getPublicKey(secret)) as unknown as SyncDeps['mesh'],
    signer: signerOf(secret),
    walker,
    rtc: { createPeer: () => new FakePeer() as any, ...(connectMs ? { connectMs } : {}) },
  }
  return { store, deps, service: new DeviceSyncService(() => deps) }
}

/** The master has a hive with history; the laptop is paired to it and empty. */
const pairedPair = async (connectMs?: number) => {
  const net = relay()
  const a = device(net, masterSecret, connectMs)
  const b = device(net, laptopSecret, connectMs)

  const leaf = await putAtom(a.store, 'leaf bytes')
  const v0 = await putAtom(a.store, JSON.stringify({ name: 'home v0', cells: [leaf] }))
  const v1 = await putAtom(a.store, JSON.stringify({ name: 'home v1', cells: [leaf] }))
  const child = await putAtom(a.store, JSON.stringify({ name: 'child', cells: [leaf] }))
  await lay(a.store, bag(1), 0, v0); await lay(a.store, bag(1), 1, v1)
  await lay(a.store, bag(2), 0, child)

  const grant = (await mintDelegation(signerOf(masterSecret), laptop))!
  await savePairing(a.store as any, recordMinted(emptyPairing(), master, grant))
  const taken = takeToken(emptyPairing(), encodeToken([grant]), laptop)
  if (!taken.ok) throw new Error('pairing failed in the fixture')
  await savePairing(b.store as any, taken.state)
  return { net, a, b, leaf, v0, v1, child }
}

const states: DeviceSyncState[] = []
let off: (() => void) | null = null
beforeEach(() => {
  states.length = 0
  off = EffectBus.on<DeviceSyncState>('device-sync:state', s => { states.push(s) })
})
afterEach(() => { off?.() })

describe('the sync service', () => {
  it('the laptop presses sync and ends level with the master: markers, layers and the atoms under them', async () => {
    const { a, b, leaf, v0, v1, child } = await pairedPair()
    await a.service.refresh()   // the master is awake and answering
    await b.service.refresh()
    expect(b.service.state).toMatchObject({ paired: true, peers: 1 })

    const after = await b.service.run()

    expect(after).toMatchObject({ phase: 'done', summary: { reached: 1, unreachable: 0, advanced: 2, markers: 3, forks: 0, failed: 0 } })
    expect(markersOf(b.store, bag(1))).toEqual(['00000000', '00000001'])
    expect(markersOf(b.store, bag(2))).toEqual(['00000000'])
    for (const sig of [leaf, v0, v1, child]) expect((await b.store.getResourceLocal(sig))?.size).toBeGreaterThan(0)
    expect(states.map(s => s.phase)).toContain('syncing')
    expect(states.at(-1)?.phase).toBe('done')
  })

  it('any node can be the backup: the master pulls what only the laptop made', async () => {
    const { a, b } = await pairedPair()
    const mine = await putAtom(b.store, JSON.stringify({ name: 'made on the laptop', cells: [] }))
    await lay(b.store, bag(9), 0, mine)
    await a.service.refresh(); await b.service.refresh()

    const after = await a.service.run()
    expect(after).toMatchObject({ phase: 'done', summary: { reached: 1, markers: 1 } })
    expect(markersOf(a.store, bag(9))).toEqual(['00000000'])
  })

  it('a second press finds nothing to do', async () => {
    const { a, b } = await pairedPair()
    await a.service.refresh(); await b.service.refresh()
    await b.service.run()
    const again = await b.service.run()
    expect(again.summary).toMatchObject({ reached: 1, markers: 0, advanced: 0 })
  })

  it('says so when the other device is not awake, and moves nothing', async () => {
    const { b } = await pairedPair(60)
    await b.service.refresh()
    const after = await b.service.run()
    expect(after).toMatchObject({ phase: 'error', summary: { reached: 0, unreachable: 1, markers: 0 } })
    expect(markersOf(b.store, bag(1))).toEqual([])
  })

  it('an unpaired device opens nothing: no relay subscription, no button', async () => {
    const net = relay()
    const lone = device(net, generateSecretKey())
    await lone.service.refresh()
    expect(lone.service.state).toMatchObject({ paired: false, peers: 0 })
    expect(net.subscriptions).toEqual([])
    expect((await lone.service.run()).phase).toBe('idle')
  })

  it('a device the master has revoked is turned away by a master that knows', async () => {
    const { a, b } = await pairedPair(60)
    // The master takes the laptop out, and saves that.
    const { mintRevocation } = await import('./device-delegation.js')
    const revoke = (await mintRevocation(signerOf(masterSecret), laptop))!
    const { loadPairing } = await import('./device-pairing.js')
    await savePairing(a.store as any, recordMinted(await loadPairing(a.store as any), master, revoke))
    await a.service.refresh(); await b.service.refresh()

    // The master is no longer listening for the laptop, so the laptop's dial finds no one.
    const after = await b.service.run()
    expect(after.summary).toMatchObject({ reached: 0, unreachable: 1 })
    expect(markersOf(b.store, bag(1))).toEqual([])
  })
})
