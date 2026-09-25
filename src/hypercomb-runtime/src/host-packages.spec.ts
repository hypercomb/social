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

/** The page a door answers with where it has no directory branch. */
const PAGE = '<!doctype html><html></html>'

/** A host whose relay predates the directory branch: entries, and its page
 *  where the listing would be. */
const poolWithoutListing = async (base: string, sigs: string[]): Promise<Served> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  return {
    [`${base}/${pool}/`]: PAGE,
    ...Object.fromEntries(sigs.map((sig, i) => [`${base}/${pool}/${poolEntryName(i)}`, sig])),
  }
}

/** A door that publishes nothing, as the relay and the edge worker answer it:
 *  an EMPTY listing — 200, so no follower's console prints a 404. */
const emptyPoolAt = async (base: string): Promise<Served> =>
  ({ [`${base}/${await registerPoolMeaning(HOST_PACKAGES_MEANING)}/`]: '' })

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
      [`https://host.example/${pool}/`]: poolEntryName(0),
      [`https://host.example/${pool}/${poolEntryName(0)}`]: 'see https://example.com/setup',
    }))

    expect(await headPackage('host.example')).toBeNull()
  })

  it('treats an SPA fallback page as no pool', async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    vi.stubGlobal('fetch', serving({
      [`https://host.example/${pool}/`]: PAGE,
      [`https://host.example/${pool}/${poolEntryName(0)}`]: PAGE,
    }))

    expect(await headPackage('host.example')).toBeNull()
  })

  it('never probes entry by entry — a door that cannot list is not a pool', async () => {
    const fetchMock = serving(await poolWithoutListing('https://host.example', [SIG_B, SIG_A]))
    vi.stubGlobal('fetch', fetchMock)

    expect(await headPackage('host.example')).toBeNull()
    const asked = fetchMock.mock.calls.map(call => String(call[0]))
    expect(asked.some(url => url.endsWith(poolEntryName(0)))).toBe(false)
  })

  it('asks the base that answered first on the next probe, sparing the dead bases', async () => {
    const fetchMock = serving(await poolAt('https://root.example/content', [SIG_A]))
    vi.stubGlobal('fetch', fetchMock)

    expect((await headPackage('root.example'))?.base).toBe('https://root.example/content')
    fetchMock.mockClear()
    expect((await headPackage('root.example'))?.packageSig).toBe(SIG_A)

    const asked = fetchMock.mock.calls.map(call => String(call[0]))
    expect(asked.some(url => url.startsWith('https://root.example/') && !url.startsWith('https://root.example/content/'))).toBe(false)
  })

  it('once the pool has settled a base, atoms are fetched from that base alone', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://root.example/content', [SIG_A])))
    expect(hostBases('root.example')).toHaveLength(2)

    await headPackage('root.example')
    expect(hostBases('root.example')).toEqual(['https://root.example/content'])
  })

  it('remembers the settled base across sessions, and forgets one that no longer fits the zone', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://root.example/content', [SIG_A])))
    await headPackage('root.example')
    expect(localStorage.getItem('hc:host-base:root.example')).toBe('https://root.example/content')

    localStorage.setItem('hc:host-base:other.example', 'https://elsewhere.example')
    expect(hostBases('other.example')).toHaveLength(2)
  })

  it('answers null for a domain that publishes nothing at all', async () => {
    vi.stubGlobal('fetch', serving({}))
    expect(await headPackage('host.example')).toBeNull()
  })
})

describe('a zone that publishes nothing — asked quietly', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  const asked = (fetchMock: ReturnType<typeof vi.fn>): string[] => fetchMock.mock.calls.map(call => String(call[0]))

  it('an empty listing is the whole answer — one request, and a 200', async () => {
    const fetchMock = serving(await emptyPoolAt('https://site.example'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await askHostPackages('site.example')).toEqual({ packages: [], answered: true })
    expect(asked(fetchMock)).toHaveLength(1)
  })

  it('a 404 from a door not yet redeployed asks the zone\'s own bases and nothing else', async () => {
    const fetchMock = serving({})
    vi.stubGlobal('fetch', fetchMock)

    expect(await headPackage('site.example')).toBeNull()

    // One listing per own base: no `00000000`, no content.<zone>.
    expect(asked(fetchMock)).toEqual([
      expect.stringMatching(/^https:\/\/site\.example\/[0-9a-f]{64}\/$/),
      expect.stringMatching(/^https:\/\/site\.example\/content\/[0-9a-f]{64}\/$/),
    ])
  })

  it('content.<zone> is asked only when the zone\'s own name does not answer', async () => {
    const pool = await poolAt('https://content.apexless.example', [SIG_A])
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('https://apexless.example')) throw new TypeError('Failed to fetch')
      return serving(pool)(url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const head = await headPackage('apexless.example')
    expect(head?.packageSig).toBe(SIG_A)
    expect(head?.base).toBe('https://content.apexless.example')
    expect(hostBases('apexless.example')).toEqual(['https://content.apexless.example'])
  })

  it('remembers the absence, so Update all asking again makes no request at all', async () => {
    const fetchMock = serving({})
    vi.stubGlobal('fetch', fetchMock)

    await listHostPackages('site.example')
    fetchMock.mockClear()
    expect(await headPackage('site.example')).toBeNull()
    expect(await askHostPackages('site.example')).toEqual({ packages: [], answered: true })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks again once the memo has run out', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = serving({})
      vi.stubGlobal('fetch', fetchMock)
      await headPackage('site.example')
      fetchMock.mockClear()

      vi.advanceTimersByTime(16 * 60_000)
      await headPackage('site.example')
      expect(fetchMock).toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('callers asking at once share one probe', async () => {
    const fetchMock = serving({})
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([headPackage('site.example'), listHostPackages('site.example'), askHostPackages('site.example')])

    expect(asked(fetchMock)).toHaveLength(2)
  })

  it('a zone that did not answer is not remembered as empty', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetchMock)
    await headPackage('down.example')

    vi.stubGlobal('fetch', serving(await poolAt('https://down.example', [SIG_A])))
    expect((await headPackage('down.example'))?.packageSig).toBe(SIG_A)
  })
})

describe("a host deployed before the empty listing — its final 404", () => {
  beforeEach(() => vi.unstubAllGlobals())

  /** A fetch that answers `said` with a 404 carrying that body — how a host
   *  that speaks the directory branch said the address holds nothing — and
   *  404s everything else with a body that says nothing about a pool. */
  const sayingNoPool = (said: Record<string, string>): ReturnType<typeof vi.fn> =>
    vi.fn(async (url: string) => ({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => said[String(url)] ?? 'Not Found',
    }) as unknown as Response)

  it("stops at the worker's `no pool at this address`: one request", async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const fetchMock = sayingNoPool({ [`https://host.example/${pool}/`]: 'no pool at this address\n' })
    vi.stubGlobal('fetch', fetchMock)

    expect(await askHostPackages('host.example')).toEqual({ packages: [], answered: true })
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([`https://host.example/${pool}/`])
  })

  it("reads the live relay's `pool not held` as the same final answer", async () => {
    const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
    const fetchMock = sayingNoPool({ [`https://host.example/content/${pool}/`]: 'pool not held' })
    vi.stubGlobal('fetch', fetchMock)

    expect(await headPackage('host.example')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)   // the flat base's plain 404, then the final one
  })

  it('asks the base that said so first once the memo has run out — one request', async () => {
    vi.useFakeTimers()
    try {
      const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
      const fetchMock = sayingNoPool({ [`https://host.example/content/${pool}/`]: 'pool not held' })
      vi.stubGlobal('fetch', fetchMock)
      await headPackage('host.example')
      expect(localStorage.getItem('hc:host-base:host.example')).toBe('https://host.example/content')

      vi.advanceTimersByTime(16 * 60_000)
      fetchMock.mockClear()
      expect(await headPackage('host.example')).toBeNull()
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([`https://host.example/content/${pool}/`])
    } finally { vi.useRealTimers() }
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
  it('asks the zone\'s own name, flat before /content, http only for loopback — never content.<zone>', () => {
    expect(hostBases('unsettled.example')).toEqual([
      'https://unsettled.example',
      'https://unsettled.example/content',
    ])
    expect(hostBases('localhost:4270')[0]).toBe('http://localhost:4270')
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
