// meeting/meeting-picture.spec.ts — a face only where a picture is.
import { describe, expect, it, vi } from 'vitest'
import { showsPicture, watchPicture } from './meeting-picture.js'

const track = (over: Partial<{ readyState: string; enabled: boolean; muted: boolean }> = {}) => {
  const t = new EventTarget() as EventTarget & { kind: string; readyState: string; enabled: boolean; muted: boolean }
  Object.assign(t, { kind: 'video', readyState: 'live', enabled: true, muted: false }, over)
  return t
}
const stream = (...videos: ReturnType<typeof track>[]) =>
  ({ getVideoTracks: () => videos }) as unknown as MediaStream

describe('is there a picture', () => {
  it('only for a live, enabled, unmuted video track', () => {
    expect(showsPicture(stream(track()))).toBe(true)
    expect(showsPicture(stream(track({ muted: true })))).toBe(false)
    expect(showsPicture(stream(track({ enabled: false })))).toBe(false)
    expect(showsPicture(stream(track({ readyState: 'ended' })))).toBe(false)
    expect(showsPicture(stream())).toBe(false)
    expect(showsPicture(null)).toBe(false)
  })

  it('hears a camera come on and go off, once per track', () => {
    const v = track({ muted: true })
    const changed = vi.fn()
    watchPicture(stream(v), changed)
    watchPicture(stream(v), changed)
    v.dispatchEvent(new Event('unmute'))
    v.dispatchEvent(new Event('mute'))
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
