// package-units.spec.ts — a package is a NAMED top-level layer of the served
// tree; on/off is a set of names; a unit's version is its layer signature.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { beesWithUnitsOff, changedUnits, dependencyUnits, packageUnits, readOffUnits, unitOfDependency, writeOffUnits, UNITS_OFF_KEY } from './package-units'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const world = () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const origin = new Map<string, Uint8Array<ArrayBuffer>>()
  const fetched: string[] = []
  const io: ReplicationIo = {
    read: async (sig) => heap.get(sig) ?? null,
    fetch: async (sig) => { fetched.push(sig); return origin.get(sig) ?? null },
    write: async (sig, bytes) => { heap.set(sig, bytes) },
  }
  const publish = async (record: object, where: 'heap' | 'origin' = 'origin'): Promise<string> => {
    const bytes = encode(JSON.stringify(record))
    const sig = await sigOf(bytes)
    ;(where === 'heap' ? heap : origin).set(sig, bytes)
    return sig
  }
  return { heap, origin, fetched, io, publish }
}

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

describe('package units', () => {
  it('reads one unit per top-level layer, with every bee its subtree declares', async () => {
    const w = world()
    const beeA = await publishBee(w, 'a'), beeB = await publishBee(w, 'b'), beeC = await publishBee(w, 'c')
    const inner = await w.publish({ name: 'wheel', cells: [], bees: [`${beeB}.js`], dependencies: [] })
    const games = await w.publish({ name: 'games', cells: [inner], bees: [`${beeA}.js`], dependencies: [], docs: { description: 'play' } })
    const sharing = await w.publish({ name: 'sharing', cells: [], bees: [`${beeC}.js`], dependencies: [] })
    const root = await w.publish({ name: 'root', cells: [games, sharing], bees: [], dependencies: [] })

    const units = await packageUnits(root, w.io)

    expect(units.map(u => u.name)).toEqual(['games', 'sharing'])
    expect(units[0]).toMatchObject({ layerSig: games, bees: [beeA, beeB].sort(), description: 'play' })
    expect(units[1]).toMatchObject({ layerSig: sharing, bees: [beeC], description: '' })
  })

  it('never yields a unit with a partial bee list — an unresolvable subtree is left out', async () => {
    const w = world()
    const beeA = await publishBee(w, 'a')
    const gone = 'f'.repeat(64)
    const broken = await w.publish({ name: 'broken', cells: [gone], bees: [], dependencies: [] })
    const whole = await w.publish({ name: 'whole', cells: [], bees: [`${beeA}.js`], dependencies: [] })
    const root = await w.publish({ name: 'root', cells: [broken, whole], bees: [], dependencies: [] })

    expect((await packageUnits(root, w.io)).map(u => u.name)).toEqual(['whole'])
  })

  it('reads held layers without fetching — a repoint costs no host', async () => {
    const w = world()
    const beeA = await publishBee(w, 'a')
    const unit = await w.publish({ name: 'notes', cells: [], bees: [`${beeA}.js`], dependencies: [] }, 'heap')
    const root = await w.publish({ name: 'root', cells: [unit], bees: [], dependencies: [] }, 'heap')

    const units = await packageUnits(root, { ...w.io, fetch: async () => { throw new Error('fetched') } })

    expect(units.map(u => u.name)).toEqual(['notes'])
    expect(w.fetched).toEqual([])
  })

  it('the off set is names, kept in storage, and gone when empty', () => {
    const storage = memory()
    writeOffUnits(['games', 'games', 'not a name!'], storage)
    expect(JSON.parse(storage.getItem(UNITS_OFF_KEY)!)).toEqual(['games'])
    expect([...readOffUnits(storage)]).toEqual(['games'])
    writeOffUnits([], storage)
    expect(storage.getItem(UNITS_OFF_KEY)).toBeNull()
  })

  it('leaves out only the bees that belong to units that are off', () => {
    const units = [
      { name: 'games', layerSig: 'g', bees: ['1', '2'], description: '' },
      { name: 'notes', layerSig: 'n', bees: ['2', '3'], description: '' },
    ]
    const all = ['1', '2', '3', 'root-bee']
    expect(beesWithUnitsOff(all, units, new Set(['games']))).toEqual(['2', '3', 'root-bee'])
    expect(beesWithUnitsOff(all, units, new Set(['games', 'notes']))).toEqual(['root-bee'])
    expect(beesWithUnitsOff(all, units, new Set())).toEqual(all)
  })

  it('attributes a changed namespace dependency to the unit its alias names — a queen moves its unit, not just the root', async () => {
    // Found on the real hive 2026-09-13: a change to upgrade.queen.ts moved the
    // root and no unit layer, so the notice announced an update Packages could
    // not show. Queens, views and services build into namespace dependencies,
    // which only the root layer lists.
    const w = world()
    const dep = (alias: string, body: string) => encode(`// ${alias}\n${body}`)
    const oldCommands = dep('@hypercomb/essentials/commands', 'old')
    const newCommands = dep('@hypercomb/essentials/commands', 'new')
    const tiles = dep('@hypercomb/essentials/presentation/tiles', 'same')
    const [sOld, sNew, sTiles] = await Promise.all([sigOf(oldCommands), sigOf(newCommands), sigOf(tiles)])
    const held = new Map([[sOld, oldCommands], [sTiles, tiles]])
    w.origin.set(sNew, newCommands)
    const commands = await w.publish({ name: 'commands', cells: [], bees: [], dependencies: [] })
    const before = await w.publish({ name: 'root', cells: [commands], bees: [], dependencies: [`${sOld}.js`, `${sTiles}.js`] })
    const after = await w.publish({ name: 'root', cells: [commands], bees: [], dependencies: [`${sNew}.js`, `${sTiles}.js`] })

    const moved = await dependencyUnits(before, after, w.io, async sig => held.get(sig) ?? null)
    expect([...moved]).toEqual(['commands'])
    expect(unitOfDependency(tiles)).toBe('presentation')
    expect(unitOfDependency(encode('no alias here'))).toBe('')
    expect((await dependencyUnits(before, before, w.io, async () => null)).size).toBe(0)
  })

  it('marks the units a newer root changes, by name, and the ones it adds', () => {
    const before = [
      { name: 'games', layerSig: 'g1', bees: [], description: '' },
      { name: 'notes', layerSig: 'n1', bees: [], description: '' },
    ]
    const after = [
      { name: 'games', layerSig: 'g2', bees: [], description: '' },
      { name: 'notes', layerSig: 'n1', bees: [], description: '' },
      { name: 'comfy', layerSig: 'c1', bees: [], description: '' },
    ]
    expect([...changedUnits(before, after)].sort()).toEqual(['comfy', 'games'])
    expect(changedUnits(after, after).size).toBe(0)
  })
})

const publishBee = async (w: ReturnType<typeof world>, text: string): Promise<string> => {
  const bytes = encode(`// bee ${text}`)
  const sig = await sigOf(bytes)
  w.origin.set(sig, bytes)
  return sig
}
