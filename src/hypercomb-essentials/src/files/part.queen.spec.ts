// part.queen.spec.ts — the word that moves one block of a page out.

import { describe, expect, it } from 'vitest'

;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined, register: () => {}, whenReady: () => {} }
const { PartQueenBee, parsePart } = await import('./part.queen.js')

describe('what a part line asks for', () => {
  it('a tile, a block and a name', () => {
    expect(parsePart('/business-card script-3 animation')).toEqual({ route: ['business-card'], block: 'script-3', name: 'animation' })
    expect(parsePart('/sites/card style-1 Style')).toEqual({ route: ['sites', 'card'], block: 'style-1', name: 'style' })
  })

  it('takes the block as the outline spells it', () => {
    expect(parsePart('/card src/page/script-3.txt three')).toEqual({ route: ['card'], block: 'script-3', name: 'three' })
  })

  it('says what is missing', () => {
    expect(parsePart('')).toContain('part /<route> <block> <name>')
    expect(parsePart('/card script-3')).toContain('part /<route> <block> <name>')
    expect(parsePart('/ script-3 animation')).toContain('first page')
    expect(parsePart('/card markup animation')).toContain('not a block')
    expect(parsePart('/card script-3 my_animation')).toContain('not a tile name')
    expect(parsePart('/../card script-3 animation')).toContain('not a page of this hive')
  })
})

describe('the word as a model is offered it', () => {
  const queen = new PartQueenBee()

  it('changes what a tile holds, inside this hive', () => {
    expect(queen.machine).toMatchObject({ reach: 'editing', scope: 'hive', example: '/part /card script-3 animation' })
    expect(queen.machine.consequence).toContain('does not change by one byte')
  })

  it('refuses a line it cannot read before anything runs', () => {
    expect(queen.machine.refuse('/card script-3')).toContain('part needs')
    expect(queen.machine.refuse('/card script-3 animation')).toBeUndefined()
  })
})
