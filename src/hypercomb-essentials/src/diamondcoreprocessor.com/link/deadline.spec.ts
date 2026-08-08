import { describe, expect, it, vi } from 'vitest'
import { byDeadline } from './deadline.js'

describe('byDeadline', () => {
  it('returns the value when the work answers in time', async () => {
    expect(await byDeadline(async () => 'card', 1000, 'fallback')).toBe('card')
  })

  it('gives up on work that HANGS — the failure that used to park a whole drop', async () => {
    vi.useFakeTimers()
    try {
      const forever = new Promise<string>(() => {})
      const raced = byDeadline(() => forever, 3500, 'fallback')
      await vi.advanceTimersByTimeAsync(3600)
      expect(await raced).toBe('fallback')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts the request it abandoned, so nothing runs on behind the gesture', async () => {
    vi.useFakeTimers()
    try {
      let aborted = false
      const raced = byDeadline((signal) => {
        signal.addEventListener('abort', () => { aborted = true })
        return new Promise<string>(() => {})
      }, 1000, 'fallback')
      await vi.advanceTimersByTimeAsync(1100)
      await raced
      expect(aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a rejection as the fallback, never as a throw', async () => {
    expect(await byDeadline(async () => { throw new Error('blocked') }, 1000, null)).toBeNull()
  })
})
