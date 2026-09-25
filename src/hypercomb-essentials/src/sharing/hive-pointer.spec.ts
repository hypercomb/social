// hive-pointer.spec.ts — setHiveRoot's safety rules (the extracted
// fetch-verify-merge-PUT step of publishBranch). Collaborators injected;
// no network, no IoC. The "landing wire format" block at the end is the
// exception: it exercises fetchHiveIndex/putHiveManifest for real, with a
// real signature (nostr-tools/pure), the way head-claim-signer.spec.ts does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { HIVE_INDEX_EVENT_KIND } from './hive-link.js'
import { clearHiveRoot, fetchHiveIndex, ownHiveRoot, putHiveManifest, setHiveRoot, type HiveIndexResult, type PutHiveResult } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const SIG = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const HOST = 'content.example.com'

type PutCall = { host: string; roots: Record<string, string>; replaces?: number }

const harness = (read: HiveIndexResult) => {
  const puts: PutCall[] = []
  const deps = {
    publicKey: async () => PUB,
    fetchIndex: async (): Promise<HiveIndexResult> => read,
    putManifest: async (host: string, roots: Record<string, string>, _doors?: unknown, replaces?: number): Promise<PutHiveResult> => {
      puts.push({ host, roots, ...(replaces ? { replaces } : {}) })
      return { ok: true, pubkey: PUB, createdAt: 1700000000 }
    },
  }
  return { deps, puts }
}

const verified = (roots: Record<string, string>): HiveIndexResult =>
  ({ ok: true, manifest: { roots, createdAt: 1600000000, pubkey: PUB } })

describe('setHiveRoot', () => {

  it('merges exactly one key into the verified roots — others untouched', async () => {
    const { deps, puts } = harness(verified({ arkanoid: OTHER }))
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(puts).toHaveLength(1)
    expect(puts[0].roots).toEqual({ arkanoid: OTHER, 'install:essentials': SIG })
  })

  it('treats a 404 as the sanctioned empty baseline', async () => {
    const { deps, puts } = harness({ ok: false, reason: 'http', status: 404 })
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(puts[0].roots).toEqual({ 'install:essentials': SIG })
  })

  it('REFUSES to write over an index it cannot see — unreachable, malformed, forged', async () => {
    for (const reason of ['unreachable', 'malformed', 'forged'] as const) {
      const { deps, puts } = harness({ ok: false, reason })
      const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
      expect(result.ok).toBe(false)
      expect(result.reason).toBe(`index-unsafe: ${reason}`)
      expect(puts).toHaveLength(0)
    }
  })

  it('no-ops without re-signing when the root already holds the sig', async () => {
    const { deps, puts } = harness(verified({ 'install:essentials': SIG }))
    const result = await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('unchanged')
    expect(puts).toHaveLength(0)
  })

  it('refuses a malformed sig and a missing signer before touching the network', async () => {
    const { deps } = harness(verified({}))
    expect((await setHiveRoot(HOST, 'install:essentials', 'nope', deps)).reason).toBe('sig is not a 64-hex signature')
    expect((await setHiveRoot(HOST, 'install:essentials', SIG, { ...deps, publicKey: async () => null })).reason).toBe('no signer')
  })
})

describe('clearHiveRoot — a sandbox withdrawn is unreachable, never deleted', () => {
  it('takes exactly one key out of the verified roots, and leaves the rest', async () => {
    const { deps, puts } = harness(verified({ 'install:try-fresh': SIG, 'install:essentials': OTHER, arkanoid: OTHER }))
    const result = await clearHiveRoot(HOST, 'install:try-fresh', deps)
    expect(result).toMatchObject({ ok: true, sig: SIG })
    expect(puts).toEqual([{ host: HOST, roots: { 'install:essentials': OTHER, arkanoid: OTHER }, replaces: 1600000000 }])
  })
  it('no-ops on an absent key, and refuses an index it cannot trust', async () => {
    const absent = harness(verified({ arkanoid: OTHER }))
    expect((await clearHiveRoot(HOST, 'install:try-fresh', absent.deps)).reason).toBe('unchanged')
    expect(absent.puts).toEqual([])
    const forged = harness({ ok: false, reason: 'forged' } as HiveIndexResult)
    expect((await clearHiveRoot(HOST, 'install:try-fresh', forged.deps)).ok).toBe(false)
    expect(forged.puts).toEqual([])
  })
  it('ownHiveRoot reads one verified root, or null', async () => {
    const { deps } = harness(verified({ 'install:try-fresh': SIG }))
    expect(await ownHiveRoot(HOST, 'install:try-fresh', deps)).toBe(SIG)
    expect(await ownHiveRoot(HOST, 'install:try-other', deps)).toBeNull()
  })
})

describe('two writes in one second', () => {
  it('every write names the index it replaces, so the next one is stamped newer', async () => {
    const { deps, puts } = harness(verified({ 'install:try-fresh': SIG }))
    await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    await clearHiveRoot(HOST, 'install:try-fresh', deps)
    expect(puts.map(put => put.replaces)).toEqual([1600000000, 1600000000])
  })
})

describe('setHiveRoot / clearHiveRoot carry landing through untouched', () => {
  const LANDING = `${SIG}/landing.webp`

  it('setHiveRoot never touches another branch\'s landing', async () => {
    const puts: Array<{ landing?: Record<string, string> }> = []
    const deps = {
      publicKey: async () => PUB,
      fetchIndex: async (): Promise<HiveIndexResult> =>
        ({ ok: true, manifest: { roots: { arkanoid: OTHER }, createdAt: 1600000000, pubkey: PUB, landing: { arkanoid: LANDING } } }),
      putManifest: async (host: string, roots: Record<string, string>, _doors?: unknown,
        _replaces?: number, _landing?: Record<string, string>, previousLanding?: Record<string, string>): Promise<PutHiveResult> => {
        puts.push({ landing: previousLanding })
        return { ok: true, pubkey: PUB, createdAt: 1700000000 }
      },
    }
    await setHiveRoot(HOST, 'install:essentials', SIG, deps)
    expect(puts).toEqual([{ landing: { arkanoid: LANDING } }])
  })

  it('clearHiveRoot carries the remaining branches\' landing through a withdrawal', async () => {
    const puts: Array<{ landing?: Record<string, string> }> = []
    const deps = {
      publicKey: async () => PUB,
      fetchIndex: async (): Promise<HiveIndexResult> => ({
        ok: true,
        manifest: { roots: { 'install:try-fresh': SIG, arkanoid: OTHER }, createdAt: 1600000000, pubkey: PUB, landing: { arkanoid: LANDING } },
      }),
      putManifest: async (host: string, roots: Record<string, string>, _doors?: unknown,
        _replaces?: number, _landing?: Record<string, string>, previousLanding?: Record<string, string>): Promise<PutHiveResult> => {
        puts.push({ landing: previousLanding })
        return { ok: true, pubkey: PUB, createdAt: 1700000000 }
      },
    }
    await clearHiveRoot(HOST, 'install:try-fresh', deps)
    expect(puts).toEqual([{ landing: { arkanoid: LANDING } }])
  })
})

describe('the landing on the wire', () => {
  const secretHex = '33'.repeat(32)
  const hexToBytes = (hex: string): Uint8Array => {
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  const secret = hexToBytes(secretHex)
  const pubkey = getPublicKey(secret).toLowerCase()

  /** A genuinely-signed event, so verifyEvent has something real to check —
   *  the point of these tests is what fetchHiveIndex does with the CONTENT
   *  of a valid signature, not whether it can be fooled by an invalid one
   *  (that is head-claim-signer's territory). */
  const sign = (content: Record<string, unknown>): Record<string, unknown> =>
    finalizeEvent({ kind: HIVE_INDEX_EVENT_KIND, created_at: 1700000000, tags: [], content: JSON.stringify(content) }, secret) as unknown as Record<string, unknown>

  let served: Record<string, unknown> | null = null
  const shell = globalThis as unknown as { ioc?: { get: (key: string) => unknown } }
  let originalIoc: typeof shell.ioc

  beforeEach(() => {
    served = null
    originalIoc = shell.ioc
    shell.ioc = {
      get: (key: string) => key === '@diamondcoreprocessor.com/NostrSigner'
        ? {
            signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) =>
              finalizeEvent(event as never, secret) as unknown as Record<string, unknown>,
            getPublicKeyHex: async () => pubkey,
          }
        : originalIoc?.get(key),
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'PUT') { served = JSON.parse(String(init.body)); return new Response('', { status: 200 }) }
      return served ? new Response(JSON.stringify(served)) : new Response('not found', { status: 404 })
    })
  })
  afterEach(() => {
    shell.ioc = originalIoc
    vi.restoreAllMocks()
  })

  it('a signed landing round-trips through fetchHiveIndex exactly as written', async () => {
    const landing = { arkanoid: `${SIG}/landing.webp` }
    const put = await putHiveManifest(HOST, { arkanoid: OTHER }, {}, 0, landing)
    expect(put.ok).toBe(true)

    const read = await fetchHiveIndex(HOST, pubkey)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.manifest.landing).toEqual(landing)
  })

  it('drops a landing entry for a branch the roots do not name, or a malformed address, without failing the read', async () => {
    // A genuinely-signed event whose content carries entries putHiveManifest
    // itself would never sign (its own signedLanding() already filters these
    // out) — standing in for an older or foreign publisher's index. The
    // signature is real; readLanding's OWN validation is what must prune it.
    served = sign({
      v: 1, roots: { arkanoid: OTHER },
      landing: { arkanoid: `${SIG}/landing.webp`, ghost: OTHER, notes: 'nope' },
    })

    const read = await fetchHiveIndex(HOST, pubkey)
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.manifest.landing).toEqual({ arkanoid: `${SIG}/landing.webp` })
  })

  it('a write that carries no landing at all keeps the index byte-identical to before doors/landing existed', async () => {
    await putHiveManifest(HOST, { arkanoid: OTHER }, {}, 0, {})
    expect(served).not.toBeNull()
    expect(JSON.parse(String(served!['content']))).not.toHaveProperty('landing')
  })
})
