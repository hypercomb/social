// Which hover animation a tile wears (hover-animation.ts): the rungs of the
// trait read once per place, a failed or unknown answer always its own version,
// and an ordinary tile never costing a read.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTraitsAt = vi.fn()
const childNamesAt = vi.fn()
const hasKind = vi.fn()
let layerName: string | undefined

vi.mock('../../commands/trait-read.js', () => ({
  resolveTraitsAt: (...args: unknown[]) => resolveTraitsAt(...args),
  childNamesAt: (...args: unknown[]) => childNamesAt(...args),
}))
vi.mock('../../commands/decoration-kind-index.js', () => ({
  hasDecorationKindAt: (...args: unknown[]) => hasKind(...args),
}))

import { hoverEffectId } from '../grid/hover-effects.js'
import { forgetHoverEffects, hoverEffectKnown, readHoverEffect, wearsHoverTrait } from './hover-animation.js'

const SIG = 'a'.repeat(64)
const here = ['docs', 'plan']
const mist = hoverEffectId('mist')

beforeEach(() => {
  forgetHoverEffects()
  resolveTraitsAt.mockReset()
  childNamesAt.mockReset()
  hasKind.mockReset()
  layerName = undefined
  vi.stubGlobal('window', {
    ioc: { get: () => ({ getLayerBySig: async () => (layerName === undefined ? null : { name: layerName }) }) },
  })
})

describe('the gate', () => {
  it('asks the decoration-kind index for the trait record, by place', () => {
    hasKind.mockReturnValue(false)
    expect(wearsHoverTrait(here)).toBe(false)
    expect(hasKind).toHaveBeenCalledWith(here, 'trait:want')
  })
})

describe('the rungs', () => {
  it('a fill: the filler tile\'s NAME picks the look', async () => {
    layerName = 'Mist'
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    expect(await readHoverEffect(here)).toBe(mist)
  })

  it('a fill named something we do not ship is its own version', async () => {
    layerName = 'lava'
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    expect(await readHoverEffect(here)).toBe(0)
  })

  it('a fill whose layer cannot be read is its own version', async () => {
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    expect(await readHoverEffect(here)).toBe(0)
  })

  it('a child: the first of ITS children that names a look we ship', async () => {
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'child', sig: SIG, route: [...here, 'hover-animation'] }])
    childNamesAt.mockResolvedValue(['notes', 'smoke', 'mist'])
    expect(await readHoverEffect(here)).toBe(hoverEffectId('smoke'))
    expect(childNamesAt).toHaveBeenCalledWith([...here, 'hover-animation'])
  })

  it('a child with no child we know is its own version', async () => {
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'child', sig: SIG, route: [] }])
    childNamesAt.mockResolvedValue(['notes'])
    expect(await readHoverEffect(here)).toBe(0)
  })

  it('own, a miss and a different trait are all its own version', async () => {
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'own' }])
    expect(await readHoverEffect(['a'])).toBe(0)
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'miss' }])
    expect(await readHoverEffect(['b'])).toBe(0)
    resolveTraitsAt.mockResolvedValue([{ word: 'portrait', rung: 'fill', sig: SIG, route: [] }])
    layerName = 'mist'
    expect(await readHoverEffect(['c'])).toBe(0)
  })

  it('finds the trait among others by the fold, not the display text', async () => {
    layerName = 'glow'
    resolveTraitsAt.mockResolvedValue([
      { word: 'portrait', rung: 'own' },
      { word: 'Hover-Animation', rung: 'fill', sig: SIG, route: [] },
    ])
    expect(await readHoverEffect(here)).toBe(hoverEffectId('glow'))
  })

  it('a failed read is its own version, never a throw', async () => {
    resolveTraitsAt.mockRejectedValue(new Error('layer unreadable'))
    await expect(readHoverEffect(here)).resolves.toBe(0)
  })
})

describe('what is kept', () => {
  it('reads a place once and answers from then on without reading', async () => {
    layerName = 'mist'
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    expect(hoverEffectKnown(here)).toBeUndefined()
    expect(await readHoverEffect(here)).toBe(mist)
    expect(hoverEffectKnown(here)).toBe(mist)
    expect(await readHoverEffect(here)).toBe(mist)
    expect(resolveTraitsAt).toHaveBeenCalledTimes(1)
  })

  it('joins a read already in flight instead of starting a second', async () => {
    layerName = 'mist'
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    const [a, b] = await Promise.all([readHoverEffect(here), readHoverEffect(here)])
    expect([a, b]).toEqual([mist, mist])
    expect(resolveTraitsAt).toHaveBeenCalledTimes(1)
  })

  it('forgets on a decoration change, so the next read sees the new fill', async () => {
    layerName = 'mist'
    resolveTraitsAt.mockResolvedValue([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    expect(await readHoverEffect(here)).toBe(mist)
    forgetHoverEffects()
    expect(hoverEffectKnown(here)).toBeUndefined()
    layerName = 'smoke'
    expect(await readHoverEffect(here)).toBe(hoverEffectId('smoke'))
  })

  it('does not keep an answer that was in flight when a decoration changed', async () => {
    layerName = 'mist'
    let release: (v: unknown) => void = () => {}
    resolveTraitsAt.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const stale = readHoverEffect(here)
    forgetHoverEffects()
    release([{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }])
    await stale
    expect(hoverEffectKnown(here)).toBeUndefined()
  })

  it('keeps places apart', async () => {
    resolveTraitsAt.mockImplementation(async (segments: string[]) =>
      segments[0] === 'a' ? [{ word: 'hover-animation', rung: 'fill', sig: SIG, route: [] }] : [])
    layerName = 'glow'
    expect(await readHoverEffect(['a'])).toBe(hoverEffectId('glow'))
    expect(await readHoverEffect(['b'])).toBe(0)
  })
})
