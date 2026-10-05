// commands/card-wear.spec.ts — the rule behind `card wear <template>`.
import { describe, it, expect } from 'vitest'
import { planWear, parseCardArgs, routeFrom } from './card-wear.js'

const s = (c: string) => c.repeat(64)
const PAGE_V1 = s('a'), PAGE_V3 = s('b'), MINE = s('c'), SLOTS = s('d'), GRAPHITE = s('e'), PIC = s('f'), TPL_PIC = s('1')

describe('planWear — a tile wears a template by reference', () => {
  const template = { page: { htmlSig: PAGE_V3, label: 'Business card', icon: 'badge' }, card: { dataSig: SLOTS, themeSig: GRAPHITE } }

  it('takes the template page and theme, and keeps its own details, label and icon', () => {
    const own = { page: { htmlSig: PAGE_V1, label: 'My card', icon: 'star' }, card: { dataSig: MINE } }
    expect(planWear(own, template)).toEqual({
      page: { htmlSig: PAGE_V3, label: 'My card', icon: 'star' },
      card: { dataSig: MINE, themeSig: GRAPHITE },
    })
  })

  it('keeps its own middle picture over the template\'s', () => {
    const own = { page: { htmlSig: PAGE_V1 }, card: { dataSig: MINE, artSig: PIC } }
    const plan = planWear(own, { ...template, card: { ...template.card, artSig: TPL_PIC } })
    expect(plan).toMatchObject({ card: { dataSig: MINE, themeSig: GRAPHITE, artSig: PIC } })
  })

  it('drops its old theme when the template has none (Honeycomb Edge)', () => {
    const own = { page: { htmlSig: PAGE_V3 }, card: { dataSig: MINE, themeSig: GRAPHITE } }
    const plan = planWear(own, { page: { htmlSig: PAGE_V3 }, card: { dataSig: SLOTS } })
    expect(plan).toEqual({ page: { htmlSig: PAGE_V3 }, card: { dataSig: MINE } })
  })

  it('starts from the template\'s card when the tile has none of its own', () => {
    expect(planWear({}, template)).toEqual({
      page: { htmlSig: PAGE_V3, label: 'Business card', icon: 'badge' },
      card: { dataSig: SLOTS, themeSig: GRAPHITE },
    })
  })

  it('says so when the tile already wears exactly this', () => {
    const own = { page: { htmlSig: PAGE_V3 }, card: { dataSig: MINE, themeSig: GRAPHITE } }
    expect(planWear(own, template)).toEqual({ same: true })
  })

  it('refuses a tile with no card page as a template', () => {
    expect(planWear({ card: { dataSig: MINE } }, { card: { dataSig: SLOTS } })).toEqual({ refuse: 'not-a-template' })
  })

  it('refuses when neither has a card to wear it with', () => {
    expect(planWear({}, { page: { htmlSig: PAGE_V3 } })).toEqual({ refuse: 'no-card' })
  })

  it('ignores anything that is not a signature', () => {
    const plan = planWear({ card: { dataSig: MINE, artSig: 'nope' } }, { page: { htmlSig: PAGE_V3 }, card: { themeSig: '../x' } })
    expect(plan).toEqual({ page: { htmlSig: PAGE_V3 }, card: { dataSig: MINE } })
  })
})

describe('parseCardArgs', () => {
  it('reads every form', () => {
    expect(parseCardArgs('')).toEqual({ target: '', verb: '', template: '' })
    expect(parseCardArgs('jaime-weise')).toEqual({ target: 'jaime-weise', verb: '', template: '' })
    expect(parseCardArgs('wear business-card/template/graphite')).toEqual({ target: '', verb: 'wear', template: 'business-card/template/graphite' })
    expect(parseCardArgs('jaime-weise wear /jaime-weise/business-card/template')).toEqual({ target: 'jaime-weise', verb: 'wear', template: '/jaime-weise/business-card/template' })
    expect(parseCardArgs('wear')).toEqual({ target: '', verb: 'wear', template: '' })
  })
  it('refuses anything else', () => {
    expect(parseCardArgs('a b')).toEqual({ error: 'unknown' })
    expect(parseCardArgs('a b wear c')).toEqual({ error: 'unknown' })
    expect(parseCardArgs('wear a b')).toEqual({ error: 'unknown' })
  })
})

describe('routeFrom', () => {
  it('is relative to where you stand, or from the root with a leading slash', () => {
    expect(routeFrom(['jaime-weise'], 'business-card/template/graphite')).toEqual(['jaime-weise', 'business-card', 'template', 'graphite'])
    expect(routeFrom(['somewhere'], '/jaime-weise/business-card/template')).toEqual(['jaime-weise', 'business-card', 'template'])
    expect(routeFrom([], '')).toEqual([])
  })
})
