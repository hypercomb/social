import { describe, expect, it } from 'vitest'
import { parseTargetedKeywordsInput } from './targeted-keywords-input'

describe('targeted keyword input', () => {
  it('parses a tile and transcript', () => {
    expect(parseTargetedKeywordsInput('meeting@keywords launch date and mobile reader')).toEqual({
      target: 'meeting',
      transcript: 'launch date and mobile reader',
    })
  })

  it('allows an empty transcript so the review can collect live recording text', () => {
    expect(parseTargetedKeywordsInput('meeting@KEYWORDS')).toEqual({
      target: 'meeting',
      transcript: '',
    })
  })

  it('does not hijack normal feature or email input', () => {
    expect(parseTargetedKeywordsInput('meeting@slides')).toBeNull()
    expect(parseTargetedKeywordsInput('person@example.com')).toBeNull()
  })
})

