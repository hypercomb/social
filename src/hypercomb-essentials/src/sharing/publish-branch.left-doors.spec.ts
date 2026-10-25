// publish-branch.left-doors.spec.ts — A TURN-OFF REACHES THE DOMAIN IT TURNS OFF.
//
// Turning a domain off takes it off the branch's host marks first, so the
// rewrite goes through the hosts of the domains still on. Where every domain
// shares one index (one worker) that is the same index; a domain served by a
// host of its own kept the old one and went on opening the branch there. Each
// domain a turn-off leaves now gets the same edit through its own host — read
// and verified first, written only when its index does not already say it.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, HiveManifest, PutHiveResult } from './hive-pointer.js'

const HEAD = 'a'.repeat(64)
const KEEP = 'b'.repeat(64)
const PUBKEY = 'c'.repeat(64)

type Stored = { roots: Record<string, string>; doors: Record<string, string[]> }
/** host → the index that host holds; two hosts may hold the same object. */
let hosts: Record<string, Stored | 'down' | 'forged'>
let writes: string[]

const manifestOf = (s: Stored): HiveManifest => ({ roots: { ...s.roots }, doors: structuredClone(s.doors), createdAt: 1_700_000_000, pubkey: PUBKEY })

vi.mock('./hive-pointer.js', () => ({
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (host: string): Promise<HiveIndexResult> => {
    const held = hosts[host]
    if (held === undefined) return { ok: false, reason: 'http', status: 404 }
    if (held === 'down') return { ok: false, reason: 'unreachable' }
    if (held === 'forged') return { ok: false, reason: 'forged' }
    return { ok: true, manifest: manifestOf(held) }
  },
  fetchHiveManifest: async () => null,
  fetchHiveManifestFromAny: async () => null,
  putHiveManifest: async (host: string, roots: Record<string, string>, doors: Record<string, string[]>): Promise<PutHiveResult> => {
    writes.push(host)
    const held = hosts[host]
    if (held && typeof held === 'object') { held.roots = { ...roots }; held.doors = structuredClone(doors) }
    else hosts[host] = { roots: { ...roots }, doors: structuredClone(doors) }
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_001 }
  },
}))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        // The domains still on are served through this host.
        publicHostDomain: () => 'host.example',
        markPublic: async () => void 0,
        addPublishNodes: () => void 0,
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') return { getPublicKeyHex: async () => PUBKEY }
    return undefined
  },
}

const { setBranchDoors, unpublishBranch } = await import('./publish-branch.js')
const { lineageKey } = await import('../history/lineage-key.js')
const KEY = lineageKey(['site'])

const published = (doors: string[]): Stored => ({ roots: { [KEY]: HEAD, other: KEEP }, doors: { [KEY]: doors, other: ['host.example'] } })

beforeEach(() => {
  writes = []
  localStorage.clear()
})

describe('a domain switched off on a host of its own', () => {
  it('gets the new doors through its own host as well', async () => {
    hosts = { 'host.example': published(['host.example', 'own.example']), 'own.example': published(['host.example', 'own.example']) }
    const result = await setBranchDoors(['site'], ['host.example'], ['own.example'])
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual(['host.example', 'own.example'])
    expect((hosts['own.example'] as Stored).doors[KEY]).toEqual(['host.example'])
    // Only this branch's doors change there; everything else it holds stays.
    expect((hosts['own.example'] as Stored).roots).toEqual({ [KEY]: HEAD, other: KEEP })
    expect((hosts['own.example'] as Stored).doors['other']).toEqual(['host.example'])
  })

  it('writes once where every domain shares one index — the second read already says it', async () => {
    const shared = published(['host.example', 'own.example'])
    hosts = { 'host.example': shared, 'own.example': shared }
    const result = await setBranchDoors(['site'], ['host.example'], ['own.example'])
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual(['host.example'])
  })

  it('the last domain off withdraws it through that domain’s host too', async () => {
    hosts = { 'host.example': published(['own.example']), 'own.example': published(['own.example']) }
    const result = await unpublishBranch(['site'], ['own.example'])
    expect(result).toMatchObject({ ok: true, removed: true })
    const own = hosts['own.example'] as Stored
    expect(KEY in own.roots).toBe(false)
    expect(KEY in own.doors).toBe(false)
    expect(own.roots['other']).toBe(KEEP)
  })

  it('withdraws it there even when the hosts still on never held it', async () => {
    hosts = { 'host.example': { roots: { other: KEEP }, doors: { other: ['host.example'] } }, 'own.example': published(['own.example']) }
    const result = await unpublishBranch(['site'], ['own.example'])
    expect(result).toMatchObject({ ok: true, removed: false })
    expect(KEY in (hosts['own.example'] as Stored).roots).toBe(false)
  })

  it('names a domain whose host did not answer, and writes nothing there', async () => {
    hosts = { 'host.example': published(['host.example', 'own.example']), 'own.example': 'down' }
    const result = await setBranchDoors(['site'], ['host.example'], ['own.example'])
    expect(result).toEqual({ ok: true, unreached: ['own.example'] })
    expect(writes).toEqual(['host.example'])
  })

  it('never rewrites an index it could not verify (the wipe guard holds there too)', async () => {
    hosts = { 'host.example': published(['host.example', 'own.example']), 'own.example': 'forged' }
    const result = await setBranchDoors(['site'], ['host.example'], ['own.example'])
    expect(result).toEqual({ ok: true, unreached: ['own.example'] })
    expect(writes).toEqual(['host.example'])
  })

  it('a host holding no index for this key is left alone and not reported', async () => {
    hosts = { 'host.example': published(['host.example', 'own.example']) }
    const result = await setBranchDoors(['site'], ['host.example'], ['own.example'])
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual(['host.example'])
    expect(hosts['own.example']).toBeUndefined()
  })

  it('turning a domain on names nothing left, so nothing more is asked', async () => {
    hosts = { 'host.example': published(['host.example']), 'own.example': published(['host.example']) }
    const result = await setBranchDoors(['site'], ['host.example', 'own.example'])
    expect(result).toEqual({ ok: true })
    expect(writes).toEqual(['host.example'])
  })
})
