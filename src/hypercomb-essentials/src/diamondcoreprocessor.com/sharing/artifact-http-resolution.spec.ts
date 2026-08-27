import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const registrations = new Map<string, unknown>()
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registrations.set(key, value) },
  get: (key: string) => registrations.get(key),
  whenReady: () => void 0,
}

let ContentBrokerDrone: typeof import('./content-broker.drone.js').ContentBrokerDrone

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', exact))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

beforeAll(async () => {
  ;({ ContentBrokerDrone } = await import('./content-broker.drone.js'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  registrations.clear()
})

describe('typed artifacts over immutable HTTP', () => {
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
