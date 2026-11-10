import { describe, expect, it, vi } from 'vitest'
import { PlaybackRetry, liveMicTracks, watchAudioTrack, type GestureHost, type Playable } from './meeting-playback.js'

const track = (kind: string, readyState: string) => ({ kind, readyState })

describe('which microphone tracks a meeting can send', () => {
  it('keeps a live audio track and drops video, ended audio, and anything else', () => {
    const live = track('audio', 'live')
    expect(liveMicTracks([
      track('video', 'live'),
      track('audio', 'ended'),
      live,
      track('audio', 'new'),
    ])).toEqual([live])
  })

  it('is empty when the preview never got a microphone', () => {
    expect(liveMicTracks([track('video', 'live')])).toEqual([])
    expect(liveMicTracks([])).toEqual([])
  })
})

describe('an audio track added to a stream already showing', () => {
  it('plays again for audio only, and stops when the element is gone', () => {
    const stream = new EventTarget()
    const play = vi.fn()
    const stop = watchAudioTrack(stream, play)
    const audio = new Event('addtrack')
    Object.defineProperty(audio, 'track', { value: { kind: 'audio' } })
    const video = new Event('addtrack')
    Object.defineProperty(video, 'track', { value: { kind: 'video' } })
    stream.dispatchEvent(video)
    stream.dispatchEvent(audio)
    expect(play).toHaveBeenCalledOnce()
    stop()
    stream.dispatchEvent(audio)
    expect(play).toHaveBeenCalledOnce()
  })
})

class Host implements GestureHost {
  readonly added: { type: string; capture?: boolean }[] = []
  readonly removed: { type: string; capture?: boolean }[] = []
  #listeners = new Map<string, EventListener[]>()

  addEventListener(type: string, listener: EventListener, capture?: boolean): void {
    this.added.push({ type, capture })
    const list = this.#listeners.get(type) ?? []
    list.push(listener)
    this.#listeners.set(type, list)
  }

  removeEventListener(type: string, listener: EventListener, capture?: boolean): void {
    this.removed.push({ type, capture })
    const list = (this.#listeners.get(type) ?? []).filter(item => item !== listener)
    this.#listeners.set(type, list)
  }

  fire(type: string): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(new Event(type))
  }

  count(type: string): number { return this.#listeners.get(type)?.length ?? 0 }
}

const element = (fail: () => boolean, muted = false): Playable => {
  const el: Playable = {
    paused: true,
    muted,
    play: vi.fn(async () => {
      if (fail()) throw new Error('autoplay')
      el.paused = false
    }),
  }
  return el
}

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('remote sound blocked by autoplay', () => {
  it('arms one capture listener for pointer and key, and warns once', () => {
    const host = new Host()
    const warns: unknown[] = []
    const retry = new PlaybackRetry(host, () => [], error => warns.push(error))
    const error = new Error('NotAllowedError')
    retry.rejected(error)
    retry.rejected(new Error('again'))
    expect(warns).toEqual([error])
    expect(host.added).toEqual([
      { type: 'pointerdown', capture: true },
      { type: 'keydown', capture: true },
    ])
    expect(host.count('pointerdown')).toBe(1)
    expect(host.count('keydown')).toBe(1)
    expect(retry.armed).toBe(true)
  })

  it('retries every element still paused, and drops the listener once they start', async () => {
    const host = new Host()
    let fail = true
    const remote = element(() => fail)
    const own = element(() => false, true)
    const playing = element(() => false)
    playing.paused = false
    const retry = new PlaybackRetry(host, () => [remote, own, playing], () => undefined)
    retry.rejected(new Error('autoplay'))
    host.fire('pointerdown')
    await settle()
    expect(remote.play).toHaveBeenCalledOnce()
    expect(own.play).toHaveBeenCalledOnce()
    expect(playing.play).not.toHaveBeenCalled()
    expect(retry.armed).toBe(true)
    expect(host.count('keydown')).toBe(1)

    fail = false
    remote.paused = true
    host.fire('keydown')
    await settle()
    expect(remote.paused).toBe(false)
    expect(retry.armed).toBe(false)
    expect(host.removed.map(item => item.type).sort()).toEqual(['keydown', 'pointerdown'])
    expect(host.removed.every(item => item.capture === true)).toBe(true)
  })

  it('keeps the one listener while a remote element is still paused, without warning again', async () => {
    const host = new Host()
    const warns: unknown[] = []
    const remote = element(() => true)
    const retry = new PlaybackRetry(host, () => [remote], error => warns.push(error))
    retry.rejected(new Error('autoplay'))
    host.fire('keydown')
    await settle()
    expect(remote.play).toHaveBeenCalledOnce()
    expect(retry.armed).toBe(true)
    expect(warns).toHaveLength(1)
    expect(host.count('pointerdown')).toBe(1)
  })

  it('disarm removes the gesture, as leaving the meeting does', () => {
    const host = new Host()
    const retry = new PlaybackRetry(host, () => [], () => undefined)
    retry.rejected(new Error('autoplay'))
    retry.disarm()
    retry.disarm()
    expect(retry.armed).toBe(false)
    expect(host.count('pointerdown')).toBe(0)
    expect(host.count('keydown')).toBe(0)
  })
})
