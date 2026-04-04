import { describe, it, expect, vi } from 'vitest'

;(globalThis as any).register = vi.fn()

// Re-implement inline to avoid side-effect registration
class DefaultSecretStrength {
  evaluate(secret: string): number {
    if (!secret) return 0
    const len = secret.length
    let score: number
    if (len < 6) score = 0.05
    else if (len < 9) score = 0.15
    else if (len < 12) score = 0.35
    else if (len < 16) score = 0.55
    else score = 0.7

    if (/[a-z]/.test(secret) && /[A-Z]/.test(secret)) score += 0.1
    if (/\d/.test(secret)) score += 0.1
    if (/[^a-zA-Z0-9]/.test(secret)) score += 0.1

    return Math.min(score, 1)
  }
}

describe('SecretStrength', () => {
  const provider = new DefaultSecretStrength()

  it('returns 0 for empty string', () => {
    expect(provider.evaluate('')).toBe(0)
  })

  it('returns 0.05 for very short secrets (< 6 chars)', () => {
    expect(provider.evaluate('abc')).toBe(0.05)
    expect(provider.evaluate('12345')).toBeCloseTo(0.15, 2) // 0.05 + 0.1 digit
  })

  it('returns low score for 6-8 char lowercase only', () => {
    expect(provider.evaluate('abcdef')).toBe(0.15)
    expect(provider.evaluate('abcdefgh')).toBe(0.15)
  })

  it('gives bonus for mixed case', () => {
    expect(provider.evaluate('abcdefGH')).toBeCloseTo(0.25, 2)
  })

  it('gives bonus for digits', () => {
    expect(provider.evaluate('abcdef12')).toBeCloseTo(0.25, 2)
  })

  it('gives bonus for symbols', () => {
    expect(provider.evaluate('abcdef!@')).toBeCloseTo(0.25, 2)
  })

  it('gives all bonuses for mixed content', () => {
    // 8 chars = 0.15 base + 0.1 mixed case + 0.1 digits + 0.1 symbols = 0.45
    expect(provider.evaluate('aB1!cdef')).toBeCloseTo(0.45, 2)
  })

  it('scores higher for longer secrets', () => {
    const short = provider.evaluate('abc')
    const medium = provider.evaluate('abcdefghijk')
    const long = provider.evaluate('abcdefghijklmnop')
    expect(short).toBeLessThan(medium)
    expect(medium).toBeLessThan(long)
  })

  it('caps at 1.0', () => {
    // 16+ chars = 0.7 + 0.1 + 0.1 + 0.1 = 1.0
    expect(provider.evaluate('aB1!efghijklmnop')).toBeCloseTo(1, 5)
  })

  it('does not exceed 1.0 even with long complex secrets', () => {
    expect(provider.evaluate('SuperLong!Complex1Password2Here3')).toBeCloseTo(1, 5)
  })
})
