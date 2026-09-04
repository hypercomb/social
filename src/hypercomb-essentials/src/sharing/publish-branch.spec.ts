// publish-branch.spec.ts — THE INDEX WIPE GUARD.
//
// The hive index is replaceable, not mergeable: every PUT carries the complete
// `lineageKey → head` map, so advancing one branch rewrites all of them. The
// original code read the live index and fell back to `{}` on failure — and the
// fetch helper returned null for EVERY failure, unreachable and forged alike.
// One flaky GET therefore published an index containing only the branch in
// hand, silently unpublishing every other branch the participant had ever
// shared.
//
// These tests pin the rule that replaced it: a rewrite requires either a
// VERIFIED read of the existing index or an explicit 404 (nothing published
// yet). Anything else refuses, and refusing must leave the index untouched.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveIndexResult, PutHiveResult } from './hive-pointer.js'

const HEAD = 'a'.repeat(64)
const OTHER_HEAD = 'b'.repeat(64)
const PUBKEY = 'c'.repeat(64)
const BUNDLE = 'd'.repeat(64)

let indexRead: HiveIndexResult
let putCalls: Record<string, string>[]

/** The host behaves: once something has been PUT, reads return it. This is
 *  what lets the confirmation round trip terminate — and it means the success
 *  tests exercise the real confirm path rather than mocking it away. */
const currentIndex = (): HiveIndexResult => {
  const last = putCalls[putCalls.length - 1]
  return last
    ? { ok: true, manifest: { roots: last, createdAt: 1_700_000_000, pubkey: PUBKEY } }
    : indexRead
}

vi.mock('./hive-pointer.js', () => ({
  fetchHiveIndex: async (): Promise<HiveIndexResult> => currentIndex(),
  fetchHiveManifest: async () => {
    const read = currentIndex()
    return read.ok ? read.manifest : null
  },
  putHiveManifest: async (_host: string, roots: Record<string, string>): Promise<PutHiveResult> => {
    putCalls.push(roots)
    return { ok: true, pubkey: PUBKEY, createdAt: 1_700_000_000 }
  },
}))

// The ledger writes into OPFS; with no Store registered its pool resolves to
// null and every call is an inert no-op, which is exactly what we want here.
;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string): unknown => {
    if (key === '@hypercomb.social/Store') return { putResource: async () => BUNDLE }
    if (key === '@diamondcoreprocessor.com/HistoryService') {
      return { sealSubtree: async () => HEAD }
    }
    if (key === '@diamondcoreprocessor.com/HostSyncService') {
      return {
        isEnabled: () => false,
        isPublicHostEnabled: () => true,
        enablePublicHost: () => void 0,
        markPublic: async () => void 0,
        drain: async () => void 0,
        reDrain: async () => void 0,
        isClosureAvailable: async () => true,
        ensureReceipt: async () => true,
        probeServed: async () => 'served' as const,
      }
    }
    if (key === '@diamondcoreprocessor.com/NostrSigner') {
      return { getPublicKeyHex: async () => PUBKEY }
    }
    return undefined
  },
}

const { publishBranch, unpublishBranch } = await import('./publish-branch.js')
const { lineageKey } = await import('../history/lineage-key.js')

beforeEach(() => {
  putCalls = []
  localStorage.clear()
})

describe('where the bytes go', () => {
  it('stops with no-host when the branch names no node and nothing is standing — and flips no switch', async () => {
    const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
    const original = ioc.get
    let enableCalls = 0
    ioc.get = (key: string): unknown => {
      if (key !== '@diamondcoreprocessor.com/HostSyncService') return original(key)
      return {
        ...(original(key) as object),
        isEnabled: () => false,
        isPublicHostEnabled: () => false,
        enablePublicHost: () => { enableCalls++ },
      }
    }
    try {
      const result = await publishBranch(['site'])
      expect(result).toMatchObject({ ok: false, failure: 'no-host' })
      expect(putCalls).toEqual([])
      expect(enableCalls).toBe(0)
    } finally { ioc.get = original }
  })

  it('names the nodes it publishes to, and never the standing enable', async () => {
    const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
    const original = ioc.get
    const named: string[][] = []
    let enableCalls = 0
    ioc.get = (key: string): unknown => {
      if (key !== '@diamondcoreprocessor.com/HostSyncService') return original(key)
      return {
        ...(original(key) as object),
        enablePublicHost: () => { enableCalls++ },
        addPublishNodes: (domains: readonly string[]) => { named.push([...domains]) },
      }
    }
    try {
      indexRead = { ok: false, reason: 'http', status: 404 }
      const result = await publishBranch(['site'])
      expect(result.ok).toBe(true)
      expect(enableCalls).toBe(0)
      expect(named).toHaveLength(1)
      expect(named[0]!.length).toBeGreaterThan(0)
      if (result.ok) expect(result.host).toBe(named[0]![0])
    } finally { ioc.get = original }
  })
})

describe('publish index wipe guard', () => {

  it('REFUSES to write when no node answers — it stops before sealing, and nothing is PUT', async () => {
    // Every node unreachable is not an index we could not read; it is a
    // publish with nowhere to go. It stops BEFORE sealing or staging (no
    // bytes leave), and says which nodes did not answer.
    indexRead = { ok: false, reason: 'unreachable' }

    const result = await publishBranch(['notes'])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toBe('no-host')
      expect(result.reason).toContain('no node answered')
      expect(result.sealed).toBeUndefined()
    }
    // THE ASSERTION THAT MATTERS: nothing was PUT, so no other branch was
    // dropped from the world.
    expect(putCalls).toHaveLength(0)
  })

  it('REFUSES on a forged index — a substituted index is not an outage', async () => {
    indexRead = { ok: false, reason: 'forged' }
    const result = await publishBranch(['notes'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toBe('index-unsafe')
    expect(putCalls).toHaveLength(0)
  })

  it('REFUSES on a 5xx — only a 404 means "nothing published yet"', async () => {
    indexRead = { ok: false, reason: 'http', status: 503 }
    const result = await publishBranch(['notes'])
    expect(result.ok).toBe(false)
    expect(putCalls).toHaveLength(0)
  })

  it('starts from an empty map ONLY on an explicit 404', async () => {
    indexRead = { ok: false, reason: 'http', status: 404 }

    const result = await publishBranch(['notes'])

    expect(result.ok).toBe(true)
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]).toEqual({ [lineageKey(['notes'])]: HEAD })
  })

  it('carries every other published root through the rewrite', async () => {
    const otherKey = lineageKey(['recipes'])
    indexRead = {
      ok: true,
      manifest: { roots: { [otherKey]: OTHER_HEAD }, createdAt: 1_699_000_000, pubkey: PUBKEY },
    }

    const result = await publishBranch(['notes'])

    expect(result.ok).toBe(true)
    expect(putCalls).toHaveLength(1)
    // The branch being published is added; the one that was already there
    // survives untouched. This is the whole contract of a replaceable pointer.
    expect(putCalls[0]).toEqual({
      [otherKey]: OTHER_HEAD,
      [lineageKey(['notes'])]: HEAD,
    })
  })
})

describe('unpublish', () => {

  it('removes only the named key and keeps the rest', async () => {
    const keep = lineageKey(['recipes'])
    const drop = lineageKey(['notes'])
    indexRead = {
      ok: true,
      manifest: { roots: { [keep]: OTHER_HEAD, [drop]: HEAD }, createdAt: 1_699_000_000, pubkey: PUBKEY },
    }

    const result = await unpublishBranch(['notes'])

    expect(result.ok).toBe(true)
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]).toEqual({ [keep]: OTHER_HEAD })
  })

  it('refuses to rewrite an index it could not verify', async () => {
    indexRead = { ok: false, reason: 'unreachable' }
    const result = await unpublishBranch(['notes'])
    expect(result.ok).toBe(false)
    expect(putCalls).toHaveLength(0)
  })

  it('is a no-op when the branch is not in the index', async () => {
    indexRead = {
      ok: true,
      manifest: { roots: { [lineageKey(['recipes'])]: OTHER_HEAD }, createdAt: 1, pubkey: PUBKEY },
    }
    const result = await unpublishBranch(['notes'])
    expect(result).toEqual({ ok: true, removed: false })
    expect(putCalls).toHaveLength(0)
  })
})
