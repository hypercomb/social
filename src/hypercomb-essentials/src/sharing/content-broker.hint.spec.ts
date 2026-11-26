// content-broker.hint.spec.ts — A READ HINTS, A TAKE LEARNS (review 2026-11-25).
//
// A model's explore or pool read names dozens of hosts it merely listed. They
// steer where a later fetch of that signature asks, but none of them joins the
// broker's persisted host list (24 places, the hosts adopts learned), the
// service worker or `domain:learned`. noteDomainsForSig, the adopt path, still
// learns durably.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone
const KNOWN = 'hc:known-domains'
const SIG = '9'.repeat(64)
const persisted = (): string[] => { try { return JSON.parse(localStorage.getItem(KNOWN) ?? '[]') as string[] } catch { return [] } }

beforeAll(async () => {
  registrations.set('@diamondcoreprocessor.com/NostrMeshDrone', { subscribe: () => ({ close: () => void 0 }), publish: async () => true })
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
})

beforeEach(() => { localStorage.removeItem(KNOWN) })
afterEach(() => { vi.unstubAllGlobals() })

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('a read hints, a take learns', () => {
  it('a hint steers the signature and learns no host', () => {
    const broker = new ContentBrokerDrone()
    const learned: string[] = []
    const off = EffectBus.on('domain:learned', (payload: { host?: string }) => { learned.push(String(payload?.host ?? '')) })
    try {
      broker.hintDomainsForSig(SIG, ['listed-only.example'])
      // Not a host that served it: getKnownDomains()[0] is read as the
      // publisher's domain (the adopt fold learns it, the run gate trusts it).
      expect(broker.getKnownDomains(SIG)).not.toContain('listed-only.example')
      expect(persisted()).not.toContain('listed-only.example')
      expect(broker.knownContentHosts()).not.toContain('listed-only.example')
      expect(learned).not.toContain('listed-only.example')
    } finally { off?.() }
  })

  it('a hint never stands in front of a publisher a note named', () => {
    const broker = new ContentBrokerDrone()
    broker.hintDomainsForSig(SIG, ['lister.example'])
    broker.noteDomainsForSig(SIG, ['publisher.example'])
    expect(broker.getKnownDomains(SIG)[0]).toBe('publisher.example')
    expect(persisted()).not.toContain('lister.example')
  })

  it('a hinted host still steers the fetch of that signature', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: unknown) => {
      asked.push(new URL(String(input instanceof Request ? input.url : input)).host)
      return new Response('', { status: 404 })
    })
    const broker = new ContentBrokerDrone()
    broker.hintDomainsForSig(SIG, ['listed-only.example'])
    await broker.fetchBySig(SIG, 'layer' as never, 2_000)
    expect(asked).toContain('listed-only.example')
  }, 30_000)

  it('a note (the adopt path) still learns the host durably', () => {
    const broker = new ContentBrokerDrone()
    broker.noteDomainsForSig(SIG, ['served.example'])
    expect(broker.getKnownDomains(SIG)).toContain('served.example')
    expect(persisted()).toContain('served.example')
  })

  it('the walk of a hinted head learns the host that served it, never the hosts that only listed it', async () => {
    const CHILD = '8'.repeat(64)
    const bytes = new TextEncoder().encode(JSON.stringify({ name: 'head', children: [CHILD] }))
    const head = await sha256(bytes)
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = new URL(String(input instanceof Request ? input.url : input))
      asked.push(url.host, `${url.host} ${url.pathname.split('/').pop()}`)
      if (url.host === 'served.example' && url.pathname.endsWith(head)) return new Response(bytes.slice(), { status: 200 })
      return new Response('', { status: 404 })
    })
    const broker = new ContentBrokerDrone()
    broker.hintDomainsForSig(head, ['listed.example', 'served.example'])
    await broker.adopt(head, { layersOnly: true, silent: true, quiet: true })
    expect(asked).toContain('served.example')
    expect(persisted()).toContain('served.example')
    // Still a hint for the child, so its fetch asked there, but not learned
    // and never offered as the child's publisher.
    expect(asked).toContain(`listed.example ${CHILD}`)
    expect(broker.getKnownDomains(CHILD)).not.toContain('listed.example')
    expect(persisted()).not.toContain('listed.example')
    expect(broker.knownContentHosts()).not.toContain('listed.example')
  }, 30_000)
})
