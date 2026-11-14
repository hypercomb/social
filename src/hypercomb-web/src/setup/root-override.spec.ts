// root-override.spec.ts — the shell's root screen: which roots may be taken, by which
// door, and that it stands before any package code loads. (jwize, 2026-11-13: "a place
// where we can do an override and set a new signature root so that we can host any os"
// · "before dynamic loads so that we have an injection point to save a corrupted or
// compromised build".)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acquire, applySelection, layersIoFor, rootHolder, trustedHere } from '@hypercomb/runtime/acquire'
import type { ChannelRead } from '@hypercomb/runtime/host-packages'
import { INSTALLED_KEY } from '@hypercomb/runtime/installed-package'
import { ROOT_ASK_KEY, askRootOverride, askedInAddress, planOverride, readsAsPackageRoot, takeRoot, type Vouch } from './root-override'

vi.mock('@hypercomb/runtime/acquire', () => ({
  acquire: vi.fn(), applySelection: vi.fn(), layersIoFor: vi.fn(), rootHolder: vi.fn(), trustedHere: vi.fn(),
}))
vi.mock('@hypercomb/runtime/host-zones', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listHostZones: vi.fn(async () => ['carried.example']),
}))
vi.mock('./resolve-import-map', () => ({ cacheImportMap: vi.fn() }))
vi.mock('./install-follow', () => ({
  shellDefaultFollow: () => ({ pubkey: 'f'.repeat(64), hosts: ['publisher.example'], channel: 'essentials' }),
  shellInstallFollow: () => ({ pubkey: 'f'.repeat(64), hosts: ['publisher.example'], channel: 'essentials' }),
  verifyIndexEvent: async () => true,
}))

const RUNNING = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const SIGNED = 'c'.repeat(64)
const base = { running: RUNNING, held: false, signed: null as string | null, forged: false, origin: false }
const vouch = (read: ChannelRead, kind: Vouch['kind'] = 'default', hosts: string[] = ['publisher.example']): Vouch =>
  ({ kind, read, hosts, pubkey: 'f'.repeat(64) })
const named: Vouch[] = [vouch({ state: 'named', packageSig: SIGNED, zone: 'publisher.example', createdAt: 1 })]
const unreachable: Vouch[] = [vouch({ state: 'unreachable' })]
const rootRecord = (record: unknown) => ({ read: async () => new TextEncoder().encode(JSON.stringify(record)) })

describe('planOverride', () => {
  it('takes a root that ran here before from what is held — the rollback', () => {
    expect(planOverride({ ...base, asked: OTHER, held: true })).toEqual({ take: true, by: 'held' })
    // Held wins over every other door: no host is asked for a rollback.
    expect(planOverride({ ...base, asked: OTHER, held: true, signed: OTHER, origin: true })).toEqual({ take: true, by: 'held' })
  })

  it('takes the root the followed publisher signed, and only that one, by the signed door', () => {
    expect(planOverride({ ...base, asked: SIGNED, signed: SIGNED })).toEqual({ take: true, by: 'signed' })
    expect(planOverride({ ...base, asked: OTHER, signed: SIGNED })).toEqual({ take: false, why: 'unvouched' })
  })

  it('takes a root this domain itself serves', () => {
    expect(planOverride({ ...base, asked: OTHER, origin: true })).toEqual({ take: true, by: 'origin' })
  })

  it('refuses what nothing vouches for, what already runs, and what is no signature', () => {
    expect(planOverride({ ...base, asked: OTHER })).toEqual({ take: false, why: 'unvouched' })
    expect(planOverride({ ...base, asked: RUNNING, held: true })).toEqual({ take: false, why: 'running' })
    for (const bad of ['', 'xyz', 'A'.repeat(63), `${OTHER}0`]) expect(planOverride({ ...base, asked: bad, held: true })).toEqual({ take: false, why: 'not-a-signature' })
    // Case and edges are folded, as a pasted signature needs.
    expect(planOverride({ ...base, asked: `  ${OTHER.toUpperCase()} `, held: true })).toEqual({ take: true, by: 'held' })
  })

  it('takes nothing on the word of a substituted index — a root that ran here is still a rollback', () => {
    expect(planOverride({ ...base, asked: SIGNED, signed: SIGNED, forged: true })).toEqual({ take: false, why: 'forged' })
    expect(planOverride({ ...base, asked: OTHER, origin: true, forged: true })).toEqual({ take: false, why: 'forged' })
    expect(planOverride({ ...base, asked: OTHER, held: true, forged: true })).toEqual({ take: true, by: 'held' })
  })
})

describe('what reads as a package root', () => {
  it('is a layer with packages under it and the bundles they import', () => {
    expect(readsAsPackageRoot({ name: 'essentials', cells: ['x'], dependencies: ['y.js'] })).toBe(true)
  })

  it('is never a branch of a package, a draft record, or anything else the store trusts', () => {
    expect(readsAsPackageRoot({ name: 'games', cells: ['x'] })).toBe(false)
    expect(readsAsPackageRoot({ name: 'leaf', bees: ['b.js'], dependencies: [] })).toBe(false)
    expect(readsAsPackageRoot({ draft: { of: RUNNING }, dependencies: ['y'], cells: ['x'] })).toBe(false)
    for (const bad of [null, undefined, 'x', 3, [], {}]) expect(readsAsPackageRoot(bad)).toBe(false)
  })
})

describe('what the address asks', () => {
  it('opens the screen, and fills the field only with a signature', () => {
    expect(askedInAddress('')).toBeNull()
    expect(askedInAddress('?hive=abc')).toBeNull()
    expect(askedInAddress('?root')).toBe('')
    expect(askedInAddress('?root=')).toBe('')
    expect(askedInAddress('?root=not-a-sig')).toBe('')
    expect(askedInAddress(`?x=1&root=${OTHER.toUpperCase()}`)).toBe(OTHER)
  })
})

describe('the take', () => {
  beforeEach(() => {
    vi.mocked(acquire).mockReset()
    vi.mocked(applySelection).mockReset()
    vi.mocked(layersIoFor).mockReset()
    vi.mocked(rootHolder).mockReset()
    vi.mocked(trustedHere).mockReset()
    localStorage.clear()
    localStorage.setItem(INSTALLED_KEY, RUNNING)
  })

  it('rolls back to a held root alone — no pick laid over it, and no host asked', async () => {
    vi.mocked(trustedHere).mockReturnValue(true)
    vi.mocked(layersIoFor).mockResolvedValue(rootRecord({ cells: ['x'], dependencies: ['y'] }) as never)
    vi.mocked(applySelection).mockResolvedValue({ ok: true })
    expect(await takeRoot(OTHER, unreachable)).toEqual({ ok: true, by: 'held' })
    expect(applySelection).toHaveBeenCalledWith(OTHER, [], {})
    expect(acquire).not.toHaveBeenCalled()
    expect(rootHolder).not.toHaveBeenCalled()
  })

  it('does not take a trusted signature that is only a branch or a draft record as the root', async () => {
    vi.mocked(trustedHere).mockReturnValue(true)
    vi.mocked(layersIoFor).mockResolvedValue(rootRecord({ name: 'games', cells: ['x'] }) as never)
    vi.mocked(rootHolder).mockResolvedValue(null)
    expect(await takeRoot(OTHER, unreachable)).toEqual({ ok: false, why: 'unvouched' })
    expect(applySelection).not.toHaveBeenCalled()
  })

  it('takes the signed root through the gate\'s override door, alone, from the publisher\'s hosts and the carried ones', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({ ok: true, packageSig: SIGNED, fetched: 3, present: 0, holes: [], refused: [] })
    expect(await takeRoot(SIGNED, named)).toEqual({ ok: true, by: 'signed' })
    expect(acquire).toHaveBeenCalledWith(SIGNED, ['publisher.example', 'carried.example'], { alone: true, override: true })
    // The signed root needs no question to the origin.
    expect(rootHolder).not.toHaveBeenCalled()
  })

  it('never passes the override door for a root no signed record names — this domain\'s own goes by the self door', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(rootHolder).mockResolvedValue({ zone: 'localhost:3000', base: '', packageSig: OTHER, label: '', at: '', generation: null, layers: [], bees: [], dependencies: [] })
    vi.mocked(acquire).mockResolvedValue({ ok: true, packageSig: OTHER, fetched: 1, present: 0, holes: [], refused: [] })
    expect(await takeRoot(OTHER, named)).toEqual({ ok: true, by: 'origin' })
    const [, zones, options] = vi.mocked(acquire).mock.calls[0]!
    expect(zones).toHaveLength(1)
    expect(options).toEqual({ alone: true })
  })

  it('refuses what nothing vouches for without fetching or changing anything', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(rootHolder).mockResolvedValue(null)
    expect(await takeRoot(OTHER, named)).toEqual({ ok: false, why: 'unvouched' })
    expect(await takeRoot('nope', named)).toEqual({ ok: false, why: 'not-a-signature' })
    expect(await takeRoot(RUNNING, named)).toEqual({ ok: false, why: 'running' })
    expect(acquire).not.toHaveBeenCalled()
    expect(applySelection).not.toHaveBeenCalled()
  })

  it('asks nobody when an index was substituted', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    expect(await takeRoot(OTHER, [vouch({ state: 'forged', door: 'bad.example' })])).toEqual({ ok: false, why: 'forged' })
    expect(rootHolder).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('still takes the default when another publisher\'s index was substituted', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({ ok: true, packageSig: SIGNED, fetched: 1, present: 0, holes: [], refused: [] })
    const both = [...named, vouch({ state: 'forged', door: 'bad.example' }, 'followed', ['mine.example'])]
    expect(await takeRoot(SIGNED, both)).toEqual({ ok: true, by: 'signed' })
    // And nothing else is taken on the substituted one's word.
    expect(await takeRoot(OTHER, both)).toEqual({ ok: false, why: 'forged' })
  })

  it('takes what a publisher you follow signed from that publisher\'s hosts, not the default\'s', async () => {
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({ ok: true, packageSig: OTHER, fetched: 1, present: 0, holes: [], refused: [] })
    const mine = vouch({ state: 'named', packageSig: OTHER, zone: 'mine.example', createdAt: 2 }, 'followed', ['mine.example'])
    expect(await takeRoot(OTHER, [...named, mine])).toEqual({ ok: true, by: 'signed' })
    expect(acquire).toHaveBeenCalledWith(OTHER, ['mine.example', 'carried.example'], { alone: true, override: true })
  })

  it('says why when the root could not be composed or had, and changes nothing', async () => {
    vi.mocked(trustedHere).mockReturnValue(true)
    vi.mocked(layersIoFor).mockResolvedValue(rootRecord({ cells: ['x'], dependencies: ['y'] }) as never)
    vi.mocked(applySelection).mockResolvedValue({ ok: false, error: 'aaaa… is not held here' })
    expect(await takeRoot(OTHER, unreachable)).toEqual({ ok: false, why: 'failed', detail: 'aaaa… is not held here' })
    vi.mocked(trustedHere).mockReturnValue(false)
    vi.mocked(acquire).mockResolvedValue({ ok: false, packageSig: SIGNED, fetched: 0, present: 0, holes: ['h1', 'h2'], refused: [] })
    expect(await takeRoot(SIGNED, named)).toEqual({ ok: false, why: 'failed', detail: '2 file(s) could not be had' })
  })
})

describe('the console door', () => {
  it('only leaves a note for the next boot — it takes nothing', () => {
    vi.useFakeTimers()
    sessionStorage.clear()
    vi.mocked(acquire).mockReset()
    expect(askRootOverride()).toMatch(/root screen/)
    expect(sessionStorage.getItem(ROOT_ASK_KEY)).toBe('1')
    askRootOverride(OTHER.toUpperCase())
    expect(sessionStorage.getItem(ROOT_ASK_KEY)).toBe(OTHER)
    askRootOverride('garbage')
    expect(sessionStorage.getItem(ROOT_ASK_KEY)).toBe('1')
    expect(acquire).not.toHaveBeenCalled()
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})

describe('where it stands', () => {
  const MAIN = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8')
  const SOURCE = readFileSync(join(__dirname, 'root-override.ts'), 'utf8')
  const APP = readFileSync(join(__dirname, '..', 'app', 'app.ts'), 'utf8')

  it('is asked before ensureInstall, the import map and every dynamic load', () => {
    const at = MAIN.indexOf('await rootOverrideGate()')
    expect(at).toBeGreaterThan(MAIN.indexOf('if (await packedStoreBlocksBoot('))
    for (const later of ['await ensureInstall()', 'await attachImportMap()', 'await loader?.load?.()', 'loadBootBees?.()', 'await bootstrapApplication(']) {
      expect(MAIN.indexOf(later), later).toBeGreaterThan(at)
    }
  })

  it('answers from the console before bootstrap, and the App keeps the word', () => {
    expect(MAIN.indexOf('root: askRootOverride,')).toBeGreaterThan(0)
    expect(MAIN.indexOf('root: askRootOverride,')).toBeLessThan(MAIN.indexOf('const bootstrap = async'))
    expect(APP).toMatch(/root: askRootOverride,/)
  })

  it('takes only on a press on its own form — an address or a note can only open it', () => {
    // The one call of the take is inside the form's submit.
    expect([...SOURCE.matchAll(/takeRoot\(/g)]).toHaveLength(1)
    const submit = SOURCE.slice(SOURCE.indexOf("form.addEventListener('submit'"))
    expect(submit).toMatch(/await takeRoot\(asked, await vouches\)/)
    expect(SOURCE.slice(SOURCE.indexOf('export const rootOverrideGate'))).not.toMatch(/takeRoot|acquire\(|applySelection\(/)
  })

  it('keeps no record of its own, and stands aside on a published website and a sandbox door', () => {
    expect(SOURCE).not.toMatch(/localStorage\.setItem\(|createWritable\(|removeEntry\(/)
    const gate = SOURCE.slice(SOURCE.indexOf('export const rootOverrideGate'))
    expect(gate).toMatch(/__HC_READONLY__\?: boolean \}\)\.__HC_READONLY__ === true \|\| isSandboxDoor\(\)\) return/)
  })

  it('reads the default from the publisher the shell ships with, never from browser storage', () => {
    const FOLLOW = readFileSync(join(__dirname, 'install-follow.ts'), 'utf8')
    expect(FOLLOW).toMatch(/export const shellDefaultFollow = \(\): InstallFollow \| null => readInstallFollow\(null, INSTALL_PUBLISHER\)/)
    const read = SOURCE.slice(SOURCE.indexOf('const readVouches = async'), SOURCE.indexOf('/** Where an activation leaves'))
    expect(read).toMatch(/ask\('default', standard\)/)
    expect(read).toMatch(/const standard = shellDefaultFollow\(\)/)
    // The participant's own follow is offered beside it only when it names somebody else.
    expect(read).toMatch(/another \? ask\('followed', own\) : Promise\.resolve\(null\)/)
    // There is no override record and no signing step to forge.
    expect(SOURCE).not.toMatch(/signEvent|finalizeEvent|nostr-tools/)
  })

  it('draws itself: no Angular, no package surface', () => {
    expect(SOURCE).not.toMatch(/@angular|registerShellSurface|@hypercomb\/essentials|@hypercomb\/shared/)
  })
})
