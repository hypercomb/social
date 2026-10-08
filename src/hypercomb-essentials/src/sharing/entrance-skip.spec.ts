// sharing/entrance-skip.spec.ts — SKIP IS WRITTEN. The Publish panel's Skip
// puts the offered page away in the concealment pool itself (the concealment
// bee may be asleep, and `hidden:conceal` does not wake it), asks that bee to
// refresh, and the scout's next look stays quiet about the page. End to end:
// the real drone, the real concealment module, the real scout, and an
// in-memory pool directory.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import type { HiveManifest } from './hive-pointer.js'

const ZONE = 'jwize.com'
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
const { ENTRANCE_SKIP_SCOPE, ENTRANCE_UPDATE_EFFECT, EntranceScoutService } = await import('./entrance-scout.service.js')
const { listConcealed } = await import('../concealment/concealment.js')

const manifests: Record<string, HiveManifest> = {
  [OWN]: {
    roots: {}, createdAt: 1, pubkey: OWN,
    entrances: { [ZONE]: { page: RUNS, powers: ['keep', 'camera', 'read'], from: { pubkey: PUB, lineage: 'card', at: 1 } } },
  },
  [PUB]: { roots: { card: HEAD }, createdAt: 2, pubkey: PUB },
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
    expect(before).toHaveLength(1)

    const refreshed = vi.fn()
    const off = EffectBus.on('hidden:refresh', refreshed)
    EffectBus.emit(ENTRANCE_UPDATE_EFFECT, { zone: ZONE, current: RUNS, offered: NEWER, at: 2 })
    EffectBus.emit('publish:entrance-skip', { key: 'jwize', zone: ZONE, page: NEWER })

    await vi.waitFor(async () => {
      const held = await listConcealed()
      expect(held.map(i => ({ sig: i.sig, scope: i.scope, from: i.from, state: i.state })))
        .toEqual([{ sig: NEWER, scope: ENTRANCE_SKIP_SCOPE, from: ZONE, state: 'hidden' }])
    })
    expect(refreshed).toHaveBeenCalled()
    off()

    // The scout reads the pool for itself (no skip list handed in).
    const after: unknown[] = []
    expect(await new EntranceScoutService().check(scoutDeps(after))).toEqual([])
    expect(after).toEqual([])
  })
})
