// notes/swarm-notes.conceal.spec.ts — the seam a game uses to ask the notes desk
// to show the words and not who brought them (SwarmNotes.concealAuthorsWhen /
// authorsHidden). Outside a swarm the room holds nothing, so the answer is
// decided by the rule and the notes you hold, which is what is pinned here.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../sharing/membership.js', () => ({ isJoinedHere: () => false }))

import { SwarmNotes } from './swarm-notes.service.js'

beforeEach(() => {
  ;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined, whenReady: () => undefined, register: () => undefined }
})

describe('authors are shown unless a game asks to hide them', () => {
  it('hides nothing while no rule is registered', () => {
    const notes = new SwarmNotes()
    expect(notes.authorsHidden('anything', ['a note'])).toBe(false)
  })

  it('hides what a registered rule says to hide, from the cell and the texts it is given', () => {
    const notes = new SwarmNotes()
    const rule = vi.fn((cell: string, texts: readonly string[]) => cell === 'the-game' && !texts.includes('revealed'))
    notes.concealAuthorsWhen(rule)
    expect(notes.authorsHidden('the-game', ['an idea'])).toBe(true)
    expect(notes.authorsHidden('the-game', ['an idea', 'revealed'])).toBe(false)
    expect(notes.authorsHidden('another-tile', ['an idea'])).toBe(false)
    expect(rule).toHaveBeenCalledWith('the-game', ['an idea'])
  })

  it('hides when any one of several rules says to', () => {
    const notes = new SwarmNotes()
    notes.concealAuthorsWhen(() => false)
    notes.concealAuthorsWhen((cell) => cell === 'second-game')
    expect(notes.authorsHidden('second-game', [])).toBe(true)
    expect(notes.authorsHidden('first-game', [])).toBe(false)
  })

  it('a rule that throws hides nothing: a broken game never blanks the desk\'s names', () => {
    const notes = new SwarmNotes()
    notes.concealAuthorsWhen(() => { throw new Error('a bad rule') })
    expect(notes.authorsHidden('the-game', [])).toBe(false)
  })

  it('registering the same rule twice is one rule, and registering tells the desk to repaint', () => {
    const notes = new SwarmNotes()
    // A rule that answers no is asked every time it is in the list: once, if it was kept once.
    const rule = vi.fn(() => false)
    const changed = vi.fn()
    notes.addEventListener('change', changed)
    notes.concealAuthorsWhen(rule)
    notes.concealAuthorsWhen(rule)
    notes.authorsHidden('x', [])
    expect(rule).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })
})
