// machine-census.spec.ts — the vocabulary, rendered once.
//
// The rule worth guarding is the one that cost this codebase a participant
// being told their hive has no delete behaviour: the catalogue must be the
// LIVE census filtered by the LIVE grant, and there must be exactly one of it.
// These tests pin the filtering and the shape; `hypercomb-grammar.spec.ts`
// pins the shell's framing on top of the same function.

import { describe, expect, it } from 'vitest'
import { callableBehaviours, machineCatalogue, type CensusEntry } from './machine-census.js'
import type { MachineGrant } from './machine-admission.js'

const ANY: MachineGrant = { reach: 'destructive', scope: 'network' }

const entry = (over: Partial<CensusEntry> & { name: string }): CensusEntry => ({
  description: `the ${over.name} behaviour`,
  machine: { forms: '<tile>', example: `/${over.name} drafts`, reach: 'editing', scope: 'tile' },
  ...over,
})

describe('callableBehaviours', () => {
  it('keeps a behaviour that declared itself to machines', () => {
    expect(callableBehaviours([entry({ name: 'postit' })], ANY).map(e => e.name)).toEqual(['postit'])
  })

  it('drops one that never did — default-deny is the majority case', () => {
    const silent = { name: 'annotate', description: 'draw on the screen' } as CensusEntry
    expect(callableBehaviours([silent], ANY)).toEqual([])
  })

  it('drops a malformed declaration as a DEFECT, not a boundary', () => {
    // forms/example missing: calling it would produce a line that cannot run,
    // so teaching it is worse than omitting it.
    const broken = { name: 'half', machine: { } } as unknown as CensusEntry
    expect(callableBehaviours([broken], ANY)).toEqual([])
  })

  it('collapses a duplicate name to the first registration', () => {
    const twice = [entry({ name: 'postit' }), entry({ name: 'postit', description: 'second' })]
    expect(callableBehaviours(twice, ANY)).toHaveLength(1)
  })

  // THE BOUNDARY IS NEVER A TRAP. A verb the grant refuses must not appear in
  // the catalogue at all — a model offered `/remove` and then refused will try
  // synonyms, and there are none.
  it('withholds a verb the grant will not admit', () => {
    const destructive = entry({
      name: 'remove',
      machine: { forms: '<tile>', example: '/remove drafts', reach: 'destructive', scope: 'page' },
    })
    const gentle: MachineGrant = { reach: 'editing', scope: 'page' }
    expect(callableBehaviours([destructive], gentle)).toEqual([])
    expect(callableBehaviours([destructive], ANY).map(e => e.name)).toEqual(['remove'])
  })
})

describe('machineCatalogue', () => {
  it('renders name, argument shape, description and a worked example', () => {
    const line = machineCatalogue([entry({ name: 'postit' })], ANY)
    expect(line).toBe('/postit <tile> - the postit behaviour. Example: /postit drafts')
  })

  // The consequence is QUOTED, never composed — a fixed sentence per reach
  // value is how the catalogue once promised a confirmation `/remove` does not
  // perform. If a behaviour says nothing, the catalogue says nothing.
  it('quotes a declared consequence and invents none otherwise', () => {
    const withNote = entry({
      name: 'hide',
      machine: {
        forms: '<tile>', example: '/hide drafts', reach: 'destructive', scope: 'network',
        consequence: 'Emits a signed mesh event under your pubkey.',
      },
    })
    expect(machineCatalogue([withNote], ANY))
      .toContain('. Emits a signed mesh event under your pubkey. Example:')
    expect(machineCatalogue([entry({ name: 'postit' })], ANY)).not.toMatch(/confirm/i)
  })

  it('is empty when nothing is callable, rather than throwing', () => {
    expect(machineCatalogue([], ANY)).toBe('')
  })
})

describe('the catalogue order', () => {
  // HIDE FIRST, DELETE SECOND, where a model can see it (surface audit, item
  // 7): census order put the manual providers — /remove among them — ahead of
  // every queen, so the harsh verb was the second line read and /hide far
  // below. Gentlest first; census order within a rung.
  const at = (name: string, reach: 'additive' | 'editing' | 'destructive') =>
    entry({ name, machine: { forms: '<tile>', example: `/${name} drafts`, reach, scope: 'page' } })

  it('lists additive, then editing, then destructive', () => {
    const census = [at('remove', 'destructive'), at('keyword', 'editing'), at('create', 'additive'), at('hide', 'editing')]
    const names = machineCatalogue(census, ANY).split('\n').map(line => line.split(' ')[0])
    expect(names).toEqual(['/create', '/keyword', '/hide', '/remove'])
  })

  it('reads an unstated reach as editing, its documented default', () => {
    const unstated = entry({ name: 'title', machine: { forms: '<text>', example: '/title x', scope: 'tile' } })
    const names = machineCatalogue([at('cut', 'destructive'), unstated, at('copy', 'additive')], ANY).split('\n').map(line => line.split(' ')[0])
    expect(names).toEqual(['/copy', '/title', '/cut'])
  })
})
