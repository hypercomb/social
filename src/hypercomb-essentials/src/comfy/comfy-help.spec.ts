import { describe, expect, it } from 'vitest'
import {
  clampReviewers,
  helpedPrompt,
  parsePromptOption,
  pictureReading,
  promptFromChoice,
  reviewerAsks,
  tileBriefText,
  withOwnWords,
} from './comfy-help.js'

const sig = 'a'.repeat(64)

describe('from the tile', () => {
  it('keeps the reviewer count between one and eight', () => {
    expect(clampReviewers(undefined)).toBe(3)
    expect(clampReviewers(0)).toBe(1)
    expect(clampReviewers(4.2)).toBe(4)
    expect(clampReviewers(40)).toBe(8)
  })

  it('tells a reviewer the tile\'s words and not its picture signatures', () => {
    const brief = tileBriefText('lantern', {
      large: { image: sig },
      imageSig: sig,
      tags: ['fog', 'dusk'],
      note: 'hung at the gate',
      count: 2,
    }, 'Picture: 8 by 8, dark, mostly #303070.')
    expect(brief).toContain('Tile: lantern')
    expect(brief).toContain('Picture: 8 by 8, dark, mostly #303070.')
    expect(brief).toContain('tags: fog, dusk')
    expect(brief).toContain('note: hung at the gate')
    expect(brief).toContain('count: 2')
    expect(brief).not.toContain(sig)
  })

  it('reads a dark blue picture from its pixels', () => {
    const px = [32, 48, 96, 255, 32, 48, 96, 255, 32, 48, 96, 255, 32, 48, 96, 255]
    expect(pictureReading(2, 2, px)).toBe('Picture: 2 by 2, dark, mostly #303070.')
  })

  it('takes the prompt out of a fenced answer', () => {
    expect(parsePromptOption('```\nPrompt: "a lantern in fog"\n```')).toBe('a lantern in fog')
  })

  it('keeps the participant\'s words in the prompt', () => {
    expect(withOwnWords('a brass lantern', 'in fog')).toBe('a brass lantern\nin fog')
    expect(withOwnWords('a lantern in fog', 'in fog')).toBe('a lantern in fog')
  })

  it('uses the option Jev picked, and the participant\'s words when Jev declines', () => {
    expect(promptFromChoice('in fog', ['one', 'two'], 1)).toBe('two\nin fog')
    expect(promptFromChoice('in fog', ['one'], -2)).toBe('in fog')
    expect(promptFromChoice('', ['one', 'two'], -1)).toBe('one')
  })

  it('asks Jev over the options the reviewers actually wrote', async () => {
    const seen: string[][] = []
    const prompt = await helpedPrompt({
      own: 'in fog',
      brief: 'Tile: lantern',
      reviewers: 2,
      propose: async ask => ask.stance.startsWith('Stay') ? 'Prompt: a lantern' : 'a gate in fog',
      choose: async options => { seen.push([...options]); return 1 },
    })
    expect(reviewerAsks(2, 'Tile: lantern', 'in fog')).toHaveLength(2)
    expect(seen).toEqual([['a lantern', 'a gate in fog']])
    expect(prompt).toBe('a gate in fog')
  })
})
