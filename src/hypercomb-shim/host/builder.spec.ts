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
