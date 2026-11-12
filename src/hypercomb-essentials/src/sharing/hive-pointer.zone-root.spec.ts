// hive-pointer.zone-root.spec.ts — an index write refused by a site is carried to its zone root.
//
// The worker takes every write at the zone root and refuses it, with a readable
// 405, on any site under one. A publish that still names the site used to stop at
// its last step ("the bytes are hosted but the hive index update failed"). Now the
// index goes to the zone root once, and anything else stays the failure it was.

import { describe, expect, it, vi } from 'vitest'
import { putHiveManifest, zoneRootAfterRefusal } from './hive-pointer.js'

const PUB = 'a'.repeat(64)
const OTHER = 'c'.repeat(64)

const withSigner = async (fetchImpl: (url: string, init?: RequestInit) => Response, run: (calls: string[]) => Promise<void>): Promise<void> => {
  const shell = globalThis as unknown as { ioc?: { get: (key: string) => unknown } }
  const original = shell.ioc
  const signEvent = vi.fn(async (event: Record<string, unknown>) => ({ ...event, pubkey: PUB }))
  const fetchBefore = globalThis.fetch
  const calls: string[] = []
  shell.ioc = { get: key => key === '@diamondcoreprocessor.com/NostrSigner' ? { signEvent } : original?.get(key) }
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(`${init?.method ?? 'GET'} ${new URL(url).host}`)
    return fetchImpl(url, init)
  }) as typeof fetch
  try { await run(calls) } finally { shell.ioc = original; globalThis.fetch = fetchBefore }
}

const readOnly = (): Response => new Response('published Core hosts are read-only\n', { status: 405, headers: { 'X-Reason': 'published Core hosts are read-only' } })

describe('zoneRootAfterRefusal', () => {
  it('points a read-only refusal from a site at its zone root', () => {
    expect(zoneRootAfterRefusal('protocol.hypercomb.com', 'host said 405: published Core hosts are read-only')).toBe('hypercomb.com')
    expect(zoneRootAfterRefusal('https://revolucion.pluginthematrix.com/', 'host said 405: the host door is read-only - write at the zone root')).toBe('pluginthematrix.com')
  })

  it('carries nothing anywhere else', () => {
    expect(zoneRootAfterRefusal('hypercomb.com', 'host said 405: published Core hosts are read-only')).toBe('')
    expect(zoneRootAfterRefusal('protocol.hypercomb.com', 'host unreachable')).toBe('')
    expect(zoneRootAfterRefusal('protocol.hypercomb.com', 'host said 401: not allowed')).toBe('')
    expect(zoneRootAfterRefusal('protocol.hypercomb.com', 'host said 405: method not allowed')).toBe('')
    expect(zoneRootAfterRefusal('content.localhost:8787', 'host said 405: published Core hosts are read-only')).toBe('')
  })
})

describe('putHiveManifest at a site', () => {
  it('writes the index at the zone root when the site refuses it as read-only', async () => {
    await withSigner(
      (url, init) => init?.method === 'PUT' && new URL(url).host === 'protocol.hypercomb.com' ? readOnly() : new Response('', { status: 200 }),
      async (calls) => {
        const result = await putHiveManifest('protocol.hypercomb.com', { protocol: OTHER })
        expect(result.ok).toBe(true)
        expect(calls.filter(c => c.startsWith('PUT'))).toEqual(['PUT protocol.hypercomb.com', 'PUT hypercomb.com'])
      },
    )
  })

  it('stays the failure it was when the zone root refuses too', async () => {
    await withSigner(
      (_url, init) => init?.method === 'PUT' ? readOnly() : new Response('', { status: 200 }),
      async (calls) => {
        const result = await putHiveManifest('protocol.hypercomb.com', { protocol: OTHER })
        expect(result.ok).toBe(false)
        expect(result.reason).toMatch(/^host said 405/)
        expect(calls.filter(c => c.startsWith('PUT'))).toEqual(['PUT protocol.hypercomb.com', 'PUT hypercomb.com'])
      },
    )
  })

  it('does not move a write that failed for another reason', async () => {
    await withSigner(
      (_url, init) => init?.method === 'PUT' ? new Response('no\n', { status: 401, headers: { 'X-Reason': 'not allowed' } }) : new Response('', { status: 200 }),
      async (calls) => {
        const result = await putHiveManifest('protocol.hypercomb.com', { protocol: OTHER })
        expect(result.ok).toBe(false)
        expect(calls.filter(c => c.startsWith('PUT'))).toEqual(['PUT protocol.hypercomb.com'])
      },
    )
  })
})
