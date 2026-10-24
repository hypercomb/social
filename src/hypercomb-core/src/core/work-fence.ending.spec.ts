// work-fence.ending.spec.ts — HOW A REPLY ENDS (documentation/conversation-continuity.md).
//
// jwize, 2026-10-24: "sometimes the conversations just say they are going to
// wait or do something but they are finished already." The turn's end reads
// how the reply closes, so a promise becomes work still owed and a wait on the
// participant becomes "waiting on you" — never an answer that does nothing.

import { describe, expect, it } from 'vitest'
import { turnEnding } from './work-fence.js'

describe('a reply that ends on a promise', () => {
  it('is read from the closing lines of the last paragraph, however long the reply', () => {
    const long = `${'The two tiles are /people/betz and /dolphin/associates/betz. '.repeat(20)}\n\nNext, I'll update the other tiles.`
    expect(turnEnding(long)).toEqual({ kind: 'promise', step: 'update the other tiles.' })
  })

  it('knows the ways models say it', () => {
    for (const [said, step] of [
      ["I'll check the notes next.", 'check the notes next.'],
      ['I will now read /people.', 'now read /people.'],
      ['Let me look at the children first.', 'look at the children first.'],
      ["Alright, I'm going to file the note.", 'file the note.'],
      ["I'm about to move the tiles.", 'move the tiles.'],
      ["We'll rename it after that.", 'rename it after that.'],
      ['I still need to read /dolphin.', 'read /dolphin.'],
      ["**Next:** I'll add the tiles.", 'add the tiles.'],
      ["Once the read comes back, I'll file the summary.", 'file the summary.'],
      ['- Now I’ll open /games.', 'open /games.'],
    ] as const) {
      expect(turnEnding(`Here is what I found.\n\n${said}`)).toEqual({ kind: 'promise', step })
    }
  })

  it('tells a wait on the participant from a promise of work', () => {
    expect(turnEnding("I'll wait for your go-ahead before removing them.")).toMatchObject({ kind: 'waiting' })
    expect(turnEnding("Once you confirm, I'll remove the three tiles.")).toMatchObject({ kind: 'waiting' })
    expect(turnEnding("I'll wait for the walk to finish.")).toEqual({ kind: 'promise', step: 'wait for the walk to finish.' })
  })

  it('owes nothing for a sign-off', () => {
    for (const said of [
      'Let me know if you want more.',
      "I'll be here if you need anything else.",
      "I'll keep an eye on it.",
      "If you'd like, I can rename them.",
      'Done: both tiles are filed.',
    ]) expect(turnEnding(`Both tiles are filed.\n\n${said}`)).toBeUndefined()
  })

  // The phase-1 review (2026-10-24): each of these started an unwanted leg,
  // and the first ones sent "Continue" for a confirmation never given.
  it('never reads a wait on the participant as a promise', () => {
    for (const said of [
      "Once confirmed, I'll remove the three tiles.",
      "I'll wait for confirmation before removing them.",
      "I'll await your go-ahead.",
      "I'll apply the changes after your approval.",
      "I'll hold off until you reply.",
      "I'll await your confirmation before making changes.",
      "I'll wait until you confirm.",
      "I'll hold off on deleting anything until you confirm.",
      "I'll pause here so you can review the list.",
      "I'll need your API key to go further.",
    ]) expect(turnEnding(`Here is the list.\n\n${said}`)?.kind ?? 'none').toBe('waiting')
  })

  it('owes nothing for a negation, a closer, or a line that introduces a list', () => {
    for (const said of [
      'I will not change anything else.',
      "I'll answer any follow-up questions.",
      "I'll leave the rest to you.",
      "We'll see how it goes.",
      "I'll be waiting.",
      "I'll do whichever you pick.",
      'Let me summarize:\n- created a\n- created b',
      "I'll explain each step below:",
    ]) expect(turnEnding(`Done.\n\n${said}`)).toBeUndefined()
  })

  it('stops reading at "let me know", whatever the line above says', () => {
    expect(turnEnding("I'll add the notes next.\nLet me know if that's OK.")).toBeUndefined()
  })

  it('reads only the last paragraph, and never inside a fence', () => {
    expect(turnEnding("I'll read the tile.\n\nBoth tiles are /people/betz and /dolphin/associates/betz.")).toBeUndefined()
    expect(turnEnding("Here is the plan:\n\n```\nI'll move the tiles.\n```")).toBeUndefined()
  })

  it('says nothing about an empty reply', () => {
    expect(turnEnding('')).toBeUndefined()
    expect(turnEnding('   \n\n  ')).toBeUndefined()
  })
})
