// presentation/tiles/tile-actions.public-own.spec.ts — THE GLOBE ON YOUR OWN
// TILE WHILE JOINED.
//
// Everything a participant had before the meeting is private, and the only
// place the share toggles lived was world mode — prep that joining switches
// off. So a joined participant had no way left to offer an existing tile. The
// catalog now carries the two scopes on the `public-own` profile too (lookups
// match on profile, so DEFAULT_ACTIVE alone would have done nothing), the
// globe leads that profile's default arrangement, and its tint follows the
// tile's own individual scope exactly as the world-mode globe does.

import { describe, expect, it } from 'vitest'

const services = new Map<string, unknown>()
;(globalThis as unknown as { ioc: unknown }).ioc = {
  get: (key: string) => services.get(key),
  register: (key: string, value: unknown) => { if (!services.has(key)) services.set(key, value) },
  whenReady: () => void 0,
  onRegister: () => () => void 0,
}
services.set('@hypercomb.social/Lineage', { explorerLabel: () => '/', explorerSegments: () => [] })

const { ICON_REGISTRY, DEFAULT_ACTIVE } = await import('./tile-actions.drone.js')
const { setCellPublic } = await import('./tile-public.js')

const ctx = (label: string) => ({ label } as unknown as Parameters<NonNullable<typeof ICON_REGISTRY[number]['tintWhen']>>[0])

describe("the globe on a joined participant's own tile", () => {
  it("public-own lists make-public first, and carries make-branch-public for the arrange pool", () => {
    expect(DEFAULT_ACTIVE['public-own'][0]).toBe('make-public')
    const own = ICON_REGISTRY.filter(e => e.profile === 'public-own').map(e => e.name)
    expect(own).toContain('make-public')
    expect(own).toContain('make-branch-public')
  })

  it('the tint follows isIndividuallyPublic, exactly as in world mode', () => {
    const own = ICON_REGISTRY.find(e => e.name === 'make-public' && e.profile === 'public-own')!
    const world = ICON_REGISTRY.find(e => e.name === 'make-public' && e.profile === 'world')!
    setCellPublic('/', 'ideas', false)
    const dim = own.tintWhen!(ctx('ideas'))
    setCellPublic('/', 'ideas', true)
    const lit = own.tintWhen!(ctx('ideas'))
    expect(lit).not.toBe(dim)
    expect(lit).toBe(world.tintWhen!(ctx('ideas')))
    setCellPublic('/', 'ideas', false)
    expect(own.tintWhen!(ctx('ideas'))).toBe(dim)
  })
})
