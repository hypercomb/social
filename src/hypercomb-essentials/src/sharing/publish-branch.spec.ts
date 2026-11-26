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
let preservedCalls: (Record<string, unknown> | undefined)[]

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
  nip98Header: async () => 'Nostr test',
  fetchHiveIndex: async (): Promise<HiveIndexResult> => currentIndex(),
  fetchHiveManifest: async () => {
    const read = currentIndex()
    return read.ok ? read.manifest : null
  },
  putHiveManifest: async (_host: string, roots: Record<string, string>, _doors: unknown,
    _replaces: number, previousContent?: Record<string, unknown>): Promise<PutHiveResult> => {
    putCalls.push(roots)
    preservedCalls.push(previousContent)
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
        // The participant NAMED this host: there is no default (2026-10-11).
        publicHostDomain: () => 'host.example',
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

const { publishBranch, setBranchDoors, unpublishBranch } = await import('./publish-branch.js')
const { lineageKey } = await import('../history/lineage-key.js')

beforeEach(() => {
  putCalls = []
  preservedCalls = []
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

  it('a public host turned on with NO host named is no node — no default host stands in (2026-10-11)', async () => {
    const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
    const original = ioc.get
    const named: string[][] = []
    ioc.get = (key: string): unknown => {
      if (key !== '@diamondcoreprocessor.com/HostSyncService') return original(key)
      return {
        ...(original(key) as object),
        isPublicHostEnabled: () => true,
        publicHostDomain: () => '',
        addPublishNodes: (domains: readonly string[]) => { named.push([...domains]) },
      }
    }
    try {
      indexRead = { ok: false, reason: 'http', status: 404 }
      const result = await publishBranch(['site'])
      expect(result).toMatchObject({ ok: false, failure: 'no-host' })
      expect(putCalls).toEqual([])
      expect(named).toEqual([])
    } finally { ioc.get = original }
  })

  // The address Serve This Hive hands out (a LAN address with a port) takes
  // no uploads. It used to be dropped by the upload queue without a word,
  // and the publish waited out two minutes to say "still uploading".
  it('refuses a host no publish can upload to at once, by name, before reading or writing anything', async () => {
    const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
    const original = ioc.get
    const named: string[][] = []
    ioc.get = (key: string): unknown => {
      if (key !== '@diamondcoreprocessor.com/HostSyncService') return original(key)
      return {
        ...(original(key) as object),
        publicHostDomain: () => '192.168.1.5:4271',
        addPublishNodes: (domains: readonly string[]) => { named.push([...domains]) },
      }
    }
    try {
      indexRead = { ok: false, reason: 'http', status: 404 }
      const result = await publishBranch(['site'])
      expect(result).toMatchObject({ ok: false, failure: 'not-a-node', reason: '192.168.1.5:4271' })
      expect(putCalls).toEqual([])
      expect(named).toEqual([])
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

  it('keeps optional signed offering declarations when a branch is published', async () => {
    const signedContent = {
      v: 1, roots: { recipes: OTHER_HEAD },
      offerings: { theme: { location: 'f'.repeat(64) } },
    }
    indexRead = { ok: true, manifest: {
      roots: signedContent.roots, createdAt: 1_699_000_000, pubkey: PUBKEY,
      offerings: signedContent.offerings, signedContent,
    } }
    expect((await publishBranch(['notes'])).ok).toBe(true)
    expect(preservedCalls).toEqual([signedContent])
  })

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

  it('keeps optional signed offering declarations when a branch is withdrawn', async () => {
    const signedContent = {
      v: 1, roots: { notes: HEAD, recipes: OTHER_HEAD },
      offerings: { theme: { location: 'f'.repeat(64) } },
    }
    indexRead = { ok: true, manifest: {
      roots: signedContent.roots, createdAt: 1_699_000_000, pubkey: PUBKEY,
      offerings: signedContent.offerings, signedContent,
    } }
    expect((await unpublishBranch(['notes'])).ok).toBe(true)
    expect(preservedCalls).toEqual([signedContent])
  })

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

describe('domain doors', () => {
  it('keeps optional signed offering declarations when a door changes', async () => {
    const signedContent = {
      v: 1, roots: { notes: HEAD }, doors: { notes: ['old.example.com'] },
      offerings: { theme: { location: 'f'.repeat(64) } },
    }
    indexRead = { ok: true, manifest: {
      roots: signedContent.roots, doors: signedContent.doors,
      createdAt: 1_699_000_000, pubkey: PUBKEY,
      offerings: signedContent.offerings, signedContent,
    } }
    expect((await setBranchDoors(['notes'], ['new.example.com'])).ok).toBe(true)
    expect(preservedCalls).toEqual([signedContent])
  })
})

// ── THE STAGE LISTS RIDE THE SAME INDEX WRITE ───────────────────────────────
// documentation/deployment-stages.md R3: one signed PUT carries the branch's
// head AND the pointer `stage:<word>` at the author's stage succession — two
// pointers, one signature, never two facts. A refused signature does not fail
// the publish: the pointer is absent and the result says so.
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { SignatureService, mintMetaEnvelope } from '@hypercomb/core'

const SECRET = new Uint8Array(32).fill(9)
const REAL_PUBKEY = getPublicKey(SECRET)
const SIG64 = /^[0-9a-f]{64}$/

const readBlobText = (blob: Blob): Promise<string> =>
  typeof (blob as { text?: unknown }).text === 'function'
    ? blob.text()
    : new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsText(blob) })

/** A store with pools, buckets and content-addressed resources — what a stage
 *  list needs to be written. `putResource` mints real sigs here (the minimal
 *  fake above returns one constant), so the bundle sig is whatever the bytes
 *  hash to; the tests below read the pointers, not the bundle. */
const fullStore = () => {
  const resources = new Map<string, string>()
  const pools = new Map<string, Map<string, Map<string, string>>>()
  const docs = new Map<string, ArrayBuffer>()
  const bucketDir = (files: Map<string, string>, name: string) => ({
    name, kind: 'directory',
    async *entries() { for (const n of files.keys()) yield [n, { kind: 'file', getFile: async () => ({ text: async () => files.get(n) }) }] },
    getFileHandle: async (n: string) => ({ createWritable: async () => ({ write: async (b: Uint8Array) => { files.set(n, new TextDecoder().decode(b)) }, close: async () => {} }) }),
  }) as unknown as FileSystemDirectoryHandle
  const poolDir = (meaning: string) => {
    if (!pools.has(meaning)) pools.set(meaning, new Map())
    const buckets = pools.get(meaning)!
    return {
      name: meaning, kind: 'directory',
      getDirectoryHandle: async (pubkey: string) => { if (!buckets.has(pubkey)) buckets.set(pubkey, new Map()); return bucketDir(buckets.get(pubkey)!, pubkey) },
      async *entries() { for (const [pubkey, files] of buckets) yield [pubkey, bucketDir(files, pubkey)] },
    } as unknown as FileSystemDirectoryHandle
  }
  const store = {
    getPool: async (meaning: string) => poolDir(meaning),
    openPool: async (meaning: string) => (pools.has(meaning) ? poolDir(meaning) : null),
    putPoolDoc: async (_p: unknown, bytes: ArrayBuffer, subKey?: string) => { docs.set(String(subKey), bytes); return 'f'.repeat(64) },
    getPoolDoc: async (_p: unknown, subKey?: string) => docs.get(String(subKey)) ?? null,
    putResource: async (blob: Blob) => {
      const text = await readBlobText(blob)
      const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
      resources.set(sig, text)
      return sig
    },
    // Resolves envelopes like the real Store (a `layer` hop reads as null);
    // the raw bytes are getResourceLocal — the door a list is read through.
    getResource: async (sig: string) => {
      const t = resources.get(sig)
      if (t === undefined) return null
      try {
        const record = JSON.parse(t) as Record<string, unknown>
        if (record['meta'] === 1) {
          if (typeof record['layer'] === 'string') return null
          if (typeof record['resource'] === 'string') return store.getResourceLocal(String(record['resource']))
        }
      } catch { /* raw bytes */ }
      return { text: async () => t } as unknown as Blob
    },
    getResourceLocal: async (sig: string) => { const t = resources.get(sig); return t === undefined ? null : ({ text: async () => t } as unknown as Blob) },
    putArtifactMeta: async (kind: string, sig: string, incidence: Record<string, unknown>) =>
      store.putResource(new Blob([JSON.stringify(mintMetaEnvelope({ [kind]: sig, ...incidence }))])),
    resources,
  }
  return store
}

describe('the stage lists ride the same index write', () => {
  const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
  const original = ioc.get
  const realSigner = {
    getPublicKeyHex: async () => REAL_PUBKEY,
    signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, SECRET),
  }
  // Nothing published yet: the only sanctioned empty baseline.
  beforeEach(() => { indexRead = { ok: false, reason: 'http', status: 404 } })
  const withFullStore = async (run: () => Promise<void>): Promise<void> => {
    const store = fullStore()
    const { resetReaderPubkey } = await import('./head-claim-signer.js')
    const { _resetMintedFacetClaims } = await import('../molecule/facet-succession.js')
    _resetMintedFacetClaims()
    ioc.get = (key: string): unknown => {
      if (key === '@hypercomb.social/Store') return store
      if (key === '@diamondcoreprocessor.com/NostrSigner') return realSigner
      return original(key)
    }
    // No priming: the publish paths carry the key they sign with, and the
    // stage writer must never depend on a cache another gesture filled.
    resetReaderPubkey()
    try { await run() } finally { ioc.get = original; resetReaderPubkey() }
  }

  it('publishing carries `stage:published` beside the branch head, in ONE write', async () => {
    await withFullStore(async () => {
      const result = await publishBranch(['site'])
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.stages).toEqual({ published: 'listed' })
      const write = putCalls[putCalls.length - 1]!
      expect(write[lineageKey(['site'])]).toBe(HEAD)
      expect(write['stage:published']).toMatch(SIG64)
      expect(putCalls).toHaveLength(1)
    })
  })

  it('a join names `shared` too, and a second publish of the same head changes no list', async () => {
    await withFullStore(async () => {
      const first = await publishBranch(['site'], { stages: ['shared'] })
      expect(first.ok && first.stages).toEqual({ published: 'listed', shared: 'listed' })
      const write = putCalls[putCalls.length - 1]!
      expect(write['stage:shared']).toMatch(SIG64)
      expect(write['stage:published']).toMatch(SIG64)
      expect(write['stage:shared']).not.toBe(write['stage:published'])
      const again = await publishBranch(['site'], { stages: ['shared'] })
      expect(again.ok && again.stages).toEqual({ published: 'unchanged', shared: 'unchanged' })
      expect(putCalls[putCalls.length - 1]!['stage:shared']).toBe(write['stage:shared'])
    })
  })

  it('a store that cannot mint a list refuses the pointer and the publish still stands', async () => {
    const result = await publishBranch(['site'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.stages).toEqual({ published: 'refused' })
    expect(Object.keys(putCalls[putCalls.length - 1]!).some(k => k.startsWith('stage:'))).toBe(false)
  })

  it('unpublishing withdraws the head from the lists — a new pointer in the same write, nothing deleted', async () => {
    await withFullStore(async () => {
      await publishBranch(['site'], { stages: ['shared'] })
      const before = putCalls[putCalls.length - 1]!
      const out = await unpublishBranch(['site'])
      expect(out).toEqual({ ok: true, removed: true })
      const after = putCalls[putCalls.length - 1]!
      expect(after[lineageKey(['site'])]).toBeUndefined()
      expect(after['stage:published']).toMatch(SIG64)
      expect(after['stage:published']).not.toBe(before['stage:published'])
      expect(after['stage:shared']).not.toBe(before['stage:shared'])
      // The pointer names the signed claim; the claim names the list; the
      // prior list is one prev back, byte for byte.
      const store = ioc.get('@hypercomb.social/Store') as ReturnType<typeof fullStore>
      const headOf = (claimSig: string): string => String(JSON.parse(store.resources.get(claimSig)!).content).split('\n')[3]!
      const atom = JSON.parse(store.resources.get(headOf(after['stage:published']!))!)
      expect(atom.prev).toBe(headOf(before['stage:published']!))
      expect(atom.members).toEqual([])
    })
  })
})

// REACH A6: the picture entry a Publish writes was read from this hive only,
// so a head whose properties never landed here published no picture — and
// said nothing. The walk now asks the hosts by signature, hash-checked, and a
// branch it still cannot read is named in the receipt.
describe('the pictures a publish offers', () => {
  const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
  const original = ioc.get
  beforeEach(() => { indexRead = { ok: false, reason: 'http', status: 404 } })
  const bytesOf = (doc: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(doc))
  const sigOf = async (bytes: Uint8Array): Promise<string> =>
    SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

  /** HEAD is held here; its properties sit only on a host. */
  const withPictureStore = async (hostServes: (sig: string, bytes: Uint8Array) => Uint8Array | null, run: (propsSig: string) => Promise<void>): Promise<void> => {
    const props = bytesOf({ small: { image: 'e'.repeat(64) } })
    const propsSig = await sigOf(props)
    const head = bytesOf({ name: 'hyperdex', properties: [propsSig] })
    const fetched: string[] = []
    ioc.get = (key: string): unknown => {
      if (key === '@hypercomb.social/Store') return {
        putResource: async () => BUNDLE,
        getResourceLocal: async (sig: string) => sig === HEAD ? ({ text: async () => new TextDecoder().decode(head) } as unknown as Blob) : null,
        fetchLayerFromHost: async (sig: string) => { fetched.push(sig); return sig === propsSig ? hostServes(sig, props) : null },
      }
      return original(key)
    }
    try { await run(propsSig) } finally { ioc.get = original }
    expect(fetched).toContain(propsSig)
  }

  it('fetches properties that are not here by signature, and offers the picture under its name', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    await withPictureStore((_sig, bytes) => bytes, async () => {
      const result = await publishBranch(['knowledge', 'hyperdex'])
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(putCalls[putCalls.length - 1]![(await picturesKey('hyperdex'))!]).toBe(HEAD)
      expect(result.pictureGap).toBeUndefined()
    })
  })

  it('names the branch in the receipt when its properties cannot be read anywhere', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    await withPictureStore(() => null, async propsSig => {
      const result = await publishBranch(['knowledge', 'hyperdex'])
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(putCalls[putCalls.length - 1]![(await picturesKey('hyperdex'))!]).toBeUndefined()
      expect(result.pictureGap).toEqual({ branch: 'knowledge/hyperdex', unread: [propsSig] })
    })
  })

  it('takes no fetched byte that fails its signature', async () => {
    await withPictureStore(() => bytesOf({ small: { image: 'f'.repeat(64) } }), async propsSig => {
      const result = await publishBranch(['knowledge', 'hyperdex'])
      expect(result.ok && result.pictureGap).toEqual({ branch: 'knowledge/hyperdex', unread: [propsSig] })
    })
  })
})

// REVIEW 2026-11-25: the walk fetches what is not here, and it waits on the
// act, so it is bounded — a count and one deadline — and what the budget
// leaves is named in `unread` like any other miss.
describe('the picture walk is bounded on the act', () => {
  const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
  const original = ioc.get
  const childSig = (i: number): string => i.toString(16).padStart(64, '0')
  const withMissingChildren = async (fetch: (sig: string) => Promise<Uint8Array | null>, run: (fetched: string[]) => Promise<void>): Promise<void> => {
    const head = JSON.stringify({ name: 'hyperdex', children: Array.from({ length: 40 }, (_, i) => childSig(i + 1)) })
    const fetched: string[] = []
    ioc.get = (key: string): unknown => {
      if (key === '@hypercomb.social/Store') return {
        putResource: async () => BUNDLE,
        getResourceLocal: async (sig: string) => sig === HEAD ? ({ text: async () => head } as unknown as Blob) : null,
        fetchLayerFromHost: async (sig: string) => { fetched.push(sig); return fetch(sig) },
      }
      return original(key)
    }
    try { await run(fetched) } finally { ioc.get = original }
  }

  it('asks the hosts for at most its count, and names every layer it left', async () => {
    const { branchPictureRoots, PICTURE_FETCH_BUDGET } = await import('./publish-branch.js')
    await withMissingChildren(async () => null, async fetched => {
      const out = await branchPictureRoots(HEAD)
      expect(fetched.length).toBeLessThanOrEqual(PICTURE_FETCH_BUDGET.fetches)
      expect(out.unread).toHaveLength(40)
    })
  })

  it('stops waiting at its deadline when a host never answers', async () => {
    const { branchPictureRoots } = await import('./publish-branch.js')
    await withMissingChildren(() => new Promise<null>(() => void 0), async fetched => {
      const started = Date.now()
      const out = await branchPictureRoots(HEAD, { fetches: 12, ms: 60 })
      expect(Date.now() - started).toBeLessThan(2_000)
      expect(fetched.length).toBeGreaterThan(0)
      expect(out.unread).toHaveLength(40)
    })
  }, 5_000)
})

// REVIEW 2026-11-25: the walk now reaches every descendant, and descendant
// names repeat across branches. A name another publish already offers stays
// its own; only THIS branch's previous offer is replaced.
describe('a picture entry another publish made stays', () => {
  const ioc = (window as unknown as { ioc: { get: (k: string) => unknown } }).ioc
  const original = ioc.get
  const CHILD_LAYER = '1'.repeat(64)
  const ENVELOPE = '2'.repeat(64)
  const PROPS = '3'.repeat(64)
  const HOSTING_LAYER = '4'.repeat(64)
  const docs = new Map<string, string>([
    [HEAD, JSON.stringify({ name: 'hyperdex', children: [ENVELOPE] })],
    [ENVELOPE, JSON.stringify({ meta: 1, layer: CHILD_LAYER, relation: 'children' })],
    [CHILD_LAYER, JSON.stringify({ name: 'hosting', properties: [PROPS] })],
    [PROPS, JSON.stringify({ small: { image: 'e'.repeat(64) } })],
  ])
  const withBranch = async (run: () => Promise<void>): Promise<void> => {
    ioc.get = (key: string): unknown => {
      if (key === '@hypercomb.social/Store') return {
        putResource: async () => BUNDLE,
        getResourceLocal: async (sig: string) => { const t = docs.get(sig); return t === undefined ? null : ({ text: async () => t } as unknown as Blob) },
      }
      return original(key)
    }
    try { await run() } finally { ioc.get = original }
  }

  it('a descendant named like another branch\'s pictured root does not take its entry', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    const hosting = (await picturesKey('hosting'))!
    indexRead = { ok: true, manifest: {
      roots: { [lineageKey(['hosting'])]: HOSTING_LAYER, [hosting]: HOSTING_LAYER }, createdAt: 1_699_000_000, pubkey: PUBKEY,
    } }
    await withBranch(async () => {
      expect((await publishBranch(['knowledge', 'hyperdex'])).ok).toBe(true)
      expect(putCalls[putCalls.length - 1]![hosting]).toBe(HOSTING_LAYER)
    })
  })

  it('a name this branch offered before is offered again for its new layer', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    const hosting = (await picturesKey('hosting'))!
    const OLD_HEAD = '5'.repeat(64)
    const OLD_CHILD = '6'.repeat(64)
    docs.set(OLD_HEAD, JSON.stringify({ name: 'hyperdex', children: [OLD_CHILD] }))
    docs.set(OLD_CHILD, JSON.stringify({ name: 'hosting', properties: [PROPS] }))
    indexRead = { ok: true, manifest: {
      roots: { [lineageKey(['knowledge', 'hyperdex'])]: OLD_HEAD, [hosting]: OLD_CHILD }, createdAt: 1_699_000_000, pubkey: PUBKEY,
    } }
    await withBranch(async () => {
      expect((await publishBranch(['knowledge', 'hyperdex'])).ok).toBe(true)
      expect(putCalls[putCalls.length - 1]![hosting]).toBe(CHILD_LAYER)
    })
  })

  it('an entry the previous head walk could not reach is replaced, never kept stale for good', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    const hosting = (await picturesKey('hosting'))!
    // The previous head is here; the descendant that held this branch's own
    // `hosting` is neither here nor fetchable, so the walk of it is cut short.
    const OLD_HEAD = '7'.repeat(64)
    const OLD_ENVELOPE = '8'.repeat(64)
    const OLD_CHILD = '9'.repeat(64)
    docs.set(OLD_HEAD, JSON.stringify({ name: 'hyperdex', children: [OLD_ENVELOPE] }))
    indexRead = { ok: true, manifest: {
      roots: { [lineageKey(['knowledge', 'hyperdex'])]: OLD_HEAD, [hosting]: OLD_CHILD }, createdAt: 1_699_000_000, pubkey: PUBKEY,
    } }
    await withBranch(async () => {
      expect((await publishBranch(['knowledge', 'hyperdex'])).ok).toBe(true)
      expect(putCalls[putCalls.length - 1]![hosting]).toBe(CHILD_LAYER)
    })
  })

  it('a walk cut short never takes an entry another branch holds', async () => {
    const { picturesKey } = await import('./picture-pools.js')
    const hosting = (await picturesKey('hosting'))!
    // The previous head's walk leaves a document unread (undecided), yet the
    // entry is the /hosting branch's own head: the index proves it another's.
    const OLD_HEAD = '0a'.repeat(32)
    const OLD_ENVELOPE = '0b'.repeat(32)
    docs.set(OLD_HEAD, JSON.stringify({ name: 'hyperdex', children: [OLD_ENVELOPE] }))
    indexRead = { ok: true, manifest: {
      roots: { [lineageKey(['knowledge', 'hyperdex'])]: OLD_HEAD, [lineageKey(['hosting'])]: HOSTING_LAYER, [hosting]: HOSTING_LAYER },
      createdAt: 1_699_000_000, pubkey: PUBKEY,
    } }
    await withBranch(async () => {
      expect((await publishBranch(['knowledge', 'hyperdex'])).ok).toBe(true)
      expect(putCalls[putCalls.length - 1]![hosting]).toBe(HOSTING_LAYER)
    })
  })
})
