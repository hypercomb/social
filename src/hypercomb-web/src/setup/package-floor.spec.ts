// package-floor.spec.ts — when the shell moves a package that cannot move itself.

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { EffectBus } from '@hypercomb/core'
import { acquire, headPackage, layersIoFor } from '@hypercomb/runtime/acquire'
import { _resetSettledBases } from '@hypercomb/runtime/host-packages'
import { PICKS_KEY } from '@hypercomb/runtime/package-tree'
import type { ReplicationIo } from '@hypercomb/runtime/replication-walker'
import {
  checkPackageFloor, FLOOR_RECORD_KEY, MEETING_POINT, packageBytes, perTabMembership, planFloor,
  NO_DEFAULT_HOST_MARK, refuseOldMeetingPoint, scanMeetingPoint, scanMembership, UPDATE_DOOR,
} from './package-floor'

// The move itself needs a browser store; the decision cases need nothing.
vi.mock('@hypercomb/runtime/acquire', () => ({ acquire: vi.fn(), headPackage: vi.fn(), layersIoFor: vi.fn() }))
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
    // The meeting point alone puts it below the floor — and the guard is what stops it.
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: true, currentMeetingPoint: false, head: HEAD, reloadedFor: 'f'.repeat(64) }))
      .toEqual({ act: false, why: expect.stringMatching(/already moved once/) })
  })

  it('moves a package that still dials the home machine — it meets no updated device', () => {
    // 2026-10-11: a phone on the new package and a desktop on the old one, same
    // room and secret, never met. The old one answers the door and keeps
    // membership per tab, so nothing else would move it.
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: true, currentMeetingPoint: false, head: HEAD, reloadedFor: null }))
      .toEqual({ act: true, from: OLD, to: HEAD.packageSig, zone: 'hypercomb.com' })
    expect(planFloor({ installed: OLD, doorAnswered: null, currentMeetingPoint: false, head: HEAD, reloadedFor: null }).act).toBe(true)
    expect(planFloor({ installed: HEAD.packageSig, doorAnswered: true, currentMeetingPoint: false, head: HEAD, reloadedFor: null }).act).toBe(false)
  })

  it('never moves a package for its meeting point when it dials the shipped one, has no mesh, or cannot say', () => {
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: true, currentMeetingPoint: true, head: HEAD, reloadedFor: null }).act).toBe(false)
    expect(planFloor({ installed: OLD, doorAnswered: true, perTabMembership: null, currentMeetingPoint: null, head: HEAD, reloadedFor: null }).act).toBe(false)
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

// What a mesh bee's bytes look like, before and after 2026-10-11 (esbuild keeps
// LIVE_RELAY alive through the globalThis anchor).
const meshBytes = (relay: string): string =>
  `var LIVE_RELAY = "${relay}";\nglobalThis["__HYPERCOMB_RELAYS__"] = Object.freeze({ local: "ws://localhost:7777", live: LIVE_RELAY });`
const HOME_MESH = meshBytes('wss://jwize.com')
// A mesh from before the no-default-host release: it met at hypercomb.com,
// but its rooms have other addresses — below the floor since 2026-10-12.
const OPEN_DEFAULT_MESH = meshBytes(MEETING_POINT)
// The current mesh carries the no-default-host mark.
const SHIPPED_MESH = `${OPEN_DEFAULT_MESH}\nglobalThis["__HYPERCOMB_RELAYS__"] = Object.freeze({ mark: "${NO_DEFAULT_HOST_MARK}" });`

describe('scanMeetingPoint — which meeting the package\'s own bytes dial', () => {
  const texts = (map: Record<string, string | null>) => vi.fn(async (sig: string) => map[sig] ?? null)

  it('says old for a mesh that never names the shipped meeting point', async () => {
    expect(await scanMeetingPoint(['d1', 'b1'], texts({ d1: 'export const a=1', b1: HOME_MESH }))).toBe('old')
  })

  it('says current as soon as a module names it, reading no further', async () => {
    const read = texts({ d1: 'export const a=1', b1: SHIPPED_MESH, b2: 'x' })
    expect(await scanMeetingPoint(['d1', 'b1', 'b2'], read)).toBe('current')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('says current for a package that names both — the home machine may stay a chosen relay or a self domain', async () => {
    expect(await scanMeetingPoint(['b1', 'b2'], texts({ b1: HOME_MESH, b2: `const SELF = "wss://jwize.com"; const MARK = "${NO_DEFAULT_HOST_MARK}"` }))).toBe('current')
    expect(await scanMeetingPoint(['b1'], texts({ b1: `${SHIPPED_MESH}\nconst example = 'wss://jwize.com'` }))).toBe('current')
  })

  it('says current for a mesh that carries the no-default-host mark and names no host at all — hypercomb.com may be retired', async () => {
    const markOnly = `globalThis["__HYPERCOMB_RELAYS__"] = Object.freeze({ local: "", live: "", mark: "${NO_DEFAULT_HOST_MARK}" });`
    expect(await scanMeetingPoint(['b1'], texts({ b1: markOnly }))).toBe('current')
  })

  it('says old for a mesh from before the no-default-host release, even one that met at hypercomb.com — its rooms have other addresses', async () => {
    expect(await scanMeetingPoint(['b1'], texts({ b1: OPEN_DEFAULT_MESH }))).toBe('old')
  })

  it('says none for a package with no mesh in it', async () => {
    expect(await scanMeetingPoint(['d1'], texts({ d1: "localStorage.getItem('hc:mesh-public')" }))).toBe('none')
  })

  it('cannot say when a module is missing and none named the shipped meeting point', async () => {
    expect(await scanMeetingPoint(['b1', 'gone'], texts({ b1: HOME_MESH }))).toBeNull()
  })

  it('refuses a target whose bytes still dial the home machine, and only that', async () => {
    const bytesOf = (text: string) => async () => new TextEncoder().encode(text)
    expect(await refuseOldMeetingPoint(['b1'], bytesOf(HOME_MESH))).toMatch(/home machine/)
    expect(await refuseOldMeetingPoint(['b1'], bytesOf(SHIPPED_MESH))).toBeNull()
    expect(await refuseOldMeetingPoint(['b1'], bytesOf('export const a=1'))).toBeNull()
    expect(await refuseOldMeetingPoint(['b1'], async () => null)).toBeNull()
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

/** Make `bees` (sig → text) the live selection over trunk `sig`. A package's
 *  bytes are fixed by its signature (the verdict is kept per signature for the
 *  page's life), so a package with other bytes gets another signature. */
const installSelection = (sig: string, bees: Record<string, string>): void => {
  localStorage.setItem('hc:shim:installed-package', sig)
  localStorage.setItem('core-adapter.installed-manifest', JSON.stringify({ version: 2, layers: [sig], bees: Object.keys(bees), dependencies: [DEP] }))
  vi.stubGlobal('ioc', { get: (key: string) => key === '@hypercomb.social/Store'
    ? { dependencies: dir({ [`${DEP}.js`]: 'export const nostr = 1' }), bees: dir(Object.fromEntries(Object.entries(bees).map(([bee, text]) => [`${bee}.js`, text]))) }
    : undefined })
}

/** Install a package whose one bee reads `beeText`. */
const installOld = (beeText: string, sig = OLD): void => installSelection(sig, { [BEE]: beeText })

const MESH_BEE = '7'.repeat(64)
const JOURNAL_BEE = '8'.repeat(64)
const PICKED_BEE = '6'.repeat(64)

/** Hold a trunk's layers — a `sharing` layer naming MESH_BEE and a `journal`
 *  layer naming JOURNAL_BEE — and return its signature. The bees' bytes do
 *  not enter it, so `tag` keeps one trunk per case. */
const holdTrunk = (tag: string): string => {
  const layers = new Map<string, Uint8Array<ArrayBuffer>>()
  const hold = (record: object): string => {
    const bytes = new TextEncoder().encode(JSON.stringify(record)) as Uint8Array<ArrayBuffer>
    const sig = createHash('sha256').update(bytes).digest('hex')
    layers.set(sig, bytes)
    return sig
  }
  const sharing = hold({ name: 'sharing', cells: [], bees: [`${MESH_BEE}.js`], dependencies: [] })
  const journal = hold({ name: 'journal', cells: [], bees: [`${JOURNAL_BEE}.js`], dependencies: [] })
  const io: ReplicationIo = { read: async sig => layers.get(sig) ?? null, fetch: async () => null, write: async () => {} }
  vi.mocked(layersIoFor).mockResolvedValue(io)
  return hold({ name: tag, cells: [sharing, journal], bees: [], dependencies: [`${DEP}.js`] })
}

/** The participant took another root's layer at `path`. */
const pickAt = (path: string): void =>
  localStorage.setItem(PICKS_KEY, JSON.stringify({ [path]: { layer: '0'.repeat(64), root: 'f'.repeat(64), hides: false, at: 1 } }))

describe('checkPackageFloor — a package below the floor is moved forward', () => {
  const reload = vi.fn()
  let offDoor: () => void = () => {}

  beforeEach(() => {
    vi.unstubAllGlobals()
    _resetSettledBases()
    localStorage.clear()
    sessionStorage.clear()
    reload.mockReset()
    vi.mocked(acquire).mockReset()
    vi.mocked(layersIoFor).mockReset()
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

  // The meeting point (2026-10-11). Each package below keeps membership per
  // tab and answers the door: the home machine is the only thing wrong with it.
  const perTab = "\nsessionStorage.getItem('hc:mesh-session')"

  it('moves a package that still dials the home machine — never onto a target that still does', async () => {
    const home = '1'.repeat(64)
    installOld(HOME_MESH + perTab, home)
    // The signed root still dials the home machine (a channel not stamped since
    // the move); the pool head dials the shipped point. acquire asks `refuse`
    // over each target's held bytes before anything runs.
    vi.mocked(acquire).mockImplementation(async (sig, _zones, opts) => {
      const target = sig === SIGNED_ROOT ? HOME_MESH : SHIPPED_MESH
      const refusal = await opts?.refuse?.([BEE], async () => new TextEncoder().encode(target + perTab))
      return refusal
        ? { ok: false, packageSig: sig, fetched: 0, present: 0, holes: [], refused: [], error: refusal }
        : { ok: true, packageSig: sig, fetched: 1, present: 0, holes: [], refused: [] }
    })

    const plan = await checkPackageFloor()

    expect(await packageBytes(home)).toEqual({ perTabMembership: true, currentMeetingPoint: false })
    expect(vi.mocked(acquire).mock.calls.map(call => call[0])).toEqual([SIGNED_ROOT, HEAD.packageSig])
    expect(vi.mocked(acquire).mock.calls.every(call => call[2]?.floor === true && call[2]?.refuse === refuseOldMeetingPoint)).toBe(true)
    expect(plan).toEqual({ act: true, from: home, to: HEAD.packageSig, zone: 'hypercomb.com' })
    expect(JSON.parse(localStorage.getItem(FLOOR_RECORD_KEY)!)).toMatchObject({ from: home, to: HEAD.packageSig })
    expect(sessionStorage.getItem('hc:install:floor-reloaded')).toBe(HEAD.packageSig)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('leaves a package that dials the shipped meeting point alone — and asks no host', async () => {
    installOld(SHIPPED_MESH + perTab, '2'.repeat(64))

    expect((await checkPackageFloor()).act).toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves a package that names both alone — the shipped point wins whatever else it names', async () => {
    installOld(`${HOME_MESH}\nconst SELF = "wss://jwize.com"; const MARK = "${NO_DEFAULT_HOST_MARK}"${perTab}`, '3'.repeat(64))

    expect((await checkPackageFloor()).act).toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves a package with no swarm in it alone', async () => {
    const plain = '4'.repeat(64)
    installOld('export const journal = 1', plain)

    expect((await checkPackageFloor()).act).toBe(false)
    expect(await packageBytes(plain)).toEqual({ perTabMembership: null, currentMeetingPoint: null })
    expect(acquire).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('still moves once per session: a move that did not stick is not retried for the meeting point', async () => {
    installOld(HOME_MESH + perTab, '5'.repeat(64))
    sessionStorage.setItem('hc:install:floor-reloaded', 'f'.repeat(64))

    const plan = await checkPackageFloor()

    // The rule fired (the heads were asked for) and the guard is what stopped it.
    expect(plan).toEqual({ act: false, why: expect.stringMatching(/already moved once/) })
    expect(fetch).toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('hc:install:floor-reloaded')).toBe('f'.repeat(64))
  })

  // Picks ride across a move (acquire installPackage), so only the trunk's own
  // modules can put a package below the floor.
  it('leaves a picked old mesh over a current trunk alone — a move would carry it across, at every boot', async () => {
    const trunk = holdTrunk('current trunk')
    pickAt('sharing')
    // The pick replaced the trunk's mesh: what runs is the picked one.
    installSelection(trunk, { [PICKED_BEE]: HOME_MESH + perTab, [JOURNAL_BEE]: 'export const journal = 1' })

    expect(await packageBytes(trunk)).toEqual({ perTabMembership: true, currentMeetingPoint: null })
    expect((await checkPackageFloor()).act).toBe(false)
    expect(acquire).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('still moves an old trunk that a pick elsewhere does not touch', async () => {
    const trunk = holdTrunk('old trunk')
    pickAt('journal')
    installSelection(trunk, { [MESH_BEE]: HOME_MESH + perTab, [PICKED_BEE]: 'export const journal = 2' })
    vi.mocked(acquire).mockImplementation(async sig => ({ ok: true, packageSig: sig, fetched: 1, present: 0, holes: [], refused: [] }))

    expect(await packageBytes(trunk)).toEqual({ perTabMembership: true, currentMeetingPoint: false })
    expect(await checkPackageFloor()).toEqual({ act: true, from: trunk, to: SIGNED_ROOT, zone: 'hypercomb.com' })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('says nothing for a picked selection whose trunk cannot be walked here', async () => {
    const trunk = holdTrunk('unwalkable')
    vi.mocked(layersIoFor).mockResolvedValue(null)
    pickAt('journal')
    installSelection(trunk, { [MESH_BEE]: HOME_MESH + perTab })

    expect(await packageBytes(trunk)).toEqual({ perTabMembership: true, currentMeetingPoint: null })
  })
})
