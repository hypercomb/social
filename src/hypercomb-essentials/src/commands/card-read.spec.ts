// commands/card-read.spec.ts — the card at a head: its card:data record and the card it names.
import { describe, it, expect } from 'vitest'
import { cardAtHead, type CardReadIo } from './card-read.js'
import { CARD_DATA_KIND, CARD_PAGE_KIND } from './card-wear.js'

const s = (c: string) => c.repeat(64)
const HEAD = s('1'), PAGE_REC = s('2'), CARD_REC = s('3'), DATA = s('4'), THEME = s('5')

const ioOf = (layers: Record<string, unknown>, resources: Record<string, unknown>): CardReadIo => {
  const bytes = (v: unknown) => v === undefined ? null : new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v))
  return { layer: async sig => bytes(layers[sig]), resource: async sig => bytes(resources[sig]) }
}
const card = { v: 1, n: 'Jaime Weise', t: 'Technical Visionary' }

describe('cardAtHead', () => {
  it('finds the card:data record among the decorations and reads the card it names', async () => {
    const io = ioOf({ [HEAD]: { decorations: [PAGE_REC, CARD_REC] } }, {
      [PAGE_REC]: { kind: CARD_PAGE_KIND, payload: { htmlSig: s('9') } },
      [CARD_REC]: { kind: CARD_DATA_KIND, payload: { dataSig: DATA, themeSig: THEME } },
      [DATA]: JSON.stringify(card),
    })
    expect(await cardAtHead(HEAD, io)).toEqual({ dataSig: DATA, text: JSON.stringify(card), themeSig: THEME, artSig: undefined })
  })

  it('has no card when the head wears no card:data', async () => {
    const io = ioOf({ [HEAD]: { decorations: [PAGE_REC] } }, { [PAGE_REC]: { kind: CARD_PAGE_KIND, payload: {} } })
    expect(await cardAtHead(HEAD, io)).toBeNull()
  })

  it('has no card when the head cannot be read', async () => {
    expect(await cardAtHead(HEAD, ioOf({}, {}))).toBeNull()
  })

  it('skips a record whose card is not an object', async () => {
    const io = ioOf({ [HEAD]: { decorations: [CARD_REC] } }, { [CARD_REC]: { kind: CARD_DATA_KIND, payload: { dataSig: DATA } }, [DATA]: '[1,2]' })
    expect(await cardAtHead(HEAD, io)).toBeNull()
  })
})
