import { describe, expect, it } from 'vitest'
import { foldPeerRoots, participantColor, type SwarmNote } from './swarm-notes.js'

const note = (id: string, text = id): SwarmNote => ({ id, text, shape: null, mark: null, tags: [], children: [] })
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const ANA = '1'.repeat(64)
const BEN = '2'.repeat(64)

describe('foldPeerRoots', () => {
  it('one note held by many peers is one root with every holder', () => {
    const { roots } = foldPeerRoots([], [
      { pubkey: ANA, notes: [note(A)] },
      { pubkey: BEN, notes: [note(A)] },
    ], new Map())
    expect(roots).toHaveLength(1)
    expect(roots[0].holders).toEqual([ANA, BEN])
    expect(roots[0].by).toBe(ANA)
  })

  it('a note you hold is yours, not a peer root — its other holders are reported', () => {
    const { roots, heldMine } = foldPeerRoots([A], [{ pubkey: BEN, notes: [note(A), note(B)] }], new Map())
    expect(roots.map(r => r.note.id)).toEqual([B])
    expect(heldMine.get(A)).toEqual([BEN])
  })

  it('a note keeps the colour of who brought it while they are here', () => {
    const first = new Map<string, string>()
    foldPeerRoots([], [{ pubkey: ANA, notes: [note(A)] }], first)
    const { roots } = foldPeerRoots([], [{ pubkey: BEN, notes: [note(A)] }, { pubkey: ANA, notes: [note(A)] }], first)
    expect(roots[0].by).toBe(ANA)
    // Ana left; Ben still holds it — it is his to show now.
    const later = foldPeerRoots([], [{ pubkey: BEN, notes: [note(A)] }], first)
    expect(later.roots[0].by).toBe(BEN)
  })
})

describe('participantColor', () => {
  it('is deterministic per participant and the house colour for you', () => {
    expect(participantColor(ANA)).toBe(participantColor(ANA))
    expect(participantColor(ANA)).not.toBe(participantColor(BEN))
    expect(participantColor('')).toBe('rgb(126, 182, 214)')
  })
})
