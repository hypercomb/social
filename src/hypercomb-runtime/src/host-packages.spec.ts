// host-packages.spec.ts — what a domain publishes, and how a client finds it.
//
// Discovery is a POOL OF MEANING: the client derives the address from the
// meaning and asks there. Nothing is published saying where to look, so these
// tests derive the address the same way the code does rather than writing a
// signature down — a hardcoded hex here would pass while the two sides drifted.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPoolMeaning } from '@hypercomb/core'
import { _resetSettledBases, askHostPackages, headPackage, hostBases, listHostPackages } from './host-packages'
import { HOST_PACKAGES_MEANING, poolEntryName } from './host-pool'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)

type Served = Record<string, unknown>

/** A fetch that answers only the URLs it was given; everything else 404s. */
const serving = (routes: Served): ReturnType<typeof vi.fn> =>
  vi.fn(async (url: string) => {
    const body = routes[String(url)]
    if (body === undefined) return { ok: false, status: 404, headers: new Headers() } as unknown as Response
    return {
      ok: true,
      status: 200,
      // A host that does not date its files simply yields rows without a date.
      headers: new Headers(),
      text: async () => String(body),
      json: async () => body,
    } as unknown as Response
  })

/** The pool as a host lays it out: the DIRECTORY answering with its entry
 *  names, and one signature per gapless index underneath it. */
const poolAt = async (base: string, sigs: string[]): Promise<Served> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  const names = sigs.map((_, i) => poolEntryName(i))
  return {
    [`${base}/${pool}/`]: names.join('\n'),
    ...Object.fromEntries(sigs.map((sig, i) => [`${base}/${pool}/${poolEntryName(i)}`, sig])),
  }
}

/** A host whose relay predates the directory branch: entries, no listing. */
const poolWithoutListing = async (base: string, sigs: string[]): Promise<Served> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  return Object.fromEntries(sigs.map((sig, i) => [`${base}/${pool}/${poolEntryName(i)}`, sig]))
}

beforeEach(() => { _resetSettledBases() })

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

  it('falls back to probing for a host whose relay cannot list a directory', async () => {
    vi.stubGlobal('fetch', serving(await poolWithoutListing('https://host.example', [SIG_B, SIG_A])))

    expect((await headPackage('host.example'))?.packageSig).toBe(SIG_A)
  })

  it('asks the base that answered first on the next probe, sparing the dead bases', async () => {
    const fetchMock = serving(await poolAt('https://root.example', [SIG_A]))
    vi.stubGlobal('fetch', fetchMock)

    expect((await headPackage('root.example'))?.base).toBe('https://root.example')
    fetchMock.mockClear()
    expect((await headPackage('root.example'))?.packageSig).toBe(SIG_A)

    const asked = fetchMock.mock.calls.map(call => String(call[0]))
    expect(asked.some(url => url.startsWith('https://root.example/content/'))).toBe(false)
  })

  it('once the pool has settled a base, atoms are fetched from that base alone', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://root.example', [SIG_A])))
    expect(hostBases('root.example')).toHaveLength(4)

    await headPackage('root.example')
    expect(hostBases('root.example')).toEqual(['https://root.example'])
  })

  it('remembers the settled base across sessions, and forgets one that no longer fits the zone', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://root.example/content', [SIG_A])))
    await headPackage('root.example')
    expect(localStorage.getItem('hc:host-base:root.example')).toBe('https://root.example/content')

    localStorage.setItem('hc:host-base:other.example', 'https://elsewhere.example')
    expect(hostBases('other.example')).toHaveLength(4)
  })

  it('answers null for a domain that publishes nothing at all', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await headPackage('host.example')).toBeNull()
  })
})

describe('listHostPackages — the browse surface', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('walks the pool, newest first, with each row named by its own entry', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [SIG_B, SIG_A])))

    const rows = await listHostPackages('host.example')

    expect(rows.map(r => r.packageSig)).toEqual([SIG_A, SIG_B])   // head first
    expect(rows.map(r => r.poolIndex)).toEqual([1, 0])            // older pages have an exact cursor
    expect(rows[0]!.bees).toEqual([])                             // no inventory travels
  })

  it('takes a page, not a host’s whole history', async () => {
    const sigs = Array.from({ length: 40 }, (_, i) => String(i).padStart(64, '0'))
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', sigs)))

    expect(await listHostPackages('host.example', { limit: 5 })).toHaveLength(5)
  })

  it('pages further back with `before`', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [SIG_A, SIG_B])))

    const page = await listHostPackages('host.example', { before: 1 })

    expect(page.map(r => r.packageSig)).toEqual([SIG_A])   // index 0 only
    expect(page[0]?.poolIndex).toBe(0)
  })

  it('answers empty for a domain that publishes no pool at all', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await listHostPackages('host.example')).toEqual([])
  })
})

describe('hostBases', () => {
  it('asks the content-scoped base before the bare one, http only for loopback', () => {
    expect(hostBases('unsettled.example')).toEqual([
      'https://unsettled.example/content',
      'https://unsettled.example',
      'https://content.unsettled.example/content',
      'https://content.unsettled.example',
    ])
    expect(hostBases('localhost:4270')[0]).toBe('http://localhost:4270/content')
  })
})

describe('askHostPackages — an empty answer says which kind of empty', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('an honest 404 at the derived address is a host that ANSWERED and publishes nothing', async () => {
    vi.stubGlobal('fetch', serving({}))
    const { packages, answered } = await askHostPackages('host.example')
    expect(packages).toEqual([])
    expect(answered).toBe(true)
  })

  it('a door that throws on every base did NOT answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const { packages, answered } = await askHostPackages('host.example')
    expect(packages).toEqual([])
    expect(answered).toBe(false)
  })

  it('a host with a pool answers with its rows', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [SIG_A])))
    const { packages, answered } = await askHostPackages('host.example')
    expect(answered).toBe(true)
    expect(packages.map(p => p.packageSig)).toEqual([SIG_A])
  })
})

describe('a zone that publishes nothing — asked once, quietly', () => {
  beforeEach(() => vi.unstubAllGlobals())

  /** A fetch that answers `said` with a 404 carrying that body — how a host
   *  that speaks the directory branch says the address holds nothing — and
   *  404s everything else with a body that says nothing about a pool. */
  const sayingNoPool = (said: Record<string, string>): ReturnType<typeof vi.fn> =>
    vi.fn(async (url: string) => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => said[String(url)] ?? 'Not Found',
    }) as unknown as Response)

  it("stops at the worker's final 404: no index probe, no other face", async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const fetchMock = sayingNoPool({ [`https://host.example/${pool}/`]: 'no pool at this address\n' })
    vi.stubGlobal('fetch', fetchMock)

    expect(await askHostPackages('host.example')).toEqual({ packages: [], answered: true })

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      `https://host.example/content/${pool}/`,
      `https://host.example/content/${pool}/${poolEntryName(0)}`,   // a door with no directory branch still gets its probe
      `https://host.example/${pool}/`,                              // and the final answer ends the walk
    ])
  })

  it("reads the live relay's `pool not held` as the same final answer", async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const fetchMock = sayingNoPool({ [`https://host.example/content/${pool}/`]: 'pool not held' })
    vi.stubGlobal('fetch', fetchMock)

    expect(await headPackage('host.example')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks nothing more this session, whichever way the zone said it', async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const final = sayingNoPool({ [`https://final.example/${pool}/`]: 'no pool at this address\n' })
    vi.stubGlobal('fetch', final)
    await headPackage('final.example')
    final.mockClear()
    expect(await headPackage('final.example')).toBeNull()
    expect(await listHostPackages('final.example')).toEqual([])
    expect(final).not.toHaveBeenCalled()

    const silent = serving({})   // every base an honest 404, none of them final
    vi.stubGlobal('fetch', silent)
    await headPackage('silent.example')
    silent.mockClear()
    expect(await askHostPackages('silent.example')).toEqual({ packages: [], answered: true })
    expect(silent).not.toHaveBeenCalled()
  })

  it('asks the base that said so first next session — one request', async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const fetchMock = sayingNoPool({ [`https://host.example/${pool}/`]: 'no pool at this address\n' })
    vi.stubGlobal('fetch', fetchMock)
    await headPackage('host.example')
    const stored = localStorage.getItem('hc:host-base:host.example')
    expect(stored).toBe('https://host.example')

    _resetSettledBases()   // a reload: the session forgets, the stored memo stays
    localStorage.setItem('hc:host-base:host.example', stored!)
    fetchMock.mockClear()

    expect(await headPackage('host.example')).toBeNull()
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([`https://host.example/${pool}/`])
  })

  it('a zone that did not answer is asked again — that is the network, not the host', async () => {
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', down)
    await headPackage('host.example')

    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [SIG_A])))
    expect((await headPackage('host.example'))?.packageSig).toBe(SIG_A)
  })
})
