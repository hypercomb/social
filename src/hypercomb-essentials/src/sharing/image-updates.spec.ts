// image-updates.spec.ts — a badge appears once, for a picture this participant
// has not been shown, and goes away when answered.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

let offered: string[] = []
vi.mock('./peer-images.js', () => ({
  meaningPoolImageCandidates: async () => offered.map(previewSig => ({ previewSig, props: {}, peers: [] })),
}))

// An in-memory pool: one member per subKey, replaced in place.
const docs = new Map<string, ArrayBuffer>()
const store = {
  getPool: async () => ({} as FileSystemDirectoryHandle),
  getPoolDoc: async (_pool: unknown, subKey?: string) => docs.get(String(subKey)) ?? null,
  putPoolDoc: async (_pool: unknown, bytes: ArrayBuffer, subKey?: string) => { docs.set(String(subKey), bytes); return String(subKey) },
}
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => (key === '@hypercomb.social/Store' ? store : undefined),
  register: () => void 0,
  whenReady: () => void 0,
}

const { unseenNow, markSeen, forgetImageUpdates, unseenPictures, IMAGE_UPDATES_EFFECT } = await import('./image-updates.js')

beforeEach(() => {
  EffectBus.clear()
  docs.clear()
  forgetImageUpdates()
  offered = []
})

describe('new pictures for a name', () => {
  it('the first sight is a baseline — nothing on offer yet is news', async () => {
    offered = ['a', 'b']
    expect([...await unseenNow('howard')]).toEqual([])
    expect(docs.size).toBe(1)
  })

  it('a picture that arrives after the baseline is unseen', async () => {
    offered = ['a', 'b']
    await unseenNow('howard')
    offered = ['a', 'b', 'c']
    expect([...await unseenNow('howard')]).toEqual(['c'])
  })

  it('marking pictures seen answers the badge, and says so on the bus', async () => {
    offered = ['a']
    await unseenNow('howard')
    offered = ['a', 'c']
    await unseenNow('howard')
    const heard: string[] = []
    EffectBus.on<{ label: string }>(IMAGE_UPDATES_EFFECT, p => heard.push(p.label))
    await markSeen('howard', ['c'])
    expect([...unseenPictures('howard')]).toEqual([])
    expect([...await unseenNow('howard')]).toEqual([])
    expect(heard).toContain('howard')
  })

  it('what was seen stays seen after a restart of the cache', async () => {
    offered = ['a']
    await unseenNow('howard')
    offered = ['a', 'c']
    await markSeen('howard', ['c'])
    forgetImageUpdates()
    expect([...await unseenNow('howard')]).toEqual([])
  })

  it('is kept per name: another name has its own record', async () => {
    offered = ['a']
    await unseenNow('howard')
    await unseenNow('susan')
    expect(docs.size).toBe(2)
    offered = ['a', 'z']
    expect([...await unseenNow('howard')]).toEqual(['z'])
    await markSeen('howard', ['z'])
    expect([...await unseenNow('susan')]).toEqual(['z'])
  })

  it('records by the name\'s signature, never the words', async () => {
    offered = ['a']
    await unseenNow('howard')
    expect([...docs.keys()].every(k => /^[0-9a-f]{64}$/.test(k))).toBe(true)
  })
})
