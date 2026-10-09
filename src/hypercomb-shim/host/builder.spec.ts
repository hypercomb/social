// @vitest-environment node
//
// The builder takes an ask only when everything it names is what it says:
// the ask a verifying event for one draft, the draft and every file hashing
// to their names, every path inside the tree. Then it keeps them, so the
// revision it builds carries its provenance.

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = (value: unknown): Buffer => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hc-builder-spec-'))
  vi.stubEnv('HYPERCOMB_POOLS_DIR', resolve(root, 'pools'))
  vi.resetModules()
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

/** A host holding a draft and its ask, flat by signature. */
/** When the specs' asks are taken: a minute after they were signed. */
const NOW = new Date(1_790_000_060_000)

const hosting = ({ kind = 30568, path = 'src/a.ts', h = 'http://h.test', at = 1_790_000_000 } = {}) => {
  const key = generateSecretKey()
  const file = enc('export const a = 2\n')
  const layer = enc({ name: 'draft-files', files: { [path]: sha(file), 'docs/old.md': null } })
  const draft = enc({ name: 'draft', label: 'hypercomb-essentials', base: 'b'.repeat(64), files: sha(layer), at: '2026-10-02T10:00:00.000Z' })
  const ask = enc(finalizeEvent({ kind, created_at: at, content: `hc:ask:v1\n${sha(draft)}`, tags: [['d', sha(draft)], ['h', h]] }, key))
  const served = new Map([[sha(file), file], [sha(layer), layer], [sha(draft), draft], [sha(ask), ask]])
  const get = (async (url: string) => {
    const sig = url.split('/').pop()!
    const bytes = served.get(sig)
    if (!bytes || url.includes('/content/')) return new Response('', { status: 404 })
    return new Response(bytes)
  }) as unknown as typeof fetch
  return { get, ask: sha(ask), draft: sha(draft), layer: sha(layer), file: sha(file), author: getPublicKey(key) }
}

describe('the builder takes an ask', () => {
  it('verifies the ask, the draft and every file, and keeps them for the revision\'s provenance', async () => {
    const { takeAsk } = await import('./builder.mjs')
    const { poolDir } = await import('./builds.mjs')
    const h = hosting()
    const taken = await takeAsk('http://h.test', h.ask, { get: h.get, now: NOW })
    expect(taken.author).toBe(h.author)
    expect(taken.draft).toBe(h.draft)
    expect([...taken.files.keys()].sort()).toEqual(['docs/old.md', 'src/a.ts'])
    expect(taken.files.get('docs/old.md')).toBeNull()
    expect(taken.files.get('src/a.ts')!.toString()).toBe('export const a = 2\n')
    for (const sig of [h.draft, h.layer, h.file]) expect(sha(await readFile(resolve(poolDir('host:builds'), sig)))).toBe(sig)
    expect(sha(await readFile(resolve(poolDir('host:build-signatures'), h.ask)))).toBe(h.ask)
  })

  it('refuses bytes that are not what they are named, an event that is not an ask, and a path out of the tree', async () => {
    const { takeAsk } = await import('./builder.mjs')
    // A file whose bytes are not what the layer names.
    const h = hosting()
    const tamper = (async (url: string) => url.endsWith(h.file) ? new Response('something else') : h.get(url)) as unknown as typeof fetch
    await expect(takeAsk('http://h.test', h.ask, { get: tamper, now: NOW })).rejects.toThrow(/not what it is named/)
    const wrongKind = hosting({ kind: 30567 })
    await expect(takeAsk('http://h.test', wrongKind.ask, { get: wrongKind.get, now: NOW })).rejects.toThrow(/does not verify/)
    const escaping = hosting({ path: '../outside.ts' })
    await expect(takeAsk('http://h.test', escaping.ask, { get: escaping.get, now: NOW })).rejects.toThrow(/not a path inside the tree/)
    await expect(takeAsk('http://h.test', 'nope', { get: h.get, now: NOW })).rejects.toThrow(/named by its signature/)
  })

  it('refuses an ask sent to another host, an old one, and a path into .git, node_modules or out of plain text', async () => {
    const { takeAsk } = await import('./builder.mjs')
    const elsewhere = hosting({ h: 'https://other.example' })
    await expect(takeAsk('http://h.test', elsewhere.ask, { get: elsewhere.get, now: NOW })).rejects.toThrow(/sent to https:\/\/other.example, not http:\/\/h.test/)
    const old = hosting({ at: 1_790_000_000 - 8 * 86_400 })
    await expect(takeAsk('http://h.test', old.ask, { get: old.get, now: NOW })).rejects.toThrow(/older than 7 days/)
    for (const path of ['.git/hooks/post-checkout', 'src/node_modules/x/index.js', 'src\\a.ts', 'C:/a.ts']) {
      const bad = hosting({ path })
      await expect(takeAsk('http://h.test', bad.ask, { get: bad.get, now: NOW })).rejects.toThrow(/\.git or node_modules|not a plain path/)
    }
  })
})

describe('a draft\'s build', () => {
  it('is never handed the builder\'s key or any other secret in the environment', async () => {
    const { buildEnv } = await import('./builder.mjs')
    const env = buildEnv('/work', {
      PATH: '/usr/bin', HOME: '/home/b', HYPERCOMB_POOLS_DIR: '/pools',
      HYPERCOMB_SIGNER_KEY: 'a'.repeat(64), HYPERCOMB_SIGNER_KEY_FILE: '/secret/key', AWS_SECRET_ACCESS_KEY: 'x', GITHUB_TOKEN: 'y',
    })
    expect(env).toEqual({
      PATH: '/usr/bin', HOME: '/home/b', HYPERCOMB_POOLS_DIR: '/pools',
      HYPERCOMB_HOST_OUT_DIR: resolve('/work', 'out'), HYPERCOMB_WEB_CONTENT_DIR: resolve('/work', 'web-content'), HYPERCOMB_RELAY_CONTENT_DIR: resolve('/work', 'relay-content'),
    })
  })
})

describe('a builder lists the asks a host holds for it', () => {
  /** A host that lists its asks only to `builder`'s signed request (NIP-98),
   *  as hypercomb-relay/build-asks.js has a host do. */
  const listing = async (h: ReturnType<typeof hosting>, builder: Uint8Array, names: string[], sentTo = 'http://h.test') => {
    const { verifyEvent } = await import('nostr-tools/pure')
    const pool = sha('host:asks')
    return (async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/${pool}/`)) {
        const header = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
        let event: { kind?: number; pubkey?: string; tags?: string[][] } | null = null
        try { event = JSON.parse(Buffer.from(header.replace(/^Nostr /, ''), 'base64').toString('utf8')) } catch { event = null }
        const signed = !!event && event.kind === 27235 && verifyEvent(event as never) && event.pubkey === getPublicKey(builder)
          && event.tags?.some(t => t[0] === 'u' && t[1] === url) && event.tags?.some(t => t[0] === 'method' && t[1] === 'GET')
        return signed ? new Response(names.map(n => `${n} ${sentTo}\n`).join('')) : new Response('no pool at this address\n', { status: 404 })
      }
      return h.get(url)
    }) as unknown as typeof fetch
  }

  it('reads each listed ask under its key, and says which authors it trusts', async () => {
    const { listAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const asks = await listAsks('http://h.test', { get: await listing(h, builder, [h.ask, 'f'.repeat(64)]), key: builder, now: NOW })
    expect(asks[0]).toEqual({ ask: h.ask, origin: 'http://h.test', author: h.author, draft: h.draft, at: 1_790_000_000, trusted: true, built: false })
    expect(asks[1]).toMatchObject({ ask: 'f'.repeat(64), refused: expect.stringMatching(/does not serve/) })
  })

  it('says how to be named a builder when the host lists nothing to its key', async () => {
    const { listAsks } = await import('./builder.mjs')
    const h = hosting()
    const someoneElse = generateSecretKey()
    await expect(listAsks('http://h.test', { get: await listing(h, generateSecretKey(), [h.ask]), key: someoneElse, now: NOW }))
      .rejects.toThrow(/hosts builders add <your pubkey> @h.test/)
  })
})

describe('an ask sent to another face of the zone', () => {
  it('is read at the origin the listing names, where its h tag holds', async () => {
    const { listAsks } = await import('./builder.mjs')
    const builder = generateSecretKey()
    const h = hosting({ h: 'http://content.h.test' })
    const pool = sha('host:asks')
    const { verifyEvent } = await import('nostr-tools/pure')
    const get = (async (url: string, init?: RequestInit) => {
      if (url === `http://h.test/${pool}/`) {
        const header = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
        const event = JSON.parse(Buffer.from(header.replace(/^Nostr /, ''), 'base64').toString('utf8'))
        return verifyEvent(event) && event.pubkey === getPublicKey(builder) ? new Response(`${h.ask} http://content.h.test\n`) : new Response('', { status: 404 })
      }
      // The ask's bytes are served only where it was sent.
      return url.startsWith('http://content.h.test/') ? h.get(url) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const [ask] = await listAsks('http://h.test', { get, key: builder, now: NOW })
    expect(ask).toMatchObject({ ask: h.ask, origin: 'http://content.h.test', author: h.author })
    expect(ask.refused).toBeUndefined()
  })

  it('a page some face answers is never read as a listing', async () => {
    const { listAsks } = await import('./builder.mjs')
    const html = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    await expect(listAsks('http://h.test', { get: html, key: generateSecretKey(), now: NOW })).rejects.toThrow(/not a listing of asks/)
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    await expect(listAsks('http://h.test', { get: down, key: generateSecretKey(), now: NOW })).rejects.toThrow(/did not answer/)
  })
})

describe('origins compare normalized, as a host compares them', () => {
  it('lowercases, drops a default port and a path, and keeps loopback on http', async () => {
    const { originOf } = await import('./builder.mjs')
    expect(originOf('Content.Example.org')).toBe('https://content.example.org')
    expect(originOf('https://content.example.org:443/x')).toBe('https://content.example.org')
    expect(originOf('localhost:4291')).toBe('http://localhost:4291')
    expect(originOf('try-x.localhost:4291')).toBe('http://try-x.localhost:4291')
  })
})
