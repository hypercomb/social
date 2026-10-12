// package-floor.spec.ts — when the shell moves a package that cannot move itself.

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { EffectBus } from '@hypercomb/core'
import { acquire, headPackage } from '@hypercomb/runtime/acquire'
import { _resetSettledBases } from '@hypercomb/runtime/host-packages'
import { checkPackageFloor, FLOOR_RECORD_KEY, perTabMembership, planFloor, scanMembership, UPDATE_DOOR } from './package-floor'

// The move itself needs a browser store; the decision cases need nothing.
vi.mock('@hypercomb/runtime/acquire', () => ({ acquire: vi.fn(), headPackage: vi.fn() }))
vi.mock('@hypercomb/runtime/host-zones', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DEFAULT_HOST_ZONES: ['hypercomb.com'],
  listHostZones: vi.fn(async () => []),
}))
vi.mock('./resolve-import-map', () => ({ cacheImportMap: vi.fn() }))

const OLD = 'a'.repeat(64)
const HEAD = { packageSig: 'b'.repeat(64), zone: 'hypercomb.com' }

describe('planFloor', () => {
  it('moves a package that answers no update door to the seed head', () => {
    expect(planFloor({ installed: OLD, doorAnswered: false, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'hypercomb.com' })
  })

  it('never touches a package that answers the door and keeps membership per tab — updating it stays a choice', () => {
    expect(planFloor({ installed: OLD, doorAnswered: true, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: true, head: HEAD, reloadedFor: null }).act).toBe(false)
    // A package whose bytes cannot say (or that has no swarm) is not moved for it.
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: null, head: HEAD, reloadedFor: null }).act).toBe(false)
  })

  it('moves a package that answers the door but keeps swarm membership in the flag every tab shares', () => {
    // The Sep 30 package answers `packages:open`, so the door alone left it
    // running — and a second tab's boot silenced its joined tab mid-meeting.
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: false, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'hypercomb.com' })
    expect(planFloor({ installed: OLD, doorAnswered: null, perTabMembership: false, head: HEAD, reloadedFor: null }).act).toBe(true)
    expect(planFloor({ installed: HEAD.packageSig, doorAnswered: true, perTabMembership: false, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: false, head: HEAD, reloadedFor: HEAD.packageSig }).act).toBe(false)
  })

  it('stands aside when it cannot tell, when nothing is installed, or when there is nowhere to go', () => {
    expect(planFloor({ installed: OLD, doorAnswered: null, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: null, doorAnswered: false, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: false, head: null, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: HEAD.packageSig, doorAnswered: false, head: HEAD, reloadedFor: null }).act).toBe(false)
  })

  it('moves an install known only by the old stamp even when something answers the door', () => {
    // An interrupted move leaves the head's dependencies in the pool; an install
    // that old has no bag, so they load, and their Packages window answers a door
    // the package itself never had.
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'hypercomb.com' })
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: null, head: HEAD, reloadedFor: null }).act).toBe(true)
    expect(planFloor({ installed: HEAD.packageSig, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, legacyRecord: true, doorAnswered: true, head: HEAD, reloadedFor: HEAD.packageSig }).act).toBe(false)
  })

  it('moves once per session: a reload that did not stick is not retried', () => {
    expect(planFloor({ installed: OLD, doorAnswered: false, head: HEAD, reloadedFor: HEAD.packageSig }).act).toBe(false)
    // ONE move per session, whatever the target: with two heads (the signed
    // root and the pool head) a guard keyed to the last target alternated
    // between them on every boot.
    expect(planFloor({ installed: OLD, doorAnswered: false, head: HEAD, reloadedFor: 'f'.repeat(64) }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: false, head: HEAD, reloadedFor: 'f'.repeat(64) }).act).toBe(false)
  })
})

describe('the door question', () => {
  it('is answered by whoever listens for what the pill emits', () => {
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(false)
    const off = EffectBus.on(UPDATE_DOOR, () => {})
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(true)
    off()
    expect(EffectBus.listens(UPDATE_DOOR)).toBe(false)
  })
})

describe('scanMembership — what the package\'s own bytes say', () => {
  const texts = (map: Record<string, string | null>) => vi.fn(async (sig: string) => map[sig] ?? null)

  it('says per-tab as soon as a module reads the per-tab key, reading no further', async () => {
    const read = texts({ d1: "const K='hc:mesh-session'", d2: 'x', b1: "localStorage.getItem('hc:mesh-public')" })
    expect(await scanMembership(['d1', 'd2', 'b1'], read)).toBe('tab')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('says origin-wide when modules read only the flag every tab shares', async () => {
    expect(await scanMembership(['d1', 'b1'], texts({ d1: 'export const a=1', b1: "getItem('hc:mesh-public')" }))).toBe('origin')
  })

  it('says none for a package with no swarm in it', async () => {
    expect(await scanMembership(['d1'], texts({ d1: 'export const a=1' }))).toBe('none')
  })

  it('cannot say when a module is missing and no per-tab reader was found', async () => {
    expect(await scanMembership(['d1', 'gone'], texts({ d1: "getItem('hc:mesh-public')" }))).toBeNull()
  })
})

// ── the move, end to end ─────────────────────────────────────────────────────

const PUBLISHER_KEY = generateSecretKey()
const PUBLISHER = getPublicKey(PUBLISHER_KEY)
const SIGNED_ROOT = 'c'.repeat(64)
const INDEXES = createHash('sha256').update('hive:indexes', 'utf8').digest('hex')
const DEP = 'd'.repeat(64)
const BEE = 'e'.repeat(64)

/** A pool directory as OPFS hands it back: `<sig>.js` files. */
const dir = (files: Record<string, string>): FileSystemDirectoryHandle => ({
  getFileHandle: async (name: string) => {
    if (!(name in files)) throw new DOMException('not found', 'NotFoundError')
    return { getFile: async () => ({ text: async () => files[name]! }) }
  },
} as unknown as FileSystemDirectoryHandle)

/** Install a package whose one bee reads `beeText`. A package's bytes are
 *  fixed by its signature (the verdict is kept per signature for the page's
 *  life), so a package with other bytes gets another signature. */
const installOld = (beeText: string, sig = OLD): void => {
  localStorage.setItem('hc:shim:installed-package', sig)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 2, layers: [sig], bees: [BEE], dependencies: [DEP] }))
  vi.stubGlobal('ioc', { get: (key: string) => key === '@hypercomb.social/Store'
    ? { dependencies: dir({ [`${DEP}.js`]: 'export const nostr = 1' }), bees: dir({ [`${BEE}.js`]: beeText }) }
    : undefined })
}

describe('checkPackageFloor — a package from before per-tab membership is moved forward', () => {
  const reload = vi.fn()
  let offDoor: () => void = () => {}

  beforeEach(() => {
    vi.unstubAllGlobals()
    _resetSettledBases()
    localStorage.clear()
    sessionStorage.clear()
    reload.mockReset()
    vi.mocked(acquire).mockReset()
    vi.mocked(headPackage).mockReset().mockImplementation(async zone => ({
      zone, base: `https://${zone}/content`, packageSig: HEAD.packageSig, label: 'essentials', at: '', generation: null, layers: [], bees: [], dependencies: [],
    }))
    vi.stubGlobal('location', { hostname: 'hypercomb.io', host: 'hypercomb.io', origin: 'https://hypercomb.io', reload })
    // A hidden page is never mid-gesture: the move does not wait for quiet.
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    localStorage.setItem('hc:install-follow', JSON.stringify({ pubkey: PUBLISHER, hosts: ['hypercomb.com'], channel: 'essentials' }))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url) === `https://content.hypercomb.com/${INDEXES}/${PUBLISHER}`
      ? { ok: true, status: 200, text: async () => JSON.stringify(finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: JSON.stringify({ v: 1, roots: { 'install:essentials': SIGNED_ROOT } }) }, PUBLISHER_KEY)) } as unknown as Response
      : { ok: false, status: 404, text: async () => '' } as unknown as Response))
    // The old package answers the update door — the door alone left it running.
    offDoor = EffectBus.on(UPDATE_DOOR, () => {})
  })

  afterEach(() => { offDoor(); vi.restoreAllMocks() })

  it('takes the signed root, and the seed pool head when the root is not on the seed yet', async () => {
    installOld("if (localStorage.getItem('hc:mesh-public') !== 'true') return")
    vi.mocked(acquire).mockImplementation(async sig => sig === SIGNED_ROOT
      ? { ok: false, packageSig: sig, fetched: 0, present: 0, holes: [], refused: [], error: 'no carried domain publishes it' }
      : { ok: true, packageSig: sig, fetched: 1, present: 0, holes: [], refused: [] })

    const plan = await checkPackageFloor()

    expect(vi.mocked(acquire).mock.calls.map(call => [call[0], call[1], call[2]])).toEqual([
      [SIGNED_ROOT, ['hypercomb.com'], { floor: true }],
      [HEAD.packageSig, ['hypercomb.com'], { floor: true }],
    ])
    expect(plan).toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'hypercomb.com' })
    expect(JSON.parse(localStorage.getItem(FLOOR_RECORD_KEY)!)).toMatchObject({ from: OLD, to: HEAD.packageSig })
    // The membership verdict is derived from the package sig — never a browser key.
    expect(Object.keys(localStorage).filter(key => key.includes('membership'))).toEqual([])
    expect(sessionStorage.getItem('hc:install:floor-reloaded')).toBe(HEAD.packageSig)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('leaves a package that keeps membership per tab alone — and asks no host', async () => {
    const current = '9'.repeat(64)
    installOld("sessionStorage.getItem('hc:mesh-session') === 'true'", current)

    const plan = await checkPackageFloor()

    expect(plan.act).toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(await perTabMembership(current)).toBe(true)
  })
})
