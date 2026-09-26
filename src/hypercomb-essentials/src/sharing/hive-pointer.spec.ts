// hive-pointer.spec.ts — setHiveRoot's safety rules (the extracted
// fetch-verify-merge-PUT step of publishBranch). Collaborators injected;
// no network, no IoC.

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { clearHiveRoot, setHostListing, fetchHiveIndex, ownHiveRoot, putHiveManifest, setHiveRoot, type HiveIndexResult, type PutHiveResult } from './hive-pointer.js'
import { HIVE_LINK_VERSION } from './hive-link.js'

const PUB = 'a'.repeat(64)
const SIG = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const HOST = 'content.example.com'

describe('fetchHiveIndex optional declarations', () => {
  it('returns the optional offerings map and preserves other signed fields', async () => {
    const secret = new Uint8Array(32).fill(7)
    const pubkey = getPublicKey(secret)
    const content = { v: 1, roots: { arkanoid: OTHER },
      offerings: { theme: { location: SIG } }, future: { nested: [1, 2] } }
    const event = finalizeEvent({ kind: 30564, created_at: 1700000000, tags: [],
      content: JSON.stringify(content) }, secret)
    const fetchBefore = globalThis.fetch
    globalThis.fetch = vi.fn(async () => Response.json(event)) as typeof fetch
    try {
      const read = await fetchHiveIndex(HOST, pubkey)
      expect(read.ok).toBe(true)
      if (read.ok) {
        expect(read.manifest.offerings).toEqual(content.offerings)
        expect(read.manifest.signedContent).toEqual(content)
      }
    } finally { globalThis.fetch = fetchBefore }
  })

  it.each([
    null,
    [],
    { v: 1, roots: { arkanoid: OTHER }, offerings: null },
    { v: 1, roots: { arkanoid: OTHER }, offerings: [] },
  ])('rejects malformed signed content %j', async content => {
    const secret = new Uint8Array(32).fill(8)
    const event = finalizeEvent({ kind: 30564, created_at: 1700000000, tags: [],
      content: JSON.stringify(content) }, secret)
    const fetchBefore = globalThis.fetch
    globalThis.fetch = vi.fn(async () => Response.json(event)) as typeof fetch
    try {
      expect(await fetchHiveIndex(HOST, getPublicKey(secret))).toEqual({ ok: false, reason: 'malformed' })
    } finally { globalThis.fetch = fetchBefore }
  })
})

type PutCall = { host: string; roots: Record<string, string>; replaces?: number; previousContent?: Record<string, unknown> }

const harness = (read: HiveIndexResult) => {
  const puts: PutCall[] = []
  const deps = {
    publicKey: async () => PUB,
    fetchIndex: async (): Promise<HiveIndexResult> => read,
    putManifest: async (host: string, roots: Record<string, string>, _doors?: unknown,
      replaces?: number, previousContent?: Record<string, unknown>): Promise<PutHiveResult> => {
      puts.push({ host, roots, ...(replaces ? { replaces } : {}), ...(previousContent ? { previousContent } : {}) })
      return { ok: true, pubkey: PUB, createdAt: 1700000000 }
    },
  }
  return { deps, puts }
}

const verified = (roots: Record<string, string>): HiveIndexResult =>
  ({ ok: true, manifest: { roots, createdAt: 1600000000, pubkey: PUB } })

describe('setHiveRoot', () => {

  it('carries signed offering declarations and unknown fields through a root rewrite', async () => {
    const signedContent = { v: 1, roots: { arkanoid: OTHER }, offerings: { theme: { location: SIG } }, future: { nested: [1, 2] } }
    const { deps, puts } = harness({ ok: true, manifest: {
      roots: { arkanoid: OTHER }, createdAt: 1600000000, pubkey: PUB,
      offerings: signedContent.offerings, signedContent,
    } })
    expect((await setHiveRoot(HOST, 'install:essentials', SIG, deps)).ok).toBe(true)
    expect(puts[0].previousContent).toEqual(signedContent)
  })

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
  it('carries signed offering declarations through a root removal', async () => {
    const signedContent = { v: 1, roots: { 'install:try-fresh': SIG }, offerings: { text: { location: OTHER } } }
    const { deps, puts } = harness({ ok: true, manifest: {
      roots: signedContent.roots, createdAt: 1600000000, pubkey: PUB,
      offerings: signedContent.offerings, signedContent,
    } })
    expect((await clearHiveRoot(HOST, 'install:try-fresh', deps)).ok).toBe(true)
    expect(puts[0].previousContent).toEqual(signedContent)
  })
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

describe('fetchHiveIndex signed content', () => {
  it('reads offerings and keeps the whole signed content, but surfaces no landing picture', async () => {
    const secret = new Uint8Array(32).fill(9)
    const pubkey = getPublicKey(secret)
    const content = { v: 1, roots: { arkanoid: OTHER }, offerings: { theme: { location: SIG } },
      landing: { arkanoid: SIG + '/landing.html' } }
    const event = finalizeEvent({ kind: 30564, created_at: 1700000000, tags: [],
      content: JSON.stringify(content) }, secret)
    const fetchBefore = globalThis.fetch
    globalThis.fetch = vi.fn(async () => Response.json(event)) as typeof fetch
    try {
      const read = await fetchHiveIndex(HOST, pubkey)
      expect(read.ok).toBe(true)
      if (!read.ok) return
      expect(read.manifest.offerings).toEqual(content.offerings)
      expect(read.manifest.signedContent).toEqual(content)
      expect('landing' in read.manifest).toBe(false)
    } finally { globalThis.fetch = fetchBefore }
  })
})

describe('putHiveManifest signed content', () => {
  it('drops a landing picture an older index still carries', async () => {
    const shell = globalThis as unknown as { ioc?: { get: (key: string) => unknown } }
    const original = shell.ioc
    const signEvent = vi.fn(async (event: { kind: number; created_at: number; tags: string[][]; content: string }) =>
      ({ ...event, pubkey: PUB }))
    const fetchBefore = globalThis.fetch
    shell.ioc = { get: key => key === '@diamondcoreprocessor.com/NostrSigner'
      ? { signEvent }
      : original?.get(key) }
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as typeof fetch
    try {
      const previous = { v: 2, roots: { arkanoid: OTHER }, landing: { arkanoid: SIG + '/landing.webp' } }
      const result = await putHiveManifest(HOST, { arkanoid: OTHER }, {}, 1600000000, previous)
      expect(result.ok).toBe(true)
      const signed = signEvent.mock.calls.find(([event]) => event.kind === 30564)?.[0]
      expect(JSON.parse(signed!.content)).toEqual({ v: HIVE_LINK_VERSION, roots: { arkanoid: OTHER } })
    } finally {
      shell.ioc = original
      globalThis.fetch = fetchBefore
    }
  })

  it('signs preserved declarations and unknown fields while replacing only roots and doors', async () => {
    const shell = globalThis as unknown as { ioc?: { get: (key: string) => unknown } }
    const original = shell.ioc
    const signEvent = vi.fn(async (event: { kind: number; created_at: number; tags: string[][]; content: string }) =>
      ({ ...event, pubkey: PUB }))
    const fetchBefore = globalThis.fetch
    shell.ioc = { get: key => key === '@diamondcoreprocessor.com/NostrSigner'
      ? { signEvent }
      : original?.get(key) }
    globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as typeof fetch
    try {
      const previous = {
        v: 2, roots: { arkanoid: OTHER }, doors: { arkanoid: ['old.example.com'] },
        offerings: { theme: { location: SIG } }, future: { nested: [1, 2] },
      }
      const result = await putHiveManifest(HOST, { arkanoid: OTHER, notes: SIG },
        { notes: ['new.example.com'] }, 1600000000, previous)
      expect(result.ok).toBe(true)
      const signed = signEvent.mock.calls.find(([event]) => event.kind === 30564)?.[0]
      expect(signed).toBeDefined()
      expect(JSON.parse(signed!.content)).toEqual({
        v: HIVE_LINK_VERSION, roots: { arkanoid: OTHER, notes: SIG }, doors: { notes: ['new.example.com'] },
        offerings: previous.offerings, future: previous.future,
      })
    } finally {
      shell.ioc = original
      globalThis.fetch = fetchBefore
    }
  })
})

describe('setHostListing — a host lists a pool past the floor only by its operator\'s signed word', () => {
  const withContent = (signedContent: Record<string, unknown>): HiveIndexResult => ({ ok: true, manifest: {
    roots: { arkanoid: OTHER }, createdAt: 1600000000, pubkey: PUB, signedContent,
  } })

  it('adds the meaning and carries every other signed field through', async () => {
    const signedContent = { v: 1, roots: { arkanoid: OTHER }, offerings: { theme: { location: SIG } } }
    const { deps, puts } = harness(withContent(signedContent))
    const result = await setHostListing(HOST, 'hypercomb:windows', true, deps)
    expect(result).toEqual({ ok: true, listed: ['hypercomb:windows'] })
    expect(puts[0].roots).toEqual({ arkanoid: OTHER })
    expect(puts[0].previousContent).toEqual({ ...signedContent, listed: ['hypercomb:windows'] })
  })

  it('withdraws the meaning and drops an empty list entirely', async () => {
    const { deps, puts } = harness(withContent({ v: 1, roots: { arkanoid: OTHER }, listed: ['hypercomb:windows'] }))
    expect((await setHostListing(HOST, 'hypercomb:windows', false, deps)).ok).toBe(true)
    expect(puts[0].previousContent).not.toHaveProperty('listed')
  })

  it('no-ops without re-signing when nothing would change', async () => {
    const { deps, puts } = harness(withContent({ v: 1, roots: {}, listed: ['hypercomb:windows'] }))
    expect(await setHostListing(HOST, 'hypercomb:windows', true, deps)).toEqual({ ok: true, listed: ['hypercomb:windows'], reason: 'unchanged' })
    expect(puts).toHaveLength(0)
  })

  it('refuses a bare word, a derived cache, and an index it cannot see', async () => {
    const { deps, puts } = harness(withContent({ v: 1, roots: {} }))
    expect((await setHostListing(HOST, 'windows', true, deps)).ok).toBe(false)
    expect((await setHostListing(HOST, 'molecule:index', true, deps)).ok).toBe(false)
    expect((await setHostListing(HOST, 'hypercomb:windows', true, harness({ ok: false, reason: 'forged' }).deps)).ok).toBe(false)
    expect(puts).toHaveLength(0)
  })
})
