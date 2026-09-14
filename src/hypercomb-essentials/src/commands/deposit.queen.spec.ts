// commands/deposit.queen.spec.ts
//
// What is under test is the QUEEN's target resolution and dispatch — turning
// a selection or a named target into (layerSig, mark) pairs and calling
// mintDeposit once per pair. `mintDeposit` itself (signing, storage, the
// intake-filter merge) has its own specs; it is a double here.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as any).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const minted: { target: string; kind: string }[] = []
const mintResult = new Map<string, { ok: boolean }>() // keyed "target:kind"

vi.mock('../pheromones/pheromone-deposits.js', () => ({
  mintDeposit: async (target: string, kind: string) => {
    minted.push({ target, kind })
    return mintResult.get(`${target}:${kind}`) ?? { ok: true, deposit: { target, kind, depositor: 'x', at: 0 } }
  },
}))

const locationSigs = new Map<string, string>() // "parentSegments|label" -> locationSig
vi.mock('../editor/tile-properties.js', () => ({
  cellLocationSig: async (parentSegments: readonly string[], label: string) =>
    locationSigs.get(`${parentSegments.join('/')}|${label}`) ?? '',
}))

const { DepositQueenBee } = await import('./deposit.queen.js')

const LAYER_A = 'a'.repeat(64)
const LAYER_B = 'b'.repeat(64)
const LOC_A = 'loc-a'
const LOC_B = 'loc-b'

let queen: InstanceType<typeof DepositQueenBee>
let logs: string[] = []

const setIoc = (opts: {
  selected?: string[]
  parentSegments?: string[]
  layerByLoc?: Record<string, string>
} = {}): void => {
  const layerByLoc = opts.layerByLoc ?? { [LOC_A]: LAYER_A, [LOC_B]: LAYER_B }
  ;(window as any).__reg = {
    '@diamondcoreprocessor.com/SelectionService': { selected: new Set(opts.selected ?? []) },
    '@hypercomb.social/Lineage': { explorerSegments: () => opts.parentSegments ?? [] },
    '@diamondcoreprocessor.com/HistoryService': {
      currentLayerRefAt: async (locationSig: string) => {
        const layerSig = layerByLoc[locationSig]
        return layerSig ? { layerSig } : null
      },
    },
  }
}

beforeEach(() => {
  minted.length = 0
  mintResult.clear()
  locationSigs.clear()
  logs = []
  queen = new DepositQueenBee()
  EffectBus.on('activity:log', ({ message }: { message: string }) => logs.push(message))
  setIoc()
})

describe('/deposit', () => {
  it('deposits a mark on the named target, resolving its current content signature', async () => {
    locationSigs.set('|tileA', LOC_A)
    await queen.invoke('tileA = cigars')
    expect(minted).toEqual([{ target: LAYER_A, kind: 'cigars' }])
  })

  it('deposits on every selected tile when no named target is given', async () => {
    locationSigs.set('|one', LOC_A)
    locationSigs.set('|two', LOC_B)
    setIoc({ selected: ['one', 'two'] })
    await queen.invoke('cigars')
    expect(minted.sort((a, b) => a.target.localeCompare(b.target))).toEqual([
      { target: LAYER_A, kind: 'cigars' },
      { target: LAYER_B, kind: 'cigars' },
    ])
  })

  it('deposits multiple comma-separated marks on one target', async () => {
    locationSigs.set('|tileA', LOC_A)
    await queen.invoke('tileA = cigars, travel')
    expect(minted).toEqual([
      { target: LAYER_A, kind: 'cigars' },
      { target: LAYER_A, kind: 'travel' },
    ])
  })

  it('resolves the named target against the current lineage, not the root', async () => {
    locationSigs.set('nested|tileA', LOC_A)
    setIoc({ parentSegments: ['nested'] })
    await queen.invoke('tileA = cigars')
    expect(minted).toEqual([{ target: LAYER_A, kind: 'cigars' }])
  })

  it('refuses cleanly when nothing is selected and no named target is given', async () => {
    await queen.invoke('cigars')
    expect(minted).toEqual([])
    expect(logs.at(-1)).toMatch(/nothing selected/)
  })

  it('refuses cleanly when no mark is given', async () => {
    await queen.invoke('tileA = ')
    expect(minted).toEqual([])
    expect(logs.at(-1)).toMatch(/needs at least one mark/)
  })

  it('a target whose content signature cannot be resolved is refused, not thrown', async () => {
    // No entry in locationSigs for 'ghost' — cellLocationSig resolves to ''.
    await expect(queen.invoke('ghost = cigars')).resolves.toBeUndefined()
    expect(minted).toEqual([])
    expect(logs.at(-1)).toMatch(/nothing landed/)
  })

  it('a mintDeposit failure on one mark does not block the others', async () => {
    locationSigs.set('|tileA', LOC_A)
    mintResult.set(`${LAYER_A}:bad`, { ok: false })
    await queen.invoke('tileA = cigars, bad')
    expect(minted).toEqual([
      { target: LAYER_A, kind: 'cigars' },
      { target: LAYER_A, kind: 'bad' },
    ])
    expect(logs.at(-1)).toMatch(/1 refused/)
  })
})
