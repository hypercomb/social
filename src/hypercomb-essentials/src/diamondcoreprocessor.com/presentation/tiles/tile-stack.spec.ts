// tile-stack.spec.ts — the participant stack's ordering and roll.
//
// What these pin down is the contract the renderer and the wheel share:
// a stack is ordered by participant with YOU first, and rolling it moves
// the global spotlight (a layer move) rather than any per-tile state.

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  setTileStacks,
  stackFor,
  stackDepth,
  stackedLabels,
  variantFor,
  hoveredLabel,
  hoveredStackDepth,
  rollHoveredStack,
  type StackVariant,
} from './tile-stack.js'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

/** Minimal spotlight double — the roll only ever reads activePeer and
 *  calls set/dismiss, which is the whole contract with the service. */
function installSpotlight(initial: string | null = null) {
  const spotlight = {
    activePeer: initial,
    set: vi.fn((pk: string | null) => { spotlight.activePeer = pk }),
    dismiss: vi.fn(() => { spotlight.activePeer = null }),
  }
  ;(globalThis as any).window = {
    ioc: { get: (k: string) => k === '@diamondcoreprocessor.com/SpotlightService' ? spotlight : undefined },
  }
  return spotlight
}

/** The module tracks the hovered tile off the `tile:hover` effect. In a
 *  test we drive it through the same EffectBus the drone emits on. */
async function hover(label: string | null): Promise<void> {
  const { EffectBus } = await import('@hypercomb/core')
  EffectBus.emit('tile:hover', { label })
}

const stack = (...variants: StackVariant[]) => variants

describe('tile-stack', () => {

  beforeEach(() => {
    installSpotlight(null)
    setTileStacks(new Map())
  })

  it('reads an unstacked label as depth zero', () => {
    expect(stackDepth('notes')).toBe(0)
    expect(stackFor('notes')).toEqual([])
    expect(variantFor('notes', ALICE)).toBeUndefined()
  })

  it('keeps you at index 0 and the publishers after you', () => {
    setTileStacks(new Map([
      ['notes', stack({ pubkey: '' }, { pubkey: ALICE }, { pubkey: BOB })],
    ]))
    expect(stackFor('notes').map(v => v.pubkey)).toEqual(['', ALICE, BOB])
    expect(stackDepth('notes')).toBe(3)
  })

  it('reports only labels more than one participant holds', () => {
    setTileStacks(new Map([
      ['notes', stack({ pubkey: '' }, { pubkey: ALICE })],
      ['mine', stack({ pubkey: '' })],
      ['theirs', stack({ pubkey: BOB })],
    ]))
    expect([...stackedLabels()].sort()).toEqual(['notes'])
  })

  it('replaces the whole map so a departed peer stops reading as stacked', () => {
    setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE })]]))
    expect(stackDepth('notes')).toBe(2)
    setTileStacks(new Map([['notes', stack({ pubkey: '' })]]))
    expect(stackDepth('notes')).toBe(1)
  })

  it('carries the publisher image sig on the variant', () => {
    const sig = 'c'.repeat(64)
    setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE, imageSig: sig })]]))
    expect(variantFor('notes', ALICE)?.imageSig).toBe(sig)
    expect(variantFor('notes', '')?.imageSig).toBeUndefined()
  })

  describe('hover', () => {
    it('tracks the hovered label and clears over chrome', async () => {
      await hover('notes')
      expect(hoveredLabel()).toBe('notes')
      await hover(null)
      expect(hoveredLabel()).toBeNull()
    })

    it('reports the hovered tile’s depth', async () => {
      setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE })]]))
      await hover('notes')
      expect(hoveredStackDepth()).toBe(2)
      await hover('elsewhere')
      expect(hoveredStackDepth()).toBe(0)
    })
  })

  describe('roll', () => {
    it('refuses when nothing is hovered', () => {
      expect(rollHoveredStack(1)).toBe(false)
    })

    it('refuses a tile only you hold — the wheel stays with zoom', async () => {
      setTileStacks(new Map([['mine', stack({ pubkey: '' })]]))
      await hover('mine')
      expect(rollHoveredStack(1)).toBe(false)
    })

    it('rolls forward from you onto the first publisher', async () => {
      const spotlight = installSpotlight(null)
      setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE }, { pubkey: BOB })]]))
      await hover('notes')
      expect(rollHoveredStack(1)).toBe(true)
      expect(spotlight.set).toHaveBeenCalledWith(ALICE)
    })

    it('wraps back round to you at the end of the stack', async () => {
      const spotlight = installSpotlight(BOB)
      setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE }, { pubkey: BOB })]]))
      await hover('notes')
      expect(rollHoveredStack(1)).toBe(true)
      expect(spotlight.dismiss).toHaveBeenCalled()
      expect(spotlight.activePeer).toBeNull()
    })

    it('rolls backwards from you onto the last publisher', async () => {
      const spotlight = installSpotlight(null)
      setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE }, { pubkey: BOB })]]))
      await hover('notes')
      expect(rollHoveredStack(-1)).toBe(true)
      expect(spotlight.set).toHaveBeenCalledWith(BOB)
    })

    it('walks only the hovered tile’s participants', async () => {
      // Bob is spotlit but doesn't hold this tile. Rolling starts from
      // the top of THIS stack rather than refusing or marching through
      // participants that have nothing to show here.
      const spotlight = installSpotlight(BOB)
      setTileStacks(new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE })]]))
      await hover('notes')
      expect(rollHoveredStack(1)).toBe(true)
      expect(spotlight.set).toHaveBeenCalledWith(ALICE)
    })

    it('is a layer move — it never records per-tile state', async () => {
      const spotlight = installSpotlight(null)
      const stacks = new Map([['notes', stack({ pubkey: '' }, { pubkey: ALICE })]])
      setTileStacks(stacks)
      await hover('notes')
      rollHoveredStack(1)
      // The stack itself is untouched; the only thing that moved is the
      // spotlight, which every tile of Alice's reads.
      expect(stackFor('notes').map(v => v.pubkey)).toEqual(['', ALICE])
      expect(spotlight.activePeer).toBe(ALICE)
    })
  })
})
