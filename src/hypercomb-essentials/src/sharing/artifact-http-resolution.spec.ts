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
    broker.noteDomain('hung.example')
    broker.noteDomainsForSig(sig, ['images.example'])
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
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
