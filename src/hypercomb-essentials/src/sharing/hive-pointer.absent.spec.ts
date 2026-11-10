// hive-pointer.absent.spec.ts — "no index here", asked quietly and remembered
// (2026-11-09: "we can't afford to ever have any errors popping up"). The home
// relay at a domain's apex keeps no copy of a publisher's index by design, and
// the Publish sweep asked it again on every head change — each ask a red 404
// in the console. The read asks `?held` (a host that knows the flag answers a
// miss 204), and a miss is remembered for a while; `fresh` reads and an index
// found forget it.

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const held = new Map<string, unknown>()
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: (key: string, value: unknown) => { held.set(key, value) },
    get: (key: string) => held.get(key),
    whenReady: () => {},
  }
})

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { registerPoolMeaning } from '@hypercomb/core'
import { fetchHiveIndex } from './hive-pointer.js'

const INDEX_POOL = await registerPoolMeaning('hive:indexes')
const keyOf = (n: number) => { const sk = new Uint8Array(32).fill(n); return { sk, pk: getPublicKey(sk) } }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a host with no index for this key', () => {
  it('is asked with ?held, and its miss — 404 or a quiet 204 — is remembered, not asked again', async () => {
    for (const [n, status] of [[11, 404], [12, 204]] as const) {
      const { pk } = keyOf(n)
      const fetch = vi.fn(async () => new Response(null, { status }))
      vi.stubGlobal('fetch', fetch)
      expect(await fetchHiveIndex('relay.example', pk)).toEqual({ ok: false, reason: 'http', status: 404 })
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(`https://relay.example/${INDEX_POOL}/${pk}?held`)
      expect(await fetchHiveIndex('relay.example', pk)).toEqual({ ok: false, reason: 'http', status: 404 })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('a fresh read always asks, and the miss is asked again once its quiet time is over', async () => {
    const { pk } = keyOf(13)
    const fetch = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    await fetchHiveIndex('relay.example', pk)
    await fetchHiveIndex('relay.example', pk, undefined, { fresh: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60_000 + 1)
    await fetchHiveIndex('relay.example', pk)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('an index found there forgets the miss at once', async () => {
    const key = keyOf(14)
    const evt = finalizeEvent({ kind: 30564, created_at: 1_790_000_000, tags: [], content: JSON.stringify({ v: 1, roots: {} }) }, key.sk)
    let holds = false
    const fetch = vi.fn(async () => holds ? new Response(JSON.stringify(evt), { status: 200 }) : new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    await fetchHiveIndex('relay.example', key.pk)
    holds = true
    expect((await fetchHiveIndex('relay.example', key.pk, undefined, { fresh: true })).ok).toBe(true)
    expect((await fetchHiveIndex('relay.example', key.pk)).ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('an unreachable host is never remembered as holding nothing', async () => {
    const { pk } = keyOf(15)
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetch)
    expect(await fetchHiveIndex('relay.example', pk)).toEqual({ ok: false, reason: 'unreachable' })
    expect(await fetchHiveIndex('relay.example', pk)).toEqual({ ok: false, reason: 'unreachable' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
