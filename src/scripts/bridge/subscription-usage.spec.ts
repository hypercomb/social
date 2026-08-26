import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { normalizeWindow } = require('./subscription-usage.cjs') as {
  normalizeWindow: (label: string, value: unknown) => {
    label: string; remainingPercent: number; resetsAt?: number; durationMinutes?: number
  } | null
}

describe('subscription usage normalization', () => {
  it('turns used percent into bounded remaining headroom', () => {
    expect(normalizeWindow('Weekly', { usedPercent: 27.4, resetsAt: 123, windowDurationMins: 10_080 }))
      .toEqual({ label: 'Weekly', remainingPercent: 72.6, resetsAt: 123, durationMinutes: 10_080 })
    expect(normalizeWindow('Session', { usedPercent: 140 })?.remainingPercent).toBe(0)
  })
})
