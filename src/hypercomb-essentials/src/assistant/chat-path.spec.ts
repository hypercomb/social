import { describe, expect, it } from 'vitest'
import { chatPathCompletions, chatPathOf } from './chat-path.js'

describe('chat path', () => {
  it('takes a path and leaves a sentence alone', () => {
    expect(chatPathOf('/work/press-kit')).toBe('/work/press-kit')
    expect(chatPathOf('/')).toBe('/')
    expect(chatPathOf('What is TypeScript?')).toBeNull()
    expect(chatPathOf('/work tell me about this')).toBeNull()
    expect(chatPathOf('/work/')).toBeNull()
  })

  it('completes existing conversation paths', () => {
    const paths = ['/work', '/work/press-kit', '/other', '/work']
    expect(chatPathCompletions('/wo', paths)).toEqual(['/work', '/work/press-kit'])
    expect(chatPathCompletions('What', paths)).toEqual([])
    expect(chatPathCompletions('/', paths)).toEqual(['/other', '/work', '/work/press-kit'])
  })
})
