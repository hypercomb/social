import { describe, expect, it } from 'vitest'
import { participantAiHostConfiguredFor } from './assistant-chat-config.js'

describe('participant AI host configuration', () => {
  it('does not mistake an absent/default host for participant configuration', () => {
    expect(participantAiHostConfiguredFor(null)).toBe(false)
    expect(participantAiHostConfiguredFor('')).toBe(false)
    expect(participantAiHostConfiguredFor('   ')).toBe(false)
  })

  it('accepts an explicitly stored host', () => {
    expect(participantAiHostConfiguredFor('ai.example.com')).toBe(true)
    expect(participantAiHostConfiguredFor(' localhost:8787 ')).toBe(true)
  })
})
