// sharing/image-queue.spec.ts — the bookkeeping behind "look for images" on
// many tiles: selection order, each tile once, chosen and skipped both count
// as answered, and the ended state keeps what was done.

import { describe, expect, it } from 'vitest'
import { ImageQueue } from './image-queue.js'

describe('ImageQueue', () => {
  it('starts on the first tile, in the order given, each tile once', () => {
    const queue = new ImageQueue()
    expect(queue.start([' garden ', 'fog', 'garden', '', 'lantern'], ['home', ' '])).toBe('garden')
    expect(queue.state()).toEqual({ segments: ['home'], labels: ['garden', 'fog', 'lantern'], done: [], current: 'garden' })
    expect(queue.position()).toEqual({ index: 1, total: 3 })
    expect(queue.peekNext()).toBe('fog')
  })

  it('advances through every tile and ends after the last, keeping what was done', () => {
    const queue = new ImageQueue()
    queue.start(['a', 'b', 'c'], [])
    expect(queue.advance()).toBe('b')
    expect(queue.state()).toEqual({ segments: [], labels: ['a', 'b', 'c'], done: ['a'], current: 'b' })
    expect(queue.position()).toEqual({ index: 2, total: 3 })
    expect(queue.advance()).toBe('c')
    expect(queue.peekNext()).toBeNull()
    expect(queue.advance()).toBeNull()
    expect(queue.running).toBe(false)
    expect(queue.state()).toEqual({ segments: [], labels: [], done: ['a', 'b', 'c'], current: null })
  })

  it('ends where it stands: labels empty, current null, done kept', () => {
    const queue = new ImageQueue()
    queue.start(['a', 'b', 'c'], ['x'])
    queue.advance()
    queue.end()
    expect(queue.state()).toEqual({ segments: ['x'], labels: [], done: ['a'], current: null })
    expect(queue.advance()).toBeNull()
  })

  it('an empty start never runs', () => {
    const queue = new ImageQueue()
    expect(queue.start(['', '  '], [])).toBeNull()
    expect(queue.running).toBe(false)
  })
})
