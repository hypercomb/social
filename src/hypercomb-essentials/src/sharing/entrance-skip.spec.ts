// sharing/entrance-skip.spec.ts — SKIP IS WRITTEN. The Publish panel's Skip
// puts the offered page away in the concealment pool itself (the concealment
// bee may be asleep, and `hidden:conceal` does not wake it), asks that bee to
// refresh, and the scout's next look stays quiet about the page. One record
// per OFFER — the page at that address — so a skip at a second address never
// undoes the first. End to end: the real drone, the real concealment module,
// the real scout, and an in-memory pool directory.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { HiveManifest } from './hive-pointer.js'

const ZONE = 'jwize.com'
/** The app address the entrance runs at. */
const APP = `business-card.${ZONE}`
/** A second app address following the same publisher. */
const SECOND = 'business-card.pluginthematrix.com'
const OWN = 'a'.repeat(64)
const PUB = 'b'.repeat(64)
const RUNS = 'c'.repeat(64)
const NEWER = 'd'.repeat(64)
const HEAD = 'e'.repeat(64)

// ── an in-memory pool directory, shaped as the store hands one out ────────
const files = new Map<string, Uint8Array>()
const readBlob = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
  reader.onerror = () => reject(reader.error)
  reader.readAsArrayBuffer(blob)
})
const fileHandle = (name: string) => ({
  kind: 'file' as const,
  name,
  getFile: async () => {
    const bytes = files.get(name) ?? new Uint8Array()
    return { size: bytes.byteLength, text: async () => new TextDecoder().decode(bytes) }
  },
  createWritable: async () => {
    const parts: Uint8Array[] = []
    return {
      write: async (data: Blob | ArrayBuffer | Uint8Array) => {
        parts.push(data instanceof Blob ? await readBlob(data) : data instanceof Uint8Array ? data : new Uint8Array(data))
      },
      close: async () => {
        const out = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0))
        let at = 0
        for (const part of parts) { out.set(part, at); at += part.byteLength }
        files.set(name, out)
      },
    }
  },
})
const pool = {
  kind: 'directory' as const,
  name: 'hidden-items',
  entries: async function* () { for (const name of [...files.keys()]) yield [name, fileHandle(name)] as const },
  getFileHandle: async (name: string, options?: { create?: boolean }) => {
    if (!files.has(name)) {
      if (!options?.create) throw new Error('NotFoundError')
      files.set(name, new Uint8Array())
    }
    return fileHandle(name)
  },
  removeEntry: async (name: string) => { files.delete(name) },
}

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  whenReady: () => void 0,
  get: (key: string): unknown => key === '@hypercomb.social/Store'
    ? { getPool: async (meaning: string) => (meaning === 'hidden:items' ? pool : null) }
    : undefined,
}

await import('./publish-status.drone.js')
const { ENTRANCE_SKIP_SCOPE, ENTRANCE_UPDATE_EFFECT, EntranceScoutService, entranceSkipSig } = await import('./entrance-scout.service.js')
const { conceal, listConcealed } = await import('../concealment/concealment.js')

const powered = { page: RUNS, powers: ['keep', 'camera', 'read'] as ('keep' | 'camera' | 'read')[], from: { pubkey: PUB, lineage: 'card', at: 1 } }
const manifests: Record<string, HiveManifest> = {
  [OWN]: { roots: {}, createdAt: 1, pubkey: OWN, entrances: { [APP]: powered, [SECOND]: powered } },
  [PUB]: { roots: { card: HEAD }, createdAt: 2, pubkey: PUB },
}

beforeEach(() => { files.clear() })

/** What the concealment bee renders after a refresh: the pool as it stands. */
const render = async (): Promise<void> => {
  EffectBus.emit('hidden:render', { items: (await listConcealed()).filter(i => i.state === 'hidden'), gone: [] })
}
const skip = async (host: string): Promise<void> => {
  const before = (await listConcealed()).length
  EffectBus.emit(ENTRANCE_UPDATE_EFFECT, { host, current: RUNS, offered: NEWER, at: 2 })
  EffectBus.emit('publish:entrance-skip', { key: 'jwize', host, page: NEWER })
  await vi.waitFor(async () => { expect((await listConcealed()).length).toBe(before + 1) })
}
const scoutDeps = (emitted: unknown[]) => ({
  hosts: async () => [ZONE],
  ownPubkey: async () => OWN,
  fetchManifest: async (_hosts: readonly string[], pubkey: string) => manifests[pubkey] ?? null,
  pageAt: async () => NEWER,
  emit: (update: unknown) => { emitted.push(update) },
})

describe('skipping an offered page', () => {
  it('writes the skip to the pool, asks the put-away list to refresh, and the next look stays silent', async () => {
    // Without a skip, this look would announce the page.
    const before: unknown[] = []
    await new EntranceScoutService().check({ ...scoutDeps(before), skipped: async () => new Set() })
    expect(before).toHaveLength(2)

    const refreshed = vi.fn()
    const off = EffectBus.on('hidden:refresh', refreshed)
    EffectBus.emit(ENTRANCE_UPDATE_EFFECT, { host: APP, current: RUNS, offered: NEWER, at: 2 })
    EffectBus.emit('publish:entrance-skip', { key: 'jwize', host: APP, page: NEWER })

    const offer = await entranceSkipSig(APP, NEWER)
    await vi.waitFor(async () => {
      const held = await listConcealed()
      expect(held.map(i => ({ sig: i.sig, scope: i.scope, from: i.from, state: i.state })))
        .toEqual([{ sig: offer, scope: ENTRANCE_SKIP_SCOPE, from: `${APP} ${NEWER}`, state: 'hidden' }])
    })
    expect(refreshed).toHaveBeenCalled()
    off()

    // The scout reads the pool for itself (no skip list handed in): quiet at
    // this address, still offering the page at the other.
    const after: unknown[] = []
    expect(await new EntranceScoutService().check(scoutDeps(after))).toEqual([expect.objectContaining({ host: SECOND, offered: NEWER })])
  })

  it('skipping the same page at a second address keeps the first skip — in the pool, in the panel, and at the next boot', async () => {
    await skip(APP)
    await skip(SECOND)
    expect((await listConcealed()).map(i => i.from).sort()).toEqual([`${APP} ${NEWER}`, `${SECOND} ${NEWER}`])

    // The put-away list re-renders: neither address is offered the page again
    // — a re-offer would let a second Skip at the first address through.
    await render()
    const refreshed = vi.fn()
    const off = EffectBus.on('hidden:refresh', refreshed)
    const replayed = refreshed.mock.calls.length   // the bus replays its last value
    EffectBus.emit('publish:entrance-skip', { key: 'jwize', host: APP, page: NEWER })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(refreshed.mock.calls.length).toBe(replayed)
    off()
    expect(await listConcealed()).toHaveLength(2)

    // Next boot: the scout is quiet at both.
    const after: unknown[] = []
    expect(await new EntranceScoutService().check(scoutDeps(after))).toEqual([])
  })

  it('a skip put away before skips were named by their offer still counts', async () => {
    expect(await conceal({ sig: NEWER, scope: ENTRANCE_SKIP_SCOPE, label: APP, from: APP, deletable: true })).toBe(true)
    const after: unknown[] = []
    expect(await new EntranceScoutService().check(scoutDeps(after))).toEqual([expect.objectContaining({ host: SECOND })])
  })
})
