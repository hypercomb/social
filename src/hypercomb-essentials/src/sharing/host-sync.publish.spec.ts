// host-sync.publish.spec.ts — PUBLISH THESE FILES NOW. A commit uploads every
// new file to a host and reads it back before the install pointer moves: a
// file already served is not sent again, every upload is signed, and the
// first file the host will not serve stops the publish and is named.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => undefined,
}

type Publish = (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
  Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string; sig?: string }>
let publishAtoms: Publish

beforeAll(async () => {
  registry.set('@diamondcoreprocessor.com/NostrSigner', {
    signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'e', pubkey: 'p'.repeat(64), sig: 's' }),
  })
  // The sharing boot bee registers the host sync (atomic-modules-plan.md); the
  // spec takes the instance the module exports.
  const { hostSyncService } = await import('./host-sync.service.js')
  publishAtoms = (hostSyncService as unknown as { publishAtoms: Publish }).publishAtoms
})

const file = async (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return { bytes, sig: await SignatureService.sign(bytes.slice().buffer as ArrayBuffer) }
}

/** A host that serves what it holds and takes a signed PUT whose body hashes to its URL. */
const host = (held: Map<string, Uint8Array>, refuse = new Set<string>()) => vi.fn(async (url: string, init?: RequestInit) => {
  const sig = url.split('/').pop()!
  if (init?.method === 'PUT') {
    if (!String((init.headers as Record<string, string>)['Authorization']).startsWith('Nostr ')) return new Response(null, { status: 401 })
    if (refuse.has(sig)) return new Response(null, { status: 403 })
    held.set(sig, new Uint8Array(init.body as ArrayBuffer))
    return new Response(null, { status: 201 })
  }
  const bytes = held.get(sig)
  // A miss answers like an SPA fallback: 200 with a page — never a held file.
  if (init?.method === 'HEAD') return bytes ? new Response(null, { status: 200, headers: { 'content-type': 'application/octet-stream' } }) : new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })
  return bytes ? new Response(bytes.slice()) : new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
})

describe('publishAtoms', () => {
  it('sends what the host lacks, skips what it serves, and reads every upload back', async () => {
    const [a, b] = [await file('{"name":"root"}'), await file('export {}')]
    const held = new Map([[a.sig, a.bytes]])
    const fetch = host(held)
    vi.stubGlobal('fetch', fetch)
    const local = new Map([[a.sig, a.bytes], [b.sig, b.bytes]])
    const outcome = await publishAtoms('content.example.com', [a.sig, b.sig], async sig => local.get(sig) ?? null)
    expect(outcome).toEqual({ ok: true, sent: 1, held: 1 })
    expect(new TextDecoder().decode(held.get(b.sig))).toBe('export {}')
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([url]) => url)).toEqual([`https://content.example.com/${b.sig}`])
    vi.unstubAllGlobals()
  })

  it('stops at the first file the host will not take, and names it', async () => {
    const b = await file('export const x = 1')
    vi.stubGlobal('fetch', host(new Map(), new Set([b.sig])))
    const outcome = await publishAtoms('http://localhost:4270/', [b.sig], async () => b.bytes)
    expect(outcome).toMatchObject({ ok: false, sig: b.sig, error: 'localhost:4270 does not accept uploads from this key' })
    vi.unstubAllGlobals()
  })

  it('refuses a file this store does not hold, or holds under the wrong name', async () => {
    const b = await file('export const y = 2')
    vi.stubGlobal('fetch', host(new Map()))
    expect(await publishAtoms('example.com', [b.sig], async () => null)).toMatchObject({ ok: false, sig: b.sig })
    expect(await publishAtoms('example.com', [b.sig], async () => new TextEncoder().encode('other'))).toMatchObject({ ok: false, error: `${b.sig.slice(0, 12)}… held here does not hash to its name` })
    vi.unstubAllGlobals()
  })
})
