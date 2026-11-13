import { describe, expect, it } from 'vitest'
import { groupRuns } from './chat-runs.js'

const rows = (...roles: string[]) =>
  roles.map((role, index) => ({ key: `${index}:${role}`, index, turn: { role } }))

const shape = (runs: ReturnType<typeof groupRuns>) =>
  runs.map(run => run.entries.map(entry => entry.index))

describe('groupRuns', () => {
  it('holds contiguous participant messages in one run', () => {
    expect(shape(groupRuns(rows('user', 'user', 'user', 'assistant', 'user'), () => false)))
      .toEqual([[0, 1, 2], [3], [4]])
  })

  it('never joins replies', () => {
    expect(shape(groupRuns(rows('assistant', 'assistant'), () => false))).toEqual([[0], [1]])
  })

  it('starts a new run where a step rule falls between two messages', () => {
    expect(shape(groupRuns(rows('user', 'user', 'user'), index => index === 2)))
      .toEqual([[0, 1], [2]])
  })

  it('keeps the first row\'s key as a run grows, so the block is not rebuilt', () => {
    const before = groupRuns(rows('user'), () => false)
    const after = groupRuns(rows('user', 'user'), () => false)
    expect(after[0]?.key).toBe(before[0]?.key)
  })

  it('marks which runs are the participant\'s', () => {
    expect(groupRuns(rows('user', 'assistant'), () => false).map(run => run.user)).toEqual([true, false])
  })

  it('is empty for an empty thread', () => {
    expect(groupRuns([], () => false)).toEqual([])
  })
})
