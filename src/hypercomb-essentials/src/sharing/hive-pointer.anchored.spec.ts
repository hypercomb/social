// hive-pointer.anchored.spec.ts — an index a listed key signs FOR its anchor:
// a reader accepts it only when the anchor's list on that host names the signer
// and the event says it is for that anchor; a device that publishes for an
// anchor signs with its own key, tagged, and writes under the anchor.
// Real secp256k1 keys; the host and the signer's registry are faked.

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
import { firstKeyList, keyListTemplate, nextKeyList, readKeyList, registerPoolMeaning, type SignedKeyList } from '@hypercomb/core'
import { clearHiveRoot, fetchHiveIndex, ownHiveRoot, putHiveManifest, setHiveRoot } from './hive-pointer.js'
import { forgetKeyReads } from './key-list.client.js'

const INDEX_POOL = await registerPoolMeaning('hive:indexes')
const KEYS_POOL = await registerPoolMeaning('keys:lists')
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const BINDING_KEY = '@hypercomb.social/AnchorBinding'
const HOST = 'one.example'
const HEAD = 'd'.repeat(64)

const secretOf = (n: number): Uint8Array => new Uint8Array(32).fill(n)
const A = { sk: secretOf(1), pk: getPublicKey(secretOf(1)) }   // the anchor
const B = { sk: secretOf(2), pk: getPublicKey(secretOf(2)) }   // a place on its list
const C = { sk: secretOf(3), pk: getPublicKey(secretOf(3)) }   // a stranger
const T0 = 1_790_000_000

const sign = (who: { sk: Uint8Array }, template: { kind: number; created_at: number; tags: string[][]; content: string }): SignedKeyList =>
  finalizeEvent(template, who.sk) as unknown as SignedKeyList

/** A's chain, with B added. */
const chain = (): SignedKeyList[] => {
  const zero = sign(A, keyListTemplate(firstKeyList(A.pk), T0))
  const next = nextKeyList(readKeyList(zero)!, zero.id, { op: 'add', pubkey: B.pk, label: 'desktop' })!
  return [zero, sign(A, keyListTemplate(next, T0 + 1))]
}

const index = (who: { sk: Uint8Array }, tags: string[][], roots: Record<string, string> = { site: HEAD }, at = T0 + 100) =>
  sign(who, { kind: 30564, created_at: at, tags, content: JSON.stringify({ v: 1, roots }) })

type Held = { index?: unknown; chain?: unknown; puts: { url: string; auth: { pubkey: string; tags: string[][] }; body: SignedKeyList & { tags: string[][] } }[] }

const host = (held: Held): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  const method = init?.method ?? 'GET'
  if (url.pathname === `/${INDEX_POOL}/${A.pk}` || url.pathname === `/${INDEX_POOL}/${B.pk}`) {
    if (method === 'PUT') {
      const auth = JSON.parse(decodeURIComponent(escape(atob(new Headers(init!.headers).get('authorization')!.replace(/^Nostr /, '')))))
      held.puts.push({ url: String(input), auth, body: JSON.parse(String(init!.body)) })
      return new Response('held', { status: 201 })
    }
    return held.index ? Response.json(held.index) : new Response('none', { status: 404 })
  }
  if (url.pathname === `/${KEYS_POOL}/${A.pk}`) return held.chain ? Response.json(held.chain) : new Response('none', { status: 404 })
  return new Response('no route', { status: 404 })
}) as typeof fetch

const realFetch = globalThis.fetch
let held: Held
beforeEach(() => {
  held = { puts: [] }
  forgetKeyReads()
  globalThis.fetch = vi.fn(host(held)) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  registry.clear()
})

describe('reading an index a listed key signed for its anchor', () => {
  it('stands when the anchor\'s list names the signer and the event says it is for the anchor', async () => {
    held.chain = chain()
    held.index = index(B, [['anchor', A.pk]])
    const read = await fetchHiveIndex(HOST, A.pk)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.manifest.pubkey).toBe(A.pk)
    expect(read.manifest.roots).toEqual({ site: HEAD })
    expect(read.manifest.eventId).toBe((held.index as SignedKeyList).id)
  })

  it('the anchor\'s own index reads exactly as before, and asks for no list', async () => {
    held.index = index(A, [])
    const read = await fetchHiveIndex(HOST, A.pk)
    expect(read.ok).toBe(true)
    expect(vi.mocked(globalThis.fetch).mock.calls.map(c => new URL(String(c[0])).pathname)).toEqual([`/${INDEX_POOL}/${A.pk}`])
  })

  it.each([
    ['an index that does not say it is for the anchor', () => { held.chain = chain(); held.index = index(B, []) }],
    ['one that names another anchor', () => { held.chain = chain(); held.index = index(B, [['anchor', C.pk]]) }],
    ['a signer the list does not name', () => { held.chain = chain(); held.index = index(C, [['anchor', A.pk]]) }],
    ['a host that holds no list for the anchor', () => { held.index = index(B, [['anchor', A.pk]]) }],
    ['a list that does not verify', () => { const bad = chain(); bad[1] = { ...bad[1], content: bad[1].content.replace('desktop', 'laptop') }; held.chain = bad; held.index = index(B, [['anchor', A.pk]]) }],
  ])('is forged: %s', async (_name, arrange) => {
    arrange()
    expect(await fetchHiveIndex(HOST, A.pk)).toEqual({ ok: false, reason: 'forged' })
  })

  it('a tampered index is forged even from a listed key', async () => {
    held.chain = chain()
    const signed = index(B, [['anchor', A.pk]])
    held.index = { ...signed, content: JSON.stringify({ v: 1, roots: { site: 'e'.repeat(64) } }) }
    expect(await fetchHiveIndex(HOST, A.pk)).toEqual({ ok: false, reason: 'forged' })
  })
})

describe('a device that publishes for an anchor', () => {
  const asB = (bound: boolean) => {
    registry.set(SIGNER_KEY, {
      signEvent: async (evt: never) => finalizeEvent(evt, B.sk),
      getPublicKeyHex: async () => B.pk,
      knownPublicKeyHex: async () => B.pk,
    })
    if (bound) registry.set(BINDING_KEY, { anchor: () => A.pk, sources: () => [HOST], ready: async () => {} })
  }

  it('signs with its own key, tagged for the anchor, and writes under the anchor', async () => {
    asB(true)
    held.chain = chain()
    const put = await putHiveManifest(HOST, { site: HEAD }, {}, 0, undefined)
    expect(put).toMatchObject({ ok: true, pubkey: A.pk })
    expect(held.puts).toHaveLength(1)
    const sent = held.puts[0]
    expect(sent.url.endsWith(`/${INDEX_POOL}/${A.pk}`)).toBe(true)
    expect(sent.body.pubkey).toBe(B.pk)
    expect(sent.body.tags).toEqual([['anchor', A.pk]])
    expect(sent.auth.pubkey).toBe(B.pk)
    expect(sent.auth.tags.filter(t => t[0] === 'anchor')).toEqual([['anchor', A.pk]])
  })

  it('names the index it replaces, so two places cannot drop each other\'s change', async () => {
    asB(true)
    held.chain = chain()
    held.index = index(A, [], { site: HEAD, other: HEAD }, T0 + 50)
    const put = await putHiveManifest(HOST, { site: HEAD, other: HEAD, more: HEAD }, {}, T0 + 50, undefined)
    expect(put.ok).toBe(true)
    expect(held.puts[0].body.tags).toEqual([['anchor', A.pk], ['prev', (held.index as SignedKeyList).id]])
  })

  it('carries the list to a host that lacks it, from the hosts it took the anchor at, before it writes', async () => {
    asB(true)
    registry.set(BINDING_KEY, { anchor: () => A.pk, sources: () => ['source.example'], ready: async () => {} })
    const sourceChain = chain()
    const puts: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === `/${KEYS_POOL}/${A.pk}`) {
        if (init?.method === 'PUT') { puts.push(url.host); held.chain = JSON.parse(String(init.body)); return new Response('held', { status: 201 }) }
        if (url.host === 'source.example') return Response.json(sourceChain)
        return held.chain ? Response.json(held.chain) : new Response('none', { status: 404 })
      }
      return host(held)(input, init)
    }) as typeof fetch
    expect((await putHiveManifest(HOST, { site: HEAD }, {}, 0, undefined)).ok).toBe(true)
    expect(puts).toEqual([HOST])
  })

  it('without an anchor it writes exactly as it always did: its own key, untagged, under its own key', async () => {
    asB(false)
    const put = await putHiveManifest(HOST, { site: HEAD }, {}, 0, undefined)
    expect(put).toMatchObject({ ok: true, pubkey: B.pk })
    expect(held.puts[0].url.endsWith(`/${INDEX_POOL}/${B.pk}`)).toBe(true)
    expect(held.puts[0].body.tags).toEqual([])
    expect(held.puts[0].auth.tags.some(t => t[0] === 'anchor')).toBe(false)
  })

  it('every helper reads and writes the anchor\'s index', async () => {
    asB(true)
    held.chain = chain()
    held.index = index(A, [], { site: HEAD, old: HEAD }, T0 + 50)
    expect(await ownHiveRoot(HOST, 'site')).toBe(HEAD)
    expect(await setHiveRoot(HOST, 'fresh', 'e'.repeat(64))).toMatchObject({ ok: true, pubkey: A.pk })
    expect(held.puts.at(-1)!.body.tags[0]).toEqual(['anchor', A.pk])
    expect(await clearHiveRoot(HOST, 'old')).toMatchObject({ ok: true, pubkey: A.pk })
    expect(held.puts).toHaveLength(2)
  })
})
