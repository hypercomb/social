// work-instruction.undone.spec.ts — A CHANGE ASKED FOR, AND A TURN THAT ENDS
// WITH NOTHING READ AND NOTHING RUN.
//
// The managed card page, 2026-11-15. One conversation, one model, six turns:
// four ended on a sentence about what it was going to do, with no block. And
// a question about the page ("How does the Update button on this page find
// out …?") was answered in full, then pushed to "write the change now".

import { describe, expect, it } from 'vitest'
import { leavesChangeUndone, onlyAsks, undoneChangeMessage } from './work-instruction.js'

describe('a question is not a request to change', () => {
  it('a message that opens as a question only asks', () => {
    expect(onlyAsks('How does the Update button on this page find out there is a newer package? Answer from the source code, and name the file and the function.')).toBe(true)
    expect(onlyAsks('What does my role line say?')).toBe(true)
    expect(onlyAsks('Should I change the title?')).toBe(true)
  })

  it('asking for the work is not only asking', () => {
    expect(onlyAsks('Can you change my role to Owner?')).toBe(false)
    expect(onlyAsks('Could you update the page?')).toBe(false)
    expect(onlyAsks('What is on the card? Please add my phone number.')).toBe(false)
    expect(onlyAsks('Change my role line to say "Founder and builder".')).toBe(false)
    expect(onlyAsks('')).toBe(false)
  })
})

describe('told to change, and nothing was read or run', () => {
  const stalled = [
    ['On my business card, change my role line to say "Founder and builder".', "Reading the card's current records first so I can write the change accurately."],
    ['Actually, put my role back to "Owner".', "Reading the card's current details again this turn before writing."],
    ['You did not read or change anything. Put my role back to "Owner".', "You're right — I claimed changes before the hive reported them. Let me actually do it: read the card's current details this turn, then write."],
    ['I changed my mind. Take the questions tile back off my card so the card is exactly as it was before.', 'The cleanest way is one undo step.'],
    ['It is still there. Please actually remove it.', 'Time to look at the page as it is.'],
  ] as const

  it('is seen however the model words it', () => {
    for (const [request, answer] of stalled) expect(leavesChangeUndone(answer, request), answer).toBe(true)
  })

  it('leaves a reply that declines, or asks the participant, alone', () => {
    expect(leavesChangeUndone('I cannot remove it: the tile is not on this page.', 'Remove the questions tile.')).toBe(false)
    expect(leavesChangeUndone('The role line already says Owner.', 'Put my role back to "Owner".')).toBe(false)
    expect(leavesChangeUndone('Which tile do you mean, style or animation?', 'Remove the tile.')).toBe(false)
  })

  it('says nothing when the message did not tell the hive to change anything', () => {
    expect(leavesChangeUndone('You are welcome.', 'Thanks, that set looks great.')).toBe(false)
    expect(leavesChangeUndone('The scout checks twelve seconds after load.', 'How does the Update button on this page find out there is a newer package?')).toBe(false)
    expect(leavesChangeUndone('It reads Owner.', 'Tell me what the change was.')).toBe(false)
  })

  it('the correction names the three blocks and carries the request', () => {
    const said = undoneChangeMessage('Put my role back to "Owner".')
    expect(said).toContain('hypercomb-read')
    expect(said).toContain('hypercomb-do')
    expect(said).toContain('hypercomb-write')
    expect(said).toContain('Put my role back')
  })
})
