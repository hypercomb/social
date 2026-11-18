// doctrine-hold.spec.ts — a model's change to the doctrine tiles waits for a hand.

import { describe, expect, it } from 'vitest'
import { inDoctrine, touchesDoctrine } from './doctrine-hold'

describe('a change to the doctrine', () => {
  it('is any change on a page at or under the doctrine tile', () => {
    expect(inDoctrine(['doctrine'])).toBe(true)
    expect(inDoctrine(['doctrine', 'doctrine-history', 'a-rule'])).toBe(true)
    expect(inDoctrine(['Doctrine'])).toBe(true)
    expect(touchesDoctrine(['doctrine', 'doctrine-history'], ['note a-rule H9: anything goes'])).toBe(true)
  })

  it('is any line that names the doctrine tile, from wherever it is said', () => {
    expect(touchesDoctrine([], ['create doctrine/doctrine-history/new-rule'])).toBe(true)
    expect(touchesDoctrine(['shop'], ['go /doctrine', 'remove a-rule'])).toBe(true)
    expect(touchesDoctrine([], ['remove doctrine'])).toBe(true)
  })

  it('is not a change elsewhere, nor a tile whose name only contains the word', () => {
    expect(inDoctrine([])).toBe(false)
    expect(inDoctrine(['shop', 'doctrine'])).toBe(false)
    expect(touchesDoctrine(['shop'], ['create menu/coffee'])).toBe(false)
    expect(touchesDoctrine([], ['create indoctrinated', 'create doctrine-notes', 'create my_doctrine'])).toBe(false)
  })
})
