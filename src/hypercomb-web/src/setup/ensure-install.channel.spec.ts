// ensure-install.channel.spec.ts — a FIRST install follows the signed channel.
//
// 2026-09-30 → 2026-10-09: hypercomb.com's packages pool held one Sep 30
// member while the publisher's signed `install:essentials` named a newer
// package, and installFromHosts took "the newest member of the default host's
// pool" — so every fresh install ran a build that dropped meeting links and
// went silent when a second tab booted. These cases pin the replacement: the
// signed root first (verified with real schnorr signatures), the pool head
// only when the index cannot be read or the root cannot be had yet, and
// nothing at all when the index was forged.

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { acquire, headPackage } from '@hypercomb/runtime/acquire'
import { _resetSettledBases } from '@hypercomb/runtime/host-packages'
import SHIPPED_PUBLISHER from './install-publisher.json'
import { installFromHosts } from './ensure-install'

vi.mock('@hypercomb/core', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The address is DERIVED from the meaning — the same derivation, not a hex
  // written down.
  registerPoolMeaning: async (meaning: string) => createHash('sha256').update(meaning, 'utf8').digest('hex'),
}))
vi.mock('@hypercomb/shared/core', () => ({ Store: class Store {} }))
vi.mock('@hypercomb/runtime/store', () => ({ Store: class Store {} }))
vi.mock('./resolve-import-map', () => ({ cacheImportMap: vi.fn(async () => undefined) }))
vi.mock('@hypercomb/runtime/host-zones', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // A cold client carries nothing: the seed is the only zone.
  listHostZones: vi.fn(async () => []),
}))
vi.mock('@hypercomb/runtime/acquire', () => ({
  acquire: vi.fn(),
  applySelection: vi.fn(),
  deriveInventory: vi.fn(),
  headPackage: vi.fn(),
  listHostPackages: vi.fn(),
  packedFetch: vi.fn(),
  reportDivergence: vi.fn(),
}))

const PUBLISHER_KEY = generateSecretKey()
const PUBLISHER = getPublicKey(PUBLISHER_KEY)
const SIGNED_ROOT = 'a'.repeat(64)
const POOL_HEAD = 'b'.repeat(64)
const INDEXES = createHash('sha256').update('hive:indexes', 'utf8').digest('hex')

const signedIndex = (key: Uint8Array, roots: Record<string, string>): string =>
  JSON.stringify(finalizeEvent({ kind: 30564, created_at: 1_791_578_080, tags: [], content: JSON.stringify({ v: 1, roots }) }, key))

/** Only the routes given answer; hypercomb.com's apex answers every other
 *  path with its page, as the live static host does. */
const serving = (routes: Record<string, string>) =>
  vi.fn(async (url: string) => {
    const body = routes[String(url)]
    if (body !== undefined) return { ok: true, status: 200, text: async () => body } as unknown as Response
    if (String(url).startsWith('https://hypercomb.com/')) return { ok: true, status: 200, text: async () => '<!doctype html><html></html>' } as unknown as Response
    return { ok: false, status: 404, text: async () => 'not found' } as unknown as Response
  })

const ok = (packageSig: string) => ({ ok: true, packageSig, fetched: 1, present: 0, holes: [], refused: [] })
const missing = (packageSig: string) => ({ ok: false, packageSig, fetched: 0, present: 0, holes: [], refused: [], error: `no carried domain publishes ${packageSig.slice(0, 12)}…` })

const reload = vi.fn()
const acquired = (): string[] => vi.mocked(acquire).mock.calls.map(call => String(call[0]))

beforeEach(() => {
  vi.unstubAllGlobals()
  _resetSettledBases()
  localStorage.clear()
  reload.mockReset()
  vi.mocked(acquire).mockReset()
  vi.mocked(headPackage).mockReset().mockImplementation(async zone => zone === 'hypercomb.com'
    ? { zone, base: 'https://hypercomb.com/content', packageSig: POOL_HEAD, label: 'essentials', at: '', generation: null, layers: [], bees: [], dependencies: [] }
    : null)
  vi.stubGlobal('location', { hostname: 'hypercomb.io', host: 'hypercomb.io', origin: 'https://hypercomb.io', reload })
  // The participant's own follow record — the only way a test can hold the
  // secret of the key it follows. The shipped publisher is pinned below.
  localStorage.setItem('hc:install-follow', JSON.stringify({ pubkey: PUBLISHER, hosts: ['hypercomb.com'], channel: 'essentials' }))
})

describe('installFromHosts — a first install follows the signed install channel', () => {
  it('takes the root the publisher signed, not the newest member of the seed pool', async () => {
    vi.stubGlobal('fetch', serving({
      [`https://content.hypercomb.com/${INDEXES}/${PUBLISHER}`]: signedIndex(PUBLISHER_KEY, { 'install:essentials': SIGNED_ROOT }),
    }))
    vi.mocked(acquire).mockImplementation(async sig => ok(sig))

    expect(await installFromHosts()).toBe(true)

    expect(acquired()).toEqual([SIGNED_ROOT])
    expect(vi.mocked(acquire).mock.calls[0]![1]).toEqual(['hypercomb.com'])
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back to the pool head when the signed root cannot be had from the seed yet', async () => {
    // A publish advances the index at once; the seed host is restaged by hand.
    vi.stubGlobal('fetch', serving({
      [`https://content.hypercomb.com/${INDEXES}/${PUBLISHER}`]: signedIndex(PUBLISHER_KEY, { 'install:essentials': SIGNED_ROOT }),
    }))
    vi.mocked(acquire).mockImplementation(async sig => sig === SIGNED_ROOT ? missing(sig) : ok(sig))

    expect(await installFromHosts()).toBe(true)

    expect(acquired()).toEqual([SIGNED_ROOT, POOL_HEAD])
    expect(reload).toHaveBeenCalledOnce()
  })

  it('falls back to the pool head only when the index is unreachable', async () => {
    vi.stubGlobal('fetch', serving({}))
    vi.mocked(acquire).mockImplementation(async sig => ok(sig))

    expect(await installFromHosts()).toBe(true)

    expect(acquired()).toEqual([POOL_HEAD])
  })

  it('installs nothing when the index at the publisher\'s address was signed by someone else', async () => {
    vi.stubGlobal('fetch', serving({
      [`https://content.hypercomb.com/${INDEXES}/${PUBLISHER}`]: signedIndex(generateSecretKey(), { 'install:essentials': SIGNED_ROOT }),
    }))
    vi.mocked(acquire).mockImplementation(async sig => ok(sig))

    expect(await installFromHosts()).toBe(false)

    expect(acquire).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('follows the publisher the shell ships with when the participant recorded nothing', async () => {
    localStorage.removeItem('hc:install-follow')
    const fetchMock = serving({})
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(acquire).mockImplementation(async sig => ok(sig))

    await installFromHosts()

    const asked = fetchMock.mock.calls.map(call => String(call[0]))
    expect(asked).toContain(`https://hypercomb.com/${INDEXES}/${SHIPPED_PUBLISHER.pubkey}`)
    expect(asked).toContain(`https://content.hypercomb.com/${INDEXES}/${SHIPPED_PUBLISHER.pubkey}`)
  })

  it('a sandbox door runs the package its own pool names and reads no channel', async () => {
    vi.stubGlobal('location', { hostname: 'try-change.hypercomb.com', host: 'try-change.hypercomb.com', origin: 'https://try-change.hypercomb.com', reload })
    vi.mocked(headPackage).mockImplementation(async zone => ({ zone, base: `https://${zone}`, packageSig: POOL_HEAD, label: '', at: '', generation: null, layers: [], bees: [], dependencies: [] }))
    const fetchMock = serving({})
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(acquire).mockImplementation(async sig => ok(sig))

    expect(await installFromHosts()).toBe(true)

    expect(acquired()).toEqual([POOL_HEAD])
    expect(vi.mocked(acquire).mock.calls[0]![1]).toEqual(['try-change.hypercomb.com'])
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes(INDEXES))).toBe(false)
  })
})
