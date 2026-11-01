// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  QUALITIES, bitrateOf, describeQuality, frameRateOf, isQuality, qualityConstraints, videoConstraints,
} from './meeting-quality.js'

afterEach(() => localStorage.clear())

describe('the three pictures', () => {
  it('are offered saver, auto, sharp — lowest first', () => {
    expect(QUALITIES).toEqual(['saver', 'auto', 'sharp'])
    expect(QUALITIES.every(isQuality)).toBe(true)
    expect(isQuality('best')).toBe(false)
  })

  it('ask for more pixels the sharper they are', () => {
    const area = (q: 'saver' | 'auto' | 'sharp'): number => describeQuality(q).width * describeQuality(q).height
    expect(area('saver')).toBeLessThan(area('auto'))
    expect(area('auto')).toBeLessThan(area('sharp'))
  })
})

describe('what the camera is asked for', () => {
  it('is ideal, never exact — a weaker camera must still open', () => {
    const video = videoConstraints('auto') as { width: object; height: object; frameRate: object }
    expect(video.width).toEqual({ ideal: 1280 })
    expect(video.height).toEqual({ ideal: 720 })
    expect(video.frameRate).toEqual({ ideal: 30 })
  })

  it('makes only a chosen device exact', () => {
    expect((videoConstraints('auto') as { deviceId?: unknown }).deviceId).toBeUndefined()
    expect((videoConstraints('auto', 'cam-2') as { deviceId?: unknown }).deviceId).toEqual({ exact: 'cam-2' })
    const both = qualityConstraints('sharp', { camera: 'cam-2', microphone: 'mic-9' })
    expect((both.audio as { deviceId?: unknown }).deviceId).toEqual({ exact: 'mic-9' })
  })

  it('keeps echo cancellation, noise suppression and gain control on', () => {
    expect(qualityConstraints('auto').audio).toMatchObject({
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    })
  })
})

describe('the shared uplink', () => {
  it('gives one peer the ceiling and splits the budget as more join', () => {
    expect(bitrateOf('auto', 1)).toBe(1_500_000)
    expect(bitrateOf('auto', 2)).toBe(1_500_000)
    expect(bitrateOf('auto', 3)).toBe(1_000_000)
    expect(bitrateOf('auto', 6)).toBe(500_000)
  })

  it('never goes below the floor, however many are in the room', () => {
    expect(bitrateOf('auto', 60)).toBe(300_000)
    expect(bitrateOf('saver', 60)).toBe(150_000)
  })

  it('treats nobody connected yet as one', () => {
    expect(bitrateOf('auto', 0)).toBe(bitrateOf('auto', 1))
  })

  it('spends more in a sharper picture at the same head count', () => {
    expect(bitrateOf('saver', 4)).toBeLessThan(bitrateOf('auto', 4))
    expect(bitrateOf('auto', 4)).toBeLessThan(bitrateOf('sharp', 4))
  })
})

describe('numbers set by hand', () => {
  it('win over every choice, and a bad value is ignored', () => {
    localStorage.setItem('hc:meeting:fps', '15')
    localStorage.setItem('hc:meeting:uplink', '1200000')
    expect(frameRateOf('sharp')).toBe(15)
    expect(bitrateOf('auto', 6)).toBe(300_000)
    localStorage.setItem('hc:meeting:fps', 'fast')
    expect(frameRateOf('sharp')).toBe(30)
  })

  it('are read back by what the lobby says', () => {
    localStorage.setItem('hc:meeting:width', '960')
    expect(describeQuality('auto').width).toBe(960)
  })
})
