// presentation/tiles/tile-actions.pools.spec.ts : THE BAND IN POOLS MODE.
//
// While pools mode is up the tap is the tile's light, so the hover band gives
// up the two share toggles and carries the one thing the tap no longer does:
// Go inside, on a tile that has an inside. The toggles' handlers stay, because
// the tap drives them, and going inside is asked of the overlay's one entry
// choke point as a command that is never replayed.

import { describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
  onRegister: () => () => void 0,
}
services.set('@hypercomb.social/Lineage', { explorerLabel: () => '/', explorerSegments: () => [] })

const { ICON_REGISTRY, DEFAULT_ACTIVE } = await import('./tile-actions.drone.js')
const { isBranchPublic, isIndividuallyPublic } = await import('./tile-public.js')

const drone = services.get('@diamondcoreprocessor.com/TileActionsDrone') as { pulse(grammar: string): Promise<void> }
await drone.pulse('')

type Context = Parameters<NonNullable<typeof ICON_REGISTRY[number]['visibleWhen']>>[0]
const act = (action: string, label: string): void => { EffectBus.emit('tile:action', { action, label, q: 0, r: 0, index: 0 }) }

type Registered = { name: string; profile: string; offBand?: boolean; labelKey?: string; visibleWhen?: (ctx: Context) => boolean }
/** Everything the drone registers with the overlay when the overlay asks for it. */
const registered = (): Registered[] => {
  const all: Registered[] = []
  const off = EffectBus.on<Registered[] | undefined>('overlay:register-action', batch => { if (Array.isArray(batch)) all.push(...batch) })
  all.length = 0
  EffectBus.emit('render:host-ready', {})
  all.length = 0
  EffectBus.emit('overlay:request-register', {})
  off()
  return all
}

describe('the band in pools mode', () => {
  it('carries Go inside and nothing else by default', () => {
    expect(DEFAULT_ACTIVE['world']).toEqual(['pools-enter'])
  })

  it('shows Go inside only on a tile that has children', () => {
    const inside = ICON_REGISTRY.find(entry => entry.name === 'pools-enter' && entry.profile === 'world')!
    expect(inside.visibleWhen!({ label: 'recipes', isBranch: true } as Context)).toBe(true)
    expect(inside.visibleWhen!({ label: 'note', isBranch: false } as Context)).toBe(false)
  })

  it('keeps both scopes in the catalog for the arrange pool, and for the swarm', () => {
    const world = ICON_REGISTRY.filter(entry => entry.profile === 'world').map(entry => entry.name)
    expect(world).toEqual(expect.arrayContaining(['make-public', 'make-branch-public']))
    expect(DEFAULT_ACTIVE['public-own']).toContain('make-public')
  })

  it('registers the light off the band, so a surface with no tap on a hexagon still carries it', () => {
    const world = registered().filter(desc => desc.profile === 'world')
    // The band's own order in pools mode is Go inside and nothing else.
    expect(world.filter(desc => !desc.offBand).map(desc => desc.name)).toEqual(['pools-enter'])
    // The tile page, the brief and the list face's rows get one worded light.
    const light = world.filter(desc => desc.offBand)
    expect(light.map(desc => desc.name)).toEqual(['make-public'])
    expect(light[0].labelKey).toBe('pools.light')
  })

  it('offers the light on your own tiles only: a peer\'s tile is never yours to turn on', () => {
    const light = registered().find(desc => desc.profile === 'world' && desc.offBand)!
    expect(light.visibleWhen!({ label: 'soup', isExternal: false } as Context)).toBe(true)
    expect(light.visibleWhen!({ label: 'theirs', isExternal: true } as Context)).toBe(false)
  })

  it('registers nothing off the band in any other profile', () => {
    expect(registered().filter(desc => desc.offBand).map(desc => desc.profile)).toEqual(['world'])
  })

  it('the tap\'s two actions still light a tile and a whole branch', () => {
    act('make-public', 'soup')
    expect(isIndividuallyPublic('/', 'soup')).toBe(true)
    act('make-branch-public', 'soup')
    expect(isBranchPublic('/', 'soup')).toBe(true)
    expect(isIndividuallyPublic('/', 'soup')).toBe(false)
    act('make-branch-public', 'soup')
    expect(isBranchPublic('/', 'soup')).toBe(false)
  })

  it('Go inside asks the overlay to enter by the name the page shows, as a command that is not replayed', () => {
    const asked: unknown[] = []
    const off = EffectBus.on('tile:enter-request', payload => { asked.push(payload) })
    act('pools-enter', 'My Folder')
    off()
    expect(asked).toEqual([{ label: 'My Folder' }])
    const late: unknown[] = []
    EffectBus.on('tile:enter-request', payload => { late.push(payload) })()
    expect(late).toEqual([])
  })
})
