// acquire-fetch-across.spec.ts — a base that throws goes silent for the walk.
//
// The Azure apex answers a miss with a 404 page that carries no CORS header,
// so from another origin every miss there is a THROWN fetch, not a 404. Asked
// first for each of three hundred atoms, it threw three hundred times before
// the host that held them was asked. One throw is enough for one walk.

import { describe, expect, it, vi } from 'vitest'
import { fetchAcross } from './acquire'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

const heldBy = (base: string, bytes: Uint8Array) =>
  vi.fn(async (url: string) => {
    if (url.startsWith('https://throws.example/')) throw new TypeError('Failed to fetch')
    if (url.startsWith('https://five-hundred.example/')) return { ok: false, status: 500, headers: new Headers() } as unknown as Response
    if (url.startsWith(`${base}/`)) {
      return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => bytes.buffer } as unknown as Response
    }
    return { ok: false, status: 404, headers: new Headers() } as unknown as Response
  })

describe('fetchAcross', () => {
  it('asks a base that threw once, then never again for the rest of the walk', async () => {
    const fetchMock = heldBy('https://holds.example', new Uint8Array([1, 2, 3]))
    vi.stubGlobal('fetch', fetchMock)
    const fetch = fetchAcross(['https://throws.example', 'https://holds.example'])

    expect(await fetch(SIG_A)).toBeInstanceOf(Uint8Array)
    expect(await fetch(SIG_B)).toBeInstanceOf(Uint8Array)

    const thrown = fetchMock.mock.calls.filter(call => String(call[0]).startsWith('https://throws.example/'))
    expect(thrown).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('keeps asking a base that answered with a status — a 5xx is per atom, not a silence', async () => {
    const fetchMock = heldBy('https://holds.example', new Uint8Array([1]))
    vi.stubGlobal('fetch', fetchMock)
    const fetch = fetchAcross(['https://five-hundred.example', 'https://holds.example'])

    await fetch(SIG_A)
    await fetch(SIG_B)

    const fives = fetchMock.mock.calls.filter(call => String(call[0]).startsWith('https://five-hundred.example/'))
    expect(fives).toHaveLength(2)
    vi.unstubAllGlobals()
  })

  it('a fresh walk asks the silenced base again', async () => {
    const fetchMock = heldBy('https://holds.example', new Uint8Array([1]))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAcross(['https://throws.example', 'https://holds.example'])(SIG_A)
    await fetchAcross(['https://throws.example', 'https://holds.example'])(SIG_B)

    const thrown = fetchMock.mock.calls.filter(call => String(call[0]).startsWith('https://throws.example/'))
    expect(thrown).toHaveLength(2)
    vi.unstubAllGlobals()
  })
})
