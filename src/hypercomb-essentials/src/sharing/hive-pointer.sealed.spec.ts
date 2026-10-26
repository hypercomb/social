// hive-pointer.sealed.spec.ts — the index names a branch's private versions (`sealed`) and EVERY writer carries it.
// A writer that dropped the field would withdraw every private version at once, so each way the index is rewritten is
// held here. Real keys; the host is a small stateful fake that keeps whatever index was last PUT.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => {
  const held = new Map<string, unknown>()
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { held.set(key, value) },
    get: (key: string) => held.get(key),
    whenReady: () => {},
  }
  return held
})

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { registerPoolMeaning } from '@hypercomb/core'
import { fetchHiveIndex, putHiveManifest, readSealed, setHiveRoot, setHiveSealed } from './hive-pointer.js'
import { forgetKeyReads } from './key-list.client.js'

const INDEX_POOL = await registerPoolMeaning('hive:indexes')
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const HOST = 'one.example'
const HEAD = 'd'.repeat(64)
const ENV_A = 'a'.repeat(64)
const ENV_B = 'b'.repeat(64)
const sk = new Uint8Array(32).fill(7)
const pk = getPublicKey(sk)

let stored: unknown
const realFetch = globalThis.fetch
beforeEach(() => {
  stored = undefined
  forgetKeyReads()
  registry.set(SIGNER_KEY, {
    signEvent: async (evt: never) => finalizeEvent(evt, sk),
    getPublicKeyHex: async () => pk,
    knownPublicKeyHex: async () => pk,
  })
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname !== `/${INDEX_POOL}/${pk}`) return new Response('no route', { status: 404 })
    if ((init?.method ?? 'GET') === 'PUT') { stored = JSON.parse(String(init!.body)); return new Response('held', { status: 201 }) }
    return stored ? Response.json(stored) : new Response('none', { status: 404 })
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch; registry.clear() })

const read = async () => {
  const result = await fetchHiveIndex(HOST, pk)
  if (!result.ok) throw new Error(`index not readable: ${result.reason}`)
  return result.manifest
}

describe('readSealed', () => {
  it('keeps well-formed signatures for branches the roots name, and drops the rest', () => {
    expect(readSealed({ site: [ENV_A, 'nope', ENV_A.toUpperCase()], gone: [ENV_B], bad: 'x' }, { site: HEAD, bad: HEAD })).toEqual({ site: [ENV_A] })
    expect(readSealed(null, { site: HEAD })).toEqual({})
    expect(readSealed([], { site: HEAD })).toEqual({})
  })
})

describe('setHiveSealed', () => {
  it('names the envelopes of a published branch, reads back verified, and no-ops when asked again', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    const put = await setHiveSealed(HOST, 'site', [ENV_A, ENV_B])
    expect(put.ok).toBe(true)
    expect((await read()).sealed).toEqual({ site: [ENV_A, ENV_B] })
    expect(await setHiveSealed(HOST, 'site', [ENV_A, ENV_B])).toMatchObject({ ok: true, reason: 'unchanged' })
  })

  it('refuses a branch that is not published, a bad signature, and an index it cannot read', async () => {
    expect(await setHiveSealed(HOST, 'site', [ENV_A])).toMatchObject({ ok: false, reason: 'not-published' })
    await setHiveRoot(HOST, 'site', HEAD)
    expect(await setHiveSealed(HOST, 'other', [ENV_A])).toMatchObject({ ok: false, reason: 'not-published' })
    expect(await setHiveSealed(HOST, 'site', ['nope'])).toMatchObject({ ok: false })
    globalThis.fetch = vi.fn(async () => { throw new Error('down') }) as typeof fetch
    expect(await setHiveSealed(HOST, 'site', [ENV_A])).toMatchObject({ ok: false, reason: 'index-unsafe: unreachable' })
  })

  it('withdraws a private version with an empty list, and leaves the other branches alone', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    await setHiveRoot(HOST, 'second', HEAD)
    await setHiveSealed(HOST, 'site', [ENV_A])
    await setHiveSealed(HOST, 'second', [ENV_B])
    await setHiveSealed(HOST, 'site', [])
    expect((await read()).sealed).toEqual({ second: [ENV_B] })
  })
})

describe('every writer carries `sealed`', () => {
  it('a new root set by setHiveRoot keeps it', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    await setHiveSealed(HOST, 'site', [ENV_A])
    await setHiveRoot(HOST, 'second', 'e'.repeat(64))
    expect((await read()).sealed).toEqual({ site: [ENV_A] })
  })

  it('a rewrite of roots and doors from the verified read keeps it (what publish and the door switches do)', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    await setHiveSealed(HOST, 'site', [ENV_A])
    const before = await read()
    const put = await putHiveManifest(HOST, { ...before.roots, site: 'f'.repeat(64) }, { site: ['one.example'] }, before.createdAt, before.signedContent)
    expect(put.ok).toBe(true)
    const after = await read()
    expect(after.roots.site).toBe('f'.repeat(64))
    expect(after.doors).toEqual({ site: ['one.example'] })
    expect(after.sealed).toEqual({ site: [ENV_A] })
  })

  it('unpublishing a branch takes its envelopes with it, and the other branches keep theirs', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    await setHiveRoot(HOST, 'second', HEAD)
    await setHiveSealed(HOST, 'site', [ENV_A])
    await setHiveSealed(HOST, 'second', [ENV_B])
    const before = await read()
    const { site: _gone, ...rest } = before.roots
    await putHiveManifest(HOST, rest, {}, before.createdAt, before.signedContent)
    expect((await read()).sealed).toEqual({ second: [ENV_B] })
  })

  it('an index with no private versions is byte-for-byte what it was: no `sealed` key at all', async () => {
    await setHiveRoot(HOST, 'site', HEAD)
    const content = JSON.parse(String((stored as { content: string }).content)) as Record<string, unknown>
    expect('sealed' in content).toBe(false)
  })
})
