// arrival-plan.spec.ts — a published arrival loads what its plan names, and
// what those bees declare they read; nothing else.

import { afterEach, describe, expect, it } from 'vitest'
import { arrivalNames, beeClassesOfDocs, classOfKey, resolveArrival, type BeeClass } from './arrival-plan'

const sig = (c: string): string => c.repeat(64)

const docs = {
  bees: {
    [`${sig('a')}.js`]: { className: 'SiteViewDrone', deps: { store: '@hypercomb.social/Store', links: '@diamondcoreprocessor.com/LinkService' } },
    [sig('b')]: { className: 'LinkService', deps: {} },
    [sig('c')]: { className: 'ShowCellDrone', deps: { site: '@diamondcoreprocessor.com/SiteViewDrone' } },
    [sig('d')]: { className: 'GameViewDrone' },
    'not-a-sig': { className: 'Broken' },
  },
}

const index = (): Map<string, BeeClass> => new Map(beeClassesOfDocs(docs))
const all = new Set([sig('a'), sig('b'), sig('c'), sig('d')])

describe('arrival plan', () => {
  afterEach(() => { delete (globalThis as { __hcArrival?: unknown }).__hcArrival })

  it('reads the class index from layer docs, stripping .js and skipping non-signatures', () => {
    const classes = index()
    expect(classes.get('SiteViewDrone')?.sig).toBe(sig('a'))
    expect(classes.get('SiteViewDrone')?.needs).toEqual(['@hypercomb.social/Store', '@diamondcoreprocessor.com/LinkService'])
    expect(classes.has('Broken')).toBe(false)
  })

  it('names by IoC key or class; the key survives a rebuild, the signature does not', () => {
    expect(classOfKey('@diamondcoreprocessor.com/SiteViewDrone')).toBe('SiteViewDrone')
    expect(classOfKey('SiteViewDrone')).toBe('SiteViewDrone')
  })

  it('loads the named faces and what they declare they read — transitively, nothing more', () => {
    const { bees, missing } = resolveArrival(['@diamondcoreprocessor.com/SiteViewDrone'], index(), all)
    expect([...bees].sort()).toEqual([sig('a'), sig('b')])
    // The Store is a shell service, not a bee: a need, not a gap.
    expect(missing).toEqual([])
  })

  it('reports a named face the package does not carry', () => {
    const { bees, missing } = resolveArrival(['GameViewDrone', 'ArcadeDrone'], index(), all)
    expect([...bees]).toEqual([sig('d')])
    expect(missing).toEqual(['ArcadeDrone'])
  })

  it('never reaches outside the package inventory', () => {
    const { bees } = resolveArrival(['ShowCellDrone'], index(), new Set([sig('c')]))
    expect([...bees]).toEqual([sig('c')])
  })

  it('reads the plan the shell started fetching; absent, empty or slow is no plan', async () => {
    expect(await arrivalNames()).toBeNull()
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = Promise.resolve(['@x.com/A', ' ', 'B'])
    expect(await arrivalNames()).toEqual(['@x.com/A', 'B'])
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = Promise.resolve([])
    expect(await arrivalNames()).toBeNull()
    ;(globalThis as { __hcArrival?: unknown }).__hcArrival = new Promise(() => {})
    expect(await arrivalNames(20)).toBeNull()
  })
})
