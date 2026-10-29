import { describe, expect, it } from 'vitest'
import { askIdeasOf } from './ask-ideas'

describe('composer ideas', () => {
  it('offers a few plain asks when nothing is pending', () => {
    const ideas = askIdeasOf({ state: null, step: '' })
    expect(ideas[0]).toBe('Ask anything.')
    expect(ideas.length).toBeGreaterThan(1)
    expect(ideas.join(' ')).not.toContain('â')
  })

  it('names the open step in one short line', () => {
    const ideas = askIdeasOf({ state: 'steps', step: 'Update website title instead of tile' })
    expect(ideas[0]).toBe('On: Update website title instead of tile')
    expect(ideas.length).toBeGreaterThan(1)
    expect(ideas[0].length).toBeLessThan(56)
  })

  it('tells you what a wait, a budget, and a missing model need', () => {
    expect(askIdeasOf({ state: 'you', step: '' })[0]).toContain('Answer what is waiting')
    expect(askIdeasOf({ state: 'budget', step: '' })[0]).toContain('Say continue')
    expect(askIdeasOf({ state: 'gave-up', step: '' })[0]).toContain('Add a model')
    expect(askIdeasOf({ state: 'unattended', step: '' })).toHaveLength(1)
  })
})
