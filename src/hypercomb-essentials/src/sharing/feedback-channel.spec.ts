// feedback-channel.spec.ts — the durable transport's loss-window guarantees.
//
// The scenario that motivated the reconcile: a participant's browser runs an
// OLDER essentials bundle (push-only web install), writes kind:'feedback'
// records strictly locally, and only later receives the channel code. The
// pending map alone can't rescue those records — they were never pended. The
// substrate reconcile must find them, publish them, and never re-publish
// anything the relay already confirmed holding.
//
// window.ioc is stubbed BEFORE the module import (the drone self-registers at
// load). Store blobs are duck-typed ({ text() }) so nothing depends on the
// jsdom Blob implementation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SIG_FEEDBACK = 'a'.repeat(64)
const SIG_ANSWER = 'b'.repeat(64)
const SIG_DIGEST = 'c'.repeat(64)
const CHANNEL_ID = 'f'.repeat(64)

const REC_FEEDBACK = JSON.stringify({ kind: 'feedback', text: 'the search is slow', at: 1 })
const REC_ANSWER = JSON.stringify({ kind: 'qa-answer', qId: 'q1', answer: 'yes', at: 2 })
const REC_DIGEST = JSON.stringify({ kind: 'notes-digest', digest: 'd'.repeat(64), at: 3 })

type MeshEvt = { relay: string; sig: string; event: { kind?: number } | null; payload: unknown }

const makeMesh = () => {
  const subs: Array<(e: MeshEvt) => void> = []
  return {
    publish: vi.fn(async () => true),
    subscribe: vi.fn((_sig: string, cb: (e: MeshEvt) => void, _opts?: { sinceSec?: number | null }) => { subs.push(cb); return { close: () => void 0 } }),
    query: vi.fn(async (): Promise<MeshEvt[]> => []),
    isNetworkEnabled: () => true,
    setNetworkEnabled: () => void 0,
    subs,
  }
}

const makeStore = (records: Record<string, string>) => ({
  listOptimizations: vi.fn(async () => Object.keys(records)),
  getOptimization: vi.fn(async (sig: string) =>
    sig in records ? ({ text: async () => records[sig] } as unknown as Blob) : null),
  putOptimization: vi.fn(async (blob: Blob, options?: { emit?: boolean }) => { void blob; void options; return SIG_FEEDBACK }),
})

const served = (sig: string, text = ''): MeshEvt =>
  ({ relay: 'wss://jwize.com', sig: 'evt', event: { kind: 30213 }, payload: { t: text, s: sig } })

let mesh: ReturnType<typeof makeMesh>
let store: ReturnType<typeof makeStore>
const iocRegistry = (): Record<string, unknown> => ({
  '@diamondcoreprocessor.com/NostrMeshDrone': mesh,
  '@hypercomb.social/Store': store,
  '@diamondcoreprocessor.com/SwarmDrone': { subscribedTo: () => '' },
})

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => iocRegistry()[key],
}

const { FeedbackChannelDrone } = await import('./feedback-channel.drone.js')

const pendingMap = (): Record<string, number> =>
  JSON.parse(localStorage.getItem('hc:feedback-channel:pending') ?? '{}')
const confirmedMap = (): Record<string, number> =>
  JSON.parse(localStorage.getItem('hc:feedback-channel:confirmed') ?? '{}')

let drone: InstanceType<typeof FeedbackChannelDrone>

const boot = async (records: Record<string, string>) => {
  mesh = makeMesh()
  store = makeStore(records)
  drone = new FeedbackChannelDrone()
  await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
}

beforeEach(() => {
  localStorage.clear()
  // Explicit channel override — #resolveChannelId short-circuits before any
  // crypto, keeping these tests independent of the environment's WebCrypto.
  localStorage.setItem('hc:feedback-channel:id', CHANNEL_ID)
})

afterEach(() => drone?.disable())

describe('feedback-channel reconcile', () => {
  it('rescues stranded syncable records and publishes them; skips bookkeeping kinds', async () => {
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK, [SIG_ANSWER]: REC_ANSWER, [SIG_DIGEST]: REC_DIGEST })
    await drone.reconcile()

    const publishedSigs = mesh.publish.mock.calls.map(c => (c as unknown[])[2]).map(p => (p as { s: string }).s)
    expect(publishedSigs).toContain(SIG_FEEDBACK)
    expect(publishedSigs).toContain(SIG_ANSWER)
    expect(publishedSigs).not.toContain(SIG_DIGEST)
    // relay never confirmed → both rest in the pending map for the drain timer
    expect(Object.keys(pendingMap()).sort()).toEqual([SIG_FEEDBACK, SIG_ANSWER].sort())
  })

  it('never re-publishes records the relay already holds', async () => {
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK, [SIG_ANSWER]: REC_ANSWER })
    mesh.query.mockResolvedValue([served(SIG_FEEDBACK, REC_FEEDBACK)])
    await drone.reconcile()

    const publishedSigs = mesh.publish.mock.calls.map(c => (c as unknown[])[2]).map(p => (p as { s: string }).s)
    expect(publishedSigs).not.toContain(SIG_FEEDBACK)
    expect(publishedSigs).toContain(SIG_ANSWER)
    expect(confirmedMap()).toHaveProperty(SIG_FEEDBACK)
  })

  it('persists read-back receipts into the confirmed ledger', async () => {
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK })
    await drone.reconcile()
    expect(pendingMap()).toHaveProperty(SIG_FEEDBACK)

    mesh.query.mockResolvedValue([served(SIG_FEEDBACK, REC_FEEDBACK)])
    await drone.drain()
    expect(pendingMap()).not.toHaveProperty(SIG_FEEDBACK)
    expect(confirmedMap()).toHaveProperty(SIG_FEEDBACK)
  })

  it('runs once per browser — the flag short-circuits a fresh instance', async () => {
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK })
    mesh.query.mockResolvedValue([served(SIG_FEEDBACK, REC_FEEDBACK)])
    await drone.reconcile()
    expect(localStorage.getItem('hc:feedback-channel:reconciled')).toBe('1')
    drone.disable()
    localStorage.setItem('hc:feedback-channel:enabled', 'true')   // re-enable roles for the second instance

    const secondStore = makeStore({ [SIG_FEEDBACK]: REC_FEEDBACK })
    store = secondStore
    drone = new FeedbackChannelDrone()
    await (drone as unknown as { pulse: (g: string) => Promise<void> }).pulse('test')
    await drone.reconcile()
    expect(secondStore.listOptimizations).not.toHaveBeenCalled()
  })

  it('24h sweep drops the pending entry but re-arms the reconcile instead of losing the record', async () => {
    localStorage.setItem('hc:feedback-channel:reconciled', '1')
    localStorage.setItem('hc:feedback-channel:pending',
      JSON.stringify({ [SIG_FEEDBACK]: Date.now() - 25 * 60 * 60 * 1000 }))
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK })

    await drone.drain()
    expect(pendingMap()).not.toHaveProperty(SIG_FEEDBACK)
    expect(confirmedMap()).not.toHaveProperty(SIG_FEEDBACK)
    expect(localStorage.getItem('hc:feedback-channel:reconciled')).toBeNull()
  })

  it('marks an incomplete pass (read failure) for retry instead of setting the flag', async () => {
    await boot({ [SIG_FEEDBACK]: REC_FEEDBACK, [SIG_ANSWER]: REC_ANSWER })
    store.getOptimization.mockImplementation(async (sig: string) => {
      if (sig === SIG_ANSWER) throw new Error('opfs read failed')
      return { text: async () => REC_FEEDBACK } as unknown as Blob
    })
    await drone.reconcile()

    expect(pendingMap()).toHaveProperty(SIG_FEEDBACK)
    expect(localStorage.getItem('hc:feedback-channel:reconciled')).toBeNull()
  })
})

describe('feedback-channel host ingest', () => {
  it('confirms items arriving from a real relay so they are never re-published under our key', async () => {
    localStorage.setItem('hc:feedback-channel:enabled', 'true')   // HOST mode
    await boot({})

    expect(mesh.subs.length).toBeGreaterThan(0)
    // The host must ask the relay to REPLAY stored items across the full item
    // TTL — the mesh's 15-min default silently loses offline-published items.
    const subOpts = mesh.subscribe.mock.calls[0][2] as { sinceSec?: number | null } | undefined
    expect(subOpts?.sinceSec).toBe(7 * 24 * 60 * 60)
    // A peer's feedback arrives. Sig verification uses real sha256 inside the
    // drone, so the claimed sig must be honest — compute it the same way.
    const { SignatureService } = await import('@hypercomb/core')
    const text = JSON.stringify({ kind: 'feedback', text: 'from a visitor', at: 9 })
    const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)

    for (const cb of mesh.subs) cb(served(sig, text))
    await new Promise(r => setTimeout(r, 25))   // handler is async fire-and-forget

    expect(confirmedMap()).toHaveProperty(sig)
    expect(store.putOptimization).toHaveBeenCalledTimes(1)
    const opts = store.putOptimization.mock.calls[0][1] as { emit?: boolean } | undefined
    expect(opts?.emit).toBe(false)
  })
})
