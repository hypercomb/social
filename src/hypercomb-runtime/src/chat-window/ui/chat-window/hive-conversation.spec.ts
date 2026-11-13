import { describe, expect, it } from 'vitest'
import { hiveConversationMove } from './hive-conversation'

describe('hive conversation move', () => {
  it('arms the tile you go into, and names that same tile on the way back', () => {
    expect(hiveConversationMove(['work'], ['work', 'press-kit'])).toEqual({
      kind: 'enter', segments: ['work', 'press-kit'],
    })
    expect(hiveConversationMove(['work', 'press-kit'], ['work'])).toEqual({
      kind: 'back', segments: ['work', 'press-kit'],
    })
  })

  it('leaves a click, a jump, and a repeat alone', () => {
    expect(hiveConversationMove(['work'], ['work']).kind).toBe('same')
    expect(hiveConversationMove([], ['work', 'press-kit']).kind).toBe('same')
    expect(hiveConversationMove(['work', 'press-kit'], ['other']).kind).toBe('same')
  })
})
