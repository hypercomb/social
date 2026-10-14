import { describe, expect, it } from 'vitest'
import { foldNoteLines, participantColor, type NoteLineInput } from './note-lines.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const ALICE = '1'.repeat(64)
const BOB = '2'.repeat(64)

const input = (over: Partial<NoteLineInput>): NoteLineInput => ({
  own: [], peers: [], firstSeen: new Map(), firstHolder: new Map(),
  texts: new Map(), peopleHere: 0, now: 1000, ...over,
})

describe('foldNoteLines', () => {
  it('one note held by many is one line with every holder', () => {
    const { lines, counts } = foldNoteLines(input({
      peers: [{ sig: A, peerPubkey: ALICE }, { sig: A, peerPubkey: BOB }],
      peopleHere: 2,
    }))
    expect(lines).toHaveLength(1)
    expect(lines[0].holders).toEqual([ALICE, BOB])
    expect(counts).toEqual({ people: 3, lines: 1, mine: 0, open: 1 })
  })

  it('a line keeps its place and its first holder across reads', () => {
    const firstSeen = new Map<string, number>()
    const firstHolder = new Map<string, string>()
    foldNoteLines(input({ peers: [{ sig: A, peerPubkey: ALICE }], firstSeen, firstHolder, now: 1 }))
    foldNoteLines(input({ own: [B], peers: [{ sig: A, peerPubkey: ALICE }], firstSeen, firstHolder, now: 2 }))
    // Alice leaves after I took her line: it stays hers in colour, mine in hand.
    const { lines } = foldNoteLines(input({ own: [B, A], firstSeen, firstHolder, now: 3 }))
    expect(lines.map(l => l.sig)).toEqual([A, B])
    expect(lines[0].holders).toEqual([''])
    expect(lines[0].by).toBe(ALICE)
    expect(lines.every(l => l.mine)).toBe(true)
  })

  it('own notes arrive in their own order, texts fill in when known', () => {
    const { lines, counts } = foldNoteLines(input({
      own: [C, A], texts: new Map([[A, 'mitochondria = powerhouse']]),
    }))
    expect(lines.map(l => l.sig)).toEqual([C, A])
    expect(lines[0].text).toBeNull()
    expect(lines[1].text).toBe('mitochondria = powerhouse')
    expect(counts).toEqual({ people: 1, lines: 2, mine: 2, open: 0 })
  })
})

describe('participantColor', () => {
  it('is deterministic per participant and distinct for this one', () => {
    expect(participantColor(ALICE)).toBe(participantColor(ALICE))
    expect(participantColor(ALICE)).not.toBe(participantColor(BOB))
    expect(participantColor('')).toBe('rgb(126, 182, 214)')
  })
})
