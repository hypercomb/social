// host-packages.spec.ts — what a domain publishes, and how a client finds it.
//
// Discovery is a POOL OF MEANING: the client derives the address from the
// meaning and asks there. Nothing is published saying where to look, so these
// tests derive the address the same way the code does rather than writing a
// signature down — a hardcoded hex here would pass while the two sides drifted.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPoolMeaning } from '@hypercomb/core'
import { headPackage, hostBases, listHostPackages } from './host-packages'
import { HOST_PACKAGES_MEANING, poolEntryName } from './host-pool'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

type Served = Record<string, unknown>

/** A fetch that answers only the URLs it was given; everything else 404s. */
const serving = (routes: Served): ReturnType<typeof vi.fn> =>
  vi.fn(async (url: string) => {
    const body = routes[String(url)]
    if (body === undefined) return { ok: false, status: 404 } as unknown as Response
    return {
      ok: true,
      status: 200,
      text: async () => String(body),
      json: async () => body,
    } as unknown as Response
  })

/** The pool as a host lays it out: one signature per gapless index. */
const poolAt = async (base: string, sigs: string[]): Promise<Served> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  return Object.fromEntries(sigs.map((sig, i) => [`${base}/${pool}/${poolEntryName(i)}`, sig]))
}

describe('headPackage — discovery', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('finds the head at the derived address, with no document anywhere', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [SIG_B, SIG_A])))

    const head = await headPackage('host.example')

    expect(head?.packageSig).toBe(SIG_A)          // max index, not first
    expect(head?.base).toBe('https://host.example')
    // Nothing else travels — admission derives the rest from this one sig.
    expect(head?.bees).toEqual([])
    expect(head?.layers).toEqual([])
  })

  it('asks no named document when the pool answers', async () => {
    const fetchMock = serving(await poolAt('https://host.example', [SIG_A]))
    vi.stubGlobal('fetch', fetchMock)

    await headPackage('host.example')

    const asked = fetchMock.mock.calls.map(call => String(call[0]))
    expect(asked.some(url => url.endsWith('manifest.json'))).toBe(false)
  })

  it('finds the pool on the content-scoped base too', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example/content', [SIG_A])))

    expect((await headPackage('host.example'))?.base).toBe('https://host.example/content')
  })

  it('falls back to the manifest for a host that has not shipped the pool', async () => {
    vi.stubGlobal('fetch', serving({
      'https://host.example/manifest.json': {
        packages: {
          [SIG_A]: { generation: 1, bees: [], layers: [SIG_A], dependencies: [] },
          [SIG_B]: { generation: 2, bees: [], layers: [SIG_B], dependencies: [] },
        },
      },
    }))

    expect((await headPackage('host.example'))?.packageSig).toBe(SIG_B)   // newest
  })

  it('refuses a head entry that is not a signature, rather than trusting it', async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    vi.stubGlobal('fetch', serving({
      [`https://host.example/${pool}/${poolEntryName(0)}`]: 'see https://example.com/setup',
    }))

    expect(await headPackage('host.example')).toBeNull()
  })

  it('treats an SPA fallback page as an empty pool', async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    vi.stubGlobal('fetch', serving({
      [`https://host.example/${pool}/${poolEntryName(0)}`]: '<!doctype html><html></html>',
    }))

    expect(await headPackage('host.example')).toBeNull()
  })

  it('answers null for a domain that publishes nothing at all', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await headPackage('host.example')).toBeNull()
  })
})

describe('listHostPackages — the browse surface', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('still reads the manifest, because a name is a mark the pool cannot yet wear', async () => {
    vi.stubGlobal('fetch', serving({
      'https://host.example/manifest.json': {
        packages: {
          [SIG_A]: { generation: 1, bees: [SIG_B], layers: [SIG_A], dependencies: [], label: 'older' },
          [SIG_B]: { generation: 2, bees: [SIG_A, SIG_B], layers: [SIG_B], dependencies: [], label: 'newer' },
        },
      },
    }))

    const packages = await listHostPackages('host.example')

    expect(packages.map(p => p.packageSig)).toEqual([SIG_B, SIG_A])
    expect(packages[0]!.label).toBe('newer')
    expect(packages[0]!.beeCount).toBe(2)
  })

  it('reads the manifest past the cache — a named document is a mutable pointer', async () => {
    const fetchMock = serving({ 'https://host.example/manifest.json': { packages: {} } })
    vi.stubGlobal('fetch', fetchMock)

    await listHostPackages('host.example')

    for (const call of fetchMock.mock.calls) expect(call[1]).toMatchObject({ cache: 'no-store' })
  })

  it('answers empty for a domain that publishes nothing', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await listHostPackages('host.example')).toEqual([])
  })
})

describe('hostBases', () => {
  it('asks the content-scoped base before the bare one, http only for loopback', () => {
    expect(hostBases('host.example')).toEqual([
      'https://host.example/content',
      'https://host.example',
      'https://content.host.example/content',
      'https://content.host.example',
    ])
    expect(hostBases('localhost:4270')[0]).toBe('http://localhost:4270/content')
  })
})
