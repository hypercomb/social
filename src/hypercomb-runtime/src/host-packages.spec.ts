// host-packages.spec.ts — what a domain publishes, and which document answers.
//
// The projection (`packages.json`) is preferred and carries NO inventory; the
// manifest is the drain-window fallback for hosts that have not shipped since.
// Both are mutable pointers, so both must be fetched past the cache.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hostBases, listHostPackages } from './host-packages'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const BAG = 'c'.repeat(64)

type Served = Record<string, unknown>

/** A fetch that answers only the URLs it was given; everything else 404s. */
const serving = (routes: Served): ReturnType<typeof vi.fn> =>
  vi.fn(async (url: string) => {
    const body = routes[String(url)]
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  })

describe('listHostPackages', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('prefers the projection, and takes its order as the answer', async () => {
    const fetchMock = serving({
      'https://host.example/packages.json': {
        packages: [
          { sig: SIG_B, label: 'newer', at: '2026-09-01T10:00:00', beeCount: 9, layerCount: 4, beesBag: BAG },
          { sig: SIG_A, label: 'older', at: '2026-08-01T10:00:00', beeCount: 7, layerCount: 3 },
        ],
      },
      // Present, and deliberately in the opposite order — if this were read,
      // the assertions below would flip.
      'https://host.example/manifest.json': {
        packages: { [SIG_A]: { generation: 99, bees: [], layers: [], at: 'z' } },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const packages = await listHostPackages('host.example')

    expect(packages.map(p => p.packageSig)).toEqual([SIG_B, SIG_A])
    expect(packages[0]!.label).toBe('newer')
    expect(packages[0]!.beeCount).toBe(9)
    expect(packages[0]!.beesBag).toBe(BAG)
    // No inventory travels: admission derives it from the sealed root.
    expect(packages[0]!.bees).toEqual([])
    expect(packages[0]!.layers).toEqual([])
    expect(packages[0]!.dependencies).toEqual([])
    // Nothing to rank by — the list arrived ranked.
    expect(packages[0]!.generation).toBeNull()
  })

  it('falls back to the manifest for a host that has not shipped the projection', async () => {
    const fetchMock = serving({
      'https://host.example/manifest.json': {
        packages: {
          [SIG_A]: { generation: 1, bees: [SIG_B], layers: [SIG_A], dependencies: [], label: 'old ship', at: 'x' },
          [SIG_B]: { generation: 2, bees: [SIG_A, SIG_B], layers: [SIG_B], dependencies: [], label: 'newer', at: 'y' },
        },
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const packages = await listHostPackages('host.example')

    expect(packages.map(p => p.packageSig)).toEqual([SIG_B, SIG_A])   // sorted by generation
    expect(packages[0]!.bees).toEqual([SIG_A, SIG_B])                 // arrays still ride
    expect(packages[0]!.beeCount).toBe(2)                             // counts derive from them
  })

  it('reads both documents past the cache — a mutable pointer is never cached', async () => {
    const fetchMock = serving({ 'https://host.example/manifest.json': { packages: {} } })
    vi.stubGlobal('fetch', fetchMock)

    await listHostPackages('host.example')

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ cache: 'no-store' })
    }
  })

  it('drops projection entries that are not signatures', async () => {
    vi.stubGlobal('fetch', serving({
      'https://host.example/packages.json': {
        packages: [{ sig: 'not-a-signature' }, { sig: SIG_A }, { label: 'no sig at all' }],
      },
    }))

    const packages = await listHostPackages('host.example')

    expect(packages.map(p => p.packageSig)).toEqual([SIG_A])
  })

  it('keeps probing bases until one answers', async () => {
    // Nothing at the bare origin; the content-scoped base carries it.
    vi.stubGlobal('fetch', serving({
      'https://host.example/content/packages.json': { packages: [{ sig: SIG_A, label: 'here' }] },
    }))

    const packages = await listHostPackages('host.example')

    expect(packages).toHaveLength(1)
    expect(packages[0]!.base).toBe('https://host.example/content')
  })

  it('answers empty for a domain that publishes nothing', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await listHostPackages('host.example')).toEqual([])
  })

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
