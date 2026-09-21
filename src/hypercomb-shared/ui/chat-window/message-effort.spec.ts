import { describe, expect, it } from 'vitest'
import { contextNeedFor, effortFor, effortFromJev, effortInThread } from './message-effort'

describe('how much work a message is', () => {
  it('keeps a short question fast', () => {
    expect(effortFor('what is on this page?')).toBe('fast')
    expect(effortFor('who made the roadmap tile')).toBe('fast')
  })

  it('makes a short change balanced', () => {
    expect(effortFor('add a tile called roadmap')).toBe('balanced')
    expect(effortFor('rename drafts to archive')).toBe('balanced')
  })

  it('makes planning, long, or multi-line work deep', () => {
    expect(effortFor('plan the next release and break it apart into tiles')).toBe('deep')
    expect(effortFor('please analyse how these projects relate')).toBe('deep')
    expect(effortFor('first this\nthen that\nand finally the other')).toBe('deep')
    expect(effortFor('x'.repeat(700))).toBe('deep')
  })

  it('estimates the tokens a request must hold, with room for the reply', () => {
    expect(contextNeedFor(4_000, 'hi')).toBe(Math.ceil(16_002 / 4) + 4_096)
    expect(contextNeedFor(-5, '')).toBe(3_000 + 4_096)
  })
})

describe('the weight of a message in a conversation', () => {
  it('moves up when a question gets harder and down when it gets simpler', () => {
    expect(effortInThread('plan the next release and break it apart into tiles', 'fast')).toBe('deep')
    expect(effortInThread('what is on this page?', 'deep')).toBe('fast')
    expect(effortInThread('rename drafts to archive', 'deep')).toBe('balanced')
  })

  it('keeps the level of the thread for a short follow-up, and never lowers it', () => {
    expect(effortInThread('why?', 'deep')).toBe('deep')
    expect(effortInThread('go on', 'balanced')).toBe('balanced')
    expect(effortInThread('yes', 'deep')).toBe('deep')
    expect(effortInThread('and analyse the rest too', 'fast')).toBe('deep')
  })

  it('weighs a first message on its own', () => {
    expect(effortInThread('why is the sky blue?', undefined)).toBe(effortFor('why is the sky blue?'))
  })
})

describe('the weight Jev read', () => {
  it('replaces the word list when Jev is sure, in any language', () => {
    expect(effortFromJev(effortInThread('今週の計画を立てて', undefined), { weight: 'deep', carry: false }, undefined)).toBe('deep')
    expect(effortFromJev('deep', { weight: 'fast', carry: false }, 'deep')).toBe('fast')
  })
  it('leaves the word list standing when Jev is unsure', () => {
    expect(effortFromJev('balanced', { carry: false }, 'deep')).toBe('balanced')
  })
  it('never drops below the thread for a request that only continues it', () => {
    expect(effortFromJev('fast', { weight: 'fast', carry: true }, 'deep')).toBe('deep')
    expect(effortFromJev('fast', { weight: 'deep', carry: true }, 'balanced')).toBe('deep')
    expect(effortFromJev('fast', { weight: 'fast', carry: true }, undefined)).toBe('fast')
  })
})
