import { describe, expect, it } from 'vitest'
import { TagAssignBehavior, parseTags } from './tag-assign.behavior'

const enter = { key: 'Enter', shiftKey: false } as KeyboardEvent

describe('parseTags', () => {
  it('reads one tag, with or without a colour', () => {
    expect(parseTags('work')).toEqual([{ name: 'work' }])
    expect(parseTags('work(#4caf50)')).toEqual([{ name: 'work', color: '#4caf50' }])
  })

  it('reads a list, keeping a comma inside a colour whole', () => {
    expect(parseTags('[a, b(1,2,3), c]')).toEqual([{ name: 'a' }, { name: 'b', color: '1,2,3' }, { name: 'c' }])
  })

  it('drops empty items', () => {
    expect(parseTags('[a, , b]')).toEqual([{ name: 'a' }, { name: 'b' }])
  })
})

describe('TagAssignBehavior.match', () => {
  const tag = new TagAssignBehavior()

  it('takes a tag list after the colon', () => {
    expect(tag.match(enter, 'name:[a, b]')).toBe(true)
    expect(tag.match(enter, 'name:a')).toBe(true)
  })

  it('leaves a bracketed name to the list-of-tiles syntax', () => {
    expect(tag.match(enter, '[a, b]:tag')).toBe(false)
    expect(tag.match(enter, 'name:[a, b] extra')).toBe(false)
  })
})
