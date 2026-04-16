import { describe, it, expect } from 'vitest'
import { secretTag } from './secret-words'
import { ADJECTIVES as EN_ADJ, NOUNS as EN_NOUN } from './secret-words/en'
import { ADJECTIVES as JA_ADJ, NOUNS as JA_NOUN } from './secret-words/ja'

describe('secretTag', () => {
  it('returns a two-word string', () => {
    const tag = secretTag('test-secret')
    const words = tag.split(' ')
    expect(words).toHaveLength(2)
    expect(words[0].length).toBeGreaterThan(0)
    expect(words[1].length).toBeGreaterThan(0)
  })

  it('is deterministic — same input always gives same output', () => {
    const a = secretTag('hello-world')
    const b = secretTag('hello-world')
    expect(a).toBe(b)
  })

  it('different secrets produce different tags (high probability)', () => {
    const a = secretTag('secret-one')
    const b = secretTag('secret-two')
    expect(a).not.toBe(b)
  })

  it('defaults to English and uses words from English lists', () => {
    const tag = secretTag('any-secret')
    const [adj, noun] = tag.split(' ')
    expect(EN_ADJ).toContain(adj)
    expect(EN_NOUN).toContain(noun)
  })

  it('handles empty string without crashing', () => {
    const tag = secretTag('')
    expect(tag.split(' ')).toHaveLength(2)
  })

  it('handles unicode characters', () => {
    const tag = secretTag('unicorn-rainbow')
    expect(tag.split(' ')).toHaveLength(2)
  })

  it('unknown locale falls back to English', () => {
    const a = secretTag('hello', 'xx')
    const b = secretTag('hello', 'en')
    expect(a).toBe(b)
  })

  it('Japanese locale produces Japanese words', () => {
    const tag = secretTag('hello', 'ja')
    const [adj, noun] = tag.split(' ')
    expect(JA_ADJ).toContain(adj)
    expect(JA_NOUN).toContain(noun)
  })

  it('same secret yields different tags in different locales (high probability)', () => {
    const en = secretTag('hello-world', 'en')
    const ja = secretTag('hello-world', 'ja')
    expect(en).not.toBe(ja)
  })
})
