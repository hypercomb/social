import { describe, expect, it } from 'vitest'
import { keyBelongsElsewhere } from './key-owner.js'

const deepseek = { id: 'deepseek', label: 'DeepSeek', keyPattern: /^sk-[A-Za-z0-9]{20,}$/ }
const openrouter = { id: 'openrouter', label: 'OpenRouter', keyPattern: /^sk-or-v1-[A-Za-z0-9]{32,}$/ }
const custom = { id: 'custom', label: 'Custom', keyPattern: undefined }
const all = [deepseek, openrouter, custom]

const OPENROUTER_KEY = `sk-or-v1-${'a1'.repeat(32)}`
const DEEPSEEK_KEY = `sk-${'b2'.repeat(16)}`

describe('whose key is this', () => {
  it('names OpenRouter when its key is pasted on the DeepSeek row', () => {
    expect(keyBelongsElsewhere(OPENROUTER_KEY, deepseek, all)?.label).toBe('OpenRouter')
  })

  it('stays quiet when the key fits the row it was pasted on', () => {
    expect(keyBelongsElsewhere(OPENROUTER_KEY, openrouter, all)).toBeUndefined()
    expect(keyBelongsElsewhere(DEEPSEEK_KEY, deepseek, all)).toBeUndefined()
  })

  it('stays quiet for a key nobody recognises, or a row with no declared format', () => {
    expect(keyBelongsElsewhere('not-a-key-at-all', deepseek, all)).toBeUndefined()
    expect(keyBelongsElsewhere(OPENROUTER_KEY, custom, all)).toBeUndefined()
    expect(keyBelongsElsewhere('   ', deepseek, all)).toBeUndefined()
  })
})
