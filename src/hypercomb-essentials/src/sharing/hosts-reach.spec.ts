// sharing/hosts-reach.spec.ts
//
// `hosts reach` walks every index a host holds, one signed POST /reach per
// index, following the cursor the host gives back until it says none follows.

import { beforeAll, describe, expect, it } from 'vitest'

const registry = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry.set(key, value) },
  get: (key: string) => registry.get(key),
  whenReady: () => void 0,
}

let reachWalk: typeof import('./hosts.queen.js').reachWalk
beforeAll(async () => { ({ reachWalk } = await import('./hosts.queen.js')) })

type Call = { url: string; auth: string; body: unknown }

const host = (pages: Array<{ walked: string | null; complete?: boolean; next: string | null }>, status = 200) => {
  const calls: Call[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) })
    const page = pages[calls.length - 1] ?? { walked: null, complete: true, next: null }
    return new Response(status === 200 ? JSON.stringify(page) : 'only this host\'s operators walk its indexes', { status })
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

describe('hosts reach', () => {
  it('follows the cursor until the host says none follows', async () => {
    const said: string[] = []
    const h = host([
      { walked: 'a'.repeat(64), complete: true, next: 'a'.repeat(64) },
      { walked: 'b'.repeat(64), complete: true, next: null },
    ])
    const out = await reachWalk('content.example.com', { fetch: h.fetch, sign: async () => 'Nostr signed', say: m => said.push(m) })
    expect(out).toEqual({ walked: 2, complete: true })
    expect(h.calls.map(c => c.url)).toEqual(['https://content.example.com/reach', 'https://content.example.com/reach'])
    expect(h.calls.map(c => c.body)).toEqual([{}, { after: 'a'.repeat(64) }])
    expect(h.calls.every(c => c.auth === 'Nostr signed')).toBe(true)
    expect(said.at(-1)).toContain('head only can go on')
  })

  it('says when an index was too large to walk whole', async () => {
    const said: string[] = []
    const h = host([{ walked: 'a'.repeat(64), complete: false, next: null }])
    const out = await reachWalk('content.example.com', { fetch: h.fetch, sign: async () => 'Nostr x', say: m => said.push(m) })
    expect(out.complete).toBe(false)
    expect(said.at(-1)).toContain('say it again')
  })

  it("stops on the host's refusal and says it", async () => {
    const said: string[] = []
    const h = host([], 403)
    const out = await reachWalk('content.example.com', { fetch: h.fetch, sign: async () => 'Nostr x', say: m => said.push(m) })
    expect(out.complete).toBe(false)
    expect(said.at(-1)).toContain('403')
    expect(h.calls).toHaveLength(1)
  })

  it('asks nothing without a signer', async () => {
    const h = host([])
    const out = await reachWalk('content.example.com', { fetch: h.fetch, sign: async () => null, say: () => {} })
    expect(out.complete).toBe(false)
    expect(h.calls).toHaveLength(0)
  })
})
