import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.boot.drone.js').ContentBrokerDrone

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', exact))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.boot.drone.js'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  registrations.clear()
})

describe('typed artifacts over immutable HTTP', () => {
  it('loads a peer image from a healthy mirror while an earlier host is hung', async () => {
    const bytes = new TextEncoder().encode('peer image bytes')
    const sig = await sha256(bytes)
    const putResource = vi.fn(async () => sig)
    registrations.set('@hypercomb.social/Store', { getResourceLocal: async () => null, putResource })
    let aborted = false
    const fetchMock = vi.fn((url: string, options: RequestInit) => {
      if (url.startsWith('https://hung.example/')) {
        return new Promise<Response>((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        })
      }
      return Promise.resolve(new Response(new Uint8Array(bytes)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const broker = new ContentBrokerDrone()
    // Both attributed: one wave, bounded overlap — the hung one never blocks.
    broker.noteDomainsForSig(sig, ['hung.example', 'images.example'])
    expect(Array.from((await broker.fetchBySig(sig, 'resource'))!)).toEqual(Array.from(bytes))
    expect(aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(putResource).toHaveBeenCalledTimes(1)
  })

  it('rejects corrupt bytes and still resolves a valid mirror', async () => {
    const bytes = new TextEncoder().encode('correct image')
    const sig = await sha256(bytes)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
      url.startsWith('https://bad.example/') ? 'wrong bytes' : new Uint8Array(bytes),
    )))
    const broker = new ContentBrokerDrone()
    broker.noteDomain('bad.example')
    broker.noteDomain('good.example')
    expect(Array.from((await broker.fetchBySig(sig, 'resource'))!)).toEqual(Array.from(bytes))
  })

  it('does not spend a second timeout on a host at a different URL layout', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const broker = new ContentBrokerDrone()
    broker.noteDomain('offline.example')
    const pending = broker.fetchBySig('a'.repeat(64), 'bee')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await pending).toBeNull()
    // One timeout for the host, never a second at another URL layout. (The
    // shipped byte mirrors are asked too since 2026-10-12 — a loopback page
    // resolves where every install does — each once, at its own address.)
    const asked = fetchMock.mock.calls.map(([url]) => String(url))
    expect(asked.filter(url => url.includes('offline.example'))).toHaveLength(1)
    expect(new Set(asked).size).toBe(asked.length)
  })

  it('never asks the app shell, and asks a host that throws once for the whole burst', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('hypercomb.io') || String(url).includes('dead.example')) {
        throw new TypeError('Failed to fetch')
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const broker = new ContentBrokerDrone()
    broker.noteDomain('https://WWW.hypercomb.io.')
    broker.noteDomain('dead.example')
    const sigA = 'a'.repeat(64)
    const sigB = 'b'.repeat(64)
    expect(await broker.fetchBySig(sigA, 'resource')).toBeNull()
    const afterFirst = fetchMock.mock.calls.length
    expect(await broker.fetchBySig(sigB, 'resource')).toBeNull()
    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.some(url => url.includes('hypercomb.io'))).toBe(false)
    expect(urls.some(url => url.includes('dead.example'))).toBe(true)
    expect(urls.slice(afterFirst).some(url => url.includes('dead.example'))).toBe(false)
    expect(broker.knownContentHosts()).not.toContain('www.hypercomb.io')
    expect(broker.knownContentHosts()).toContain('dead.example')
  })

  it('asks a learned publisher once across a burst of unattributed misses', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const broker = new ContentBrokerDrone()
    broker.noteDomain('publisher.example')
    const sigA = 'a'.repeat(64)
    const sigB = 'b'.repeat(64)
    const sigC = 'c'.repeat(64)
    const sigD = 'd'.repeat(64)
    const sigE = 'e'.repeat(64)
    expect(await broker.fetchBySig(sigA, 'bee')).toBeNull()
    expect(await broker.fetchBySig(sigB, 'bee')).toBeNull()
    const first = fetchMock.mock.calls.map(([url]) => String(url))
    const publisher = first.filter(url => url.includes('publisher.example'))
    expect(publisher.length).toBeGreaterThan(0)
    expect(publisher.every(url => url.includes(sigA))).toBe(true)
    expect(first.some(url => url === `https://hypercomb.com/${sigA}`)).toBe(true)
    expect(first.some(url => url === `https://hypercomb.com/${sigB}`)).toBe(true)
    expect(first.some(url => url === `https://hypercomb.com/content/${sigB}`)).toBe(true)

    const [left, right] = ['1'.repeat(64), '2'.repeat(64)]
    const beforeBurst = fetchMock.mock.calls.length
    expect(await Promise.all([
      broker.fetchBySig(left, 'bee'),
      broker.fetchBySig(right, 'bee'),
    ])).toEqual([null, null])
    const burst = fetchMock.mock.calls.slice(beforeBurst).map(([url]) => String(url))
    const burstPublisher = burst.filter(url => url.includes('publisher.example'))
    expect(burstPublisher).toEqual([])
    expect(burst.some(url => url === `https://hypercomb.com/${left}`)).toBe(true)
    expect(burst.some(url => url === `https://hypercomb.com/${right}`)).toBe(true)

    broker.noteDomainsForSig(sigC, ['publisher.example'])
    expect(await broker.fetchBySig(sigC, 'bee')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url === `https://publisher.example/${sigC}`)).toBe(true)

    broker.noteDomain('publisher.example')
    expect(await broker.fetchBySig(sigD, 'bee')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url === `https://publisher.example/${sigD}`)).toBe(true)
    expect(await broker.fetchBySig(sigE, 'bee')).toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('publisher.example') && url.includes(sigE))).toBe(false)
  })

  it('collapses two spellings of one host into one fetch source', () => {
    const broker = new ContentBrokerDrone()
    broker.noteDomain('HTTPS://CDN.Example./content')
    broker.noteDomain('cdn.example/content')
    const hosts = broker.knownContentHosts().filter(host => host.includes('cdn.example'))
    expect(hosts).toEqual(['cdn.example/content'])
  })

  it('resolves, verifies, and locally caches a bee without putting code on Swarm', async () => {
    const bytes = new TextEncoder().encode('export default class TestBee {}')
    const sig = await sha256(bytes)
    const writeBeeBytes = vi.fn(async () => void 0)
    registrations.set('@hypercomb.social/Store', {
      getBeeBytes: async () => null,
      writeBeeBytes,
    })
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const broker = new ContentBrokerDrone()
    broker.noteDomain('artifacts.example')
    const resolved = await broker.fetchBySig(sig, 'bee')

    expect(resolved && [...resolved]).toEqual([...bytes])
    expect(fetchMock).toHaveBeenCalledWith(
      `https://artifacts.example/${sig}`,
      expect.objectContaining({ cache: 'default' }),
    )
    expect(writeBeeBytes).toHaveBeenCalledWith(sig, expect.any(Uint8Array))
  })
})
