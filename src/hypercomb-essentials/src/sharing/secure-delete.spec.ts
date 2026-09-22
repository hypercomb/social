// sharing/secure-delete.spec.ts
//
// Remove from my hosts: refused while any domain shows the place, refused
// when an open place cannot be walked, and otherwise asks each host to forget
// exactly what only this place's versions reach.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult } from './hive-pointer.js'

const PUBKEY = 'c'.repeat(64)
const [V1, V2, OPEN, SHARED, ONLY1, ONLY2, LEAF] = ['1', '2', '3', '4', '5', '6', '7'].map(c => c.repeat(64))

let indexRead: HiveIndexResult
let walks: Record<string, { sigs: string[]; complete: boolean }>
let posts: { url: string; sigs: string[] }[]

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (): Promise<HiveIndexResult> => indexRead,
  putHiveManifest: async () => ({ ok: true, pubkey: PUBKEY, createdAt: 1 }),
}))
vi.mock('./publish-heads.js', () => ({
  knownRoots: async () => ({}),
  writePublishRecord: async () => void 0,
  listPublishRecords: async () => [
    { sealed: V1, record: { lineageKey: 'place', pubkey: PUBKEY } },
    { sealed: V2, record: { lineageKey: 'place', pubkey: PUBKEY } },
    { sealed: OPEN, record: { lineageKey: 'other', pubkey: PUBKEY } },
  ],
}))
vi.mock('./community-hosts.js', () => ({ hostsOfBranch: async () => [] }))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUBKEY, signEvent: async () => ({}) }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        publicHostDomain: () => 'content.example.com',
        markPublic: async () => void 0,
        closureSigs: async (sig: string) => {
          const w = walks[sig] ?? { sigs: [sig], complete: false }
          return { sigs: new Set(w.sigs), complete: w.complete }
        },
      }
    }
    return undefined
  },
}

const { secureDeleteBranch } = await import('./publish-branch.js')

beforeEach(() => {
  posts = []
  walks = {
    [V1]: { sigs: [V1, SHARED, ONLY1, LEAF], complete: true },
    [V2]: { sigs: [V2, SHARED, ONLY2], complete: true },
    [OPEN]: { sigs: [OPEN, SHARED], complete: true },
  }
  indexRead = { ok: true, manifest: { roots: { other: OPEN }, createdAt: 1, pubkey: PUBKEY } }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const sigs = JSON.parse(String(init?.body ?? '{}')).sigs as string[]
    posts.push({ url: String(url), sigs })
    return new Response(JSON.stringify({ removed: sigs, kept: {} }), { status: 200 })
  }) as typeof fetch
})

describe('secure delete — remove from my hosts', () => {
  it('forgets exactly what only this place reaches, never what an open place uses', async () => {
    const result = await secureDeleteBranch(['place'])
    expect(result.ok).toBe(true)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe('https://content.example.com/forget')
    expect(new Set(posts[0]!.sigs)).toEqual(new Set([V1, V2, ONLY1, ONLY2, LEAF]))
    expect(posts[0]!.sigs).not.toContain(SHARED)
    expect(posts[0]!.sigs).not.toContain(OPEN)
  })

  it('refuses while a domain still shows the place — switch it off first', async () => {
    indexRead = { ok: true, manifest: { roots: { other: OPEN, place: V2 }, createdAt: 1, pubkey: PUBKEY } }
    expect(await secureDeleteBranch(['place'])).toMatchObject({ ok: false, failure: 'still-open' })
    expect(posts).toEqual([])
  })

  it('refuses when an open place cannot be walked completely here', async () => {
    walks[OPEN] = { sigs: [OPEN], complete: false }
    expect(await secureDeleteBranch(['place'])).toMatchObject({ ok: false, failure: 'keep-incomplete', reason: 'other' })
    expect(posts).toEqual([])
  })

  it('refuses when the index cannot be read — it never guesses what is open', async () => {
    indexRead = { ok: false, reason: 'unreachable' }
    expect(await secureDeleteBranch(['place'])).toMatchObject({ ok: false, failure: 'index-unsafe' })
    expect(posts).toEqual([])
  })
})
