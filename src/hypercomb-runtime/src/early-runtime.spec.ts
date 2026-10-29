import { describe, expect, it } from 'vitest'
import { earlyRuntimeUrl, isDebugRequest, parseRuntimePin, READABLE_RUNTIME_URL } from './early-runtime'

const SIG = 'ab'.repeat(32)

describe('early runtime', () => {
  it('a normal request takes the minified runtime from the shared heap', () => {
    expect(isDebugRequest('revolucion.jwize.com', false)).toBe(false)
    expect(earlyRuntimeUrl(SIG, false)).toBe(`/content/${SIG}`)
  })

  it('a debug request keeps the readable runtime', () => {
    expect(isDebugRequest('revolucion.jwize.com', true)).toBe(true)
    expect(isDebugRequest('try-review.jwize.com', false)).toBe(true)
    expect(isDebugRequest('try-review.localhost:4270', false)).toBe(true)
    expect(earlyRuntimeUrl(SIG, true)).toBeNull()
    expect(READABLE_RUNTIME_URL).toBe('/hypercomb-core.runtime.js')
  })

  it('a missing or broken pin keeps the readable runtime', () => {
    expect(earlyRuntimeUrl('', false)).toBeNull()
    expect(earlyRuntimeUrl('not-a-sig', false)).toBeNull()
    expect(parseRuntimePin(`${SIG}\n`)).toBe(SIG)
    expect(parseRuntimePin('<!doctype html>')).toBeNull()
    expect(parseRuntimePin('')).toBeNull()
  })
})
