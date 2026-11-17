// chat-revisions.spec.ts — a conversation belongs to the revision it was
// held in: read from the site's build records and the conversation's own
// times, with nothing stamped on the conversation.

import { describe, expect, it } from 'vitest'
import { beganAt, conversationInLine } from './chat-revisions.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const record = (label: string, seal: number, at: number) => ({ seal: sig(seal), label, at })
const T0 = 1_780_000_000_000

// red saved at +100 and +200, blue started at +300, red opened again at +500.
const records = [
  record('red theme', 1, T0 + 100), record('red theme', 2, T0 + 200),
  record('blue theme', 3, T0 + 300), record('red theme', 2, T0 + 500),
]
const inBlue = records.slice(0, 3)

describe('when a conversation began', () => {
  it('is its first turn, else the moment its id was minted, else unknown', () => {
    expect(beganAt({ convoId: 'chat:tile:/card', startedAt: T0 + 5 })).toBe(T0 + 5)
    expect(beganAt({ convoId: `chat:tile:/card::${T0 + 7}-ab12cd` })).toBe(T0 + 7)
    expect(beganAt({ convoId: 'chat:tile:/card' })).toBe(0)
    expect(beganAt({ convoId: 'chat:tile:/card::external-jev-lx2' })).toBe(0)
  })
})

describe('the conversations of the revision in hand', () => {
  it('is every conversation while nothing has been saved', () => {
    expect(conversationInLine([], { convoId: 'chat:tile:/card', startedAt: 5 })).toBe(true)
  })

  it('gives the first line the work done before the first save', () => {
    const early = { convoId: 'chat:tile:/card', startedAt: T0 + 10, lastAt: T0 + 90 }
    expect(conversationInLine(records, early)).toBe(true)
    expect(conversationInLine(inBlue, early)).toBe(false)
  })

  it('keeps a conversation with the line it was held in', () => {
    const blue = { convoId: `chat:tile:/card::${T0 + 350}-aaaaaa`, startedAt: T0 + 360, lastAt: T0 + 400 }
    expect(conversationInLine(inBlue, blue)).toBe(true)
    expect(conversationInLine(records, blue)).toBe(false)
  })

  it('a conversation carried on into a new line belongs to both', () => {
    const carried = { convoId: 'chat:tile:/card', startedAt: T0 + 150, lastAt: T0 + 420 }
    expect(conversationInLine(inBlue, carried)).toBe(true)
    expect(conversationInLine(records, carried)).toBe(true)
  })

  it('a conversation nobody has spoken in belongs to the line in hand', () => {
    expect(conversationInLine(inBlue, { convoId: 'chat:tile:/card' })).toBe(true)
    // A fresh one is placed by the moment its id was minted.
    expect(conversationInLine(inBlue, { convoId: `chat:tile:/card::${T0 + 150}-bbbbbb` })).toBe(false)
    expect(conversationInLine(inBlue, { convoId: `chat:tile:/card::${T0 + 900}-cccccc` })).toBe(true)
  })
})
