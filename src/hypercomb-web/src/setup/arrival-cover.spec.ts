// arrival-cover.spec.ts — a door's loading cover lifts once its arrival is on
// screen, WHATEVER view it opens on, and never strands a visitor.
//
// arkanoid.pluginthematrix.com, 2026-10-24: a postit face. The verdict named
// a view, the post mounted its page and claimed `view:active` at 1.6 s — and
// the cover, waiting for the website's `#hc-site-view-host`, which a post-it
// never seats, stayed opaque over the painted page for good; its failsafe
// stood down while it waited.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COVER_FAILSAFE_MS, holdCoverUntilArrival } from './arrival-cover'

/** The runtime's bus, last-value replay included (hypercomb-core effect-bus.ts). */
const makeBus = () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const last = new Map<string, unknown>()
  return {
    emit(effect: string, payload: unknown): void {
      last.set(effect, payload)
      for (const handler of [...(handlers.get(effect) ?? [])]) handler(payload)
    },
    on<T>(effect: string, handler: (payload: T) => void): () => void {
      let set = handlers.get(effect)
      if (!set) handlers.set(effect, set = new Set())
      set.add(handler as (payload: unknown) => void)
      if (last.has(effect)) handler(last.get(effect) as T)
      return () => { set!.delete(handler as (payload: unknown) => void) }
    },
  }
}

let bus: ReturnType<typeof makeBus>
let frames: Array<() => void>
const frame = (callback: () => void): void => { frames.push(callback) }
/** Run `count` animation frames. */
const paint = (count = 4): void => {
  for (let i = 0; i < count; i++) for (const callback of frames.splice(0)) callback()
}
const cover = (): HTMLElement | null => document.querySelector('.site-loading')
const coverUp = (): boolean => !!cover() && cover()!.style.opacity !== '0'
const hold = (): (() => void) => holdCoverUntilArrival(bus, { frame })

beforeEach(() => {
  vi.useFakeTimers()
  bus = makeBus()
  frames = []
  document.body.className = ''
  document.body.innerHTML = '<div class="site-loading"></div>'
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.body.className = ''
})

describe('the arrival cover — a view face', () => {
  it('a post-it face lifts once the post claims the surface — no site host ever seats', () => {
    hold()
    bus.emit('view:arrival', { segments: ['games', 'arkanoid'], view: 'postit' })
    document.body.classList.add('hc-view-postit', 'hc-view-covered')
    paint()
    expect(coverUp()).toBe(true)                 // nothing painted yet

    const post = document.createElement('section')
    post.className = 'hc-postit-view'
    document.body.append(post)
    bus.emit('view:active', { active: true, owner: 'postit-view' })
    paint()
    expect(coverUp()).toBe(false)
    vi.advanceTimersByTime(400)
    expect(cover()).toBeNull()
  })

  it.each(['game', 'slides', 'lightbox', 'scroller', 'tree', 'document', 'tutor', 'workflow',
    'lounge', 'revolucion-room', 'publications', 'square-tile-view'])(
    'a %s face lifts on its view:active claim, covered body or not', view => {
      hold()
      bus.emit('view:arrival', { segments: ['x'], view })
      paint()
      expect(coverUp()).toBe(true)
      bus.emit('view:active', { active: true, owner: `${view}-view` })
      paint()
      expect(coverUp()).toBe(false)
    })

  it('a website lifts only once its host is seated under the covered body', () => {
    hold()
    bus.emit('view:arrival', { segments: ['meetups'], view: 'website' })
    paint()
    expect(coverUp()).toBe(true)

    const host = document.createElement('div')
    host.id = 'hc-site-view-host'
    document.body.append(host)
    paint()
    expect(coverUp()).toBe(true)                 // the canvas is not covered yet

    document.body.classList.add('hc-view-covered')
    paint()
    expect(coverUp()).toBe(false)
  })

  it('a business card holds the cover until its stage is live', () => {
    hold()
    bus.emit('view:arrival', { segments: ['business-card'], view: 'website' })
    const host = document.createElement('div')
    host.id = 'hc-site-view-host'
    host.className = 'card-open'
    document.body.append(host)
    document.body.classList.add('hc-view-covered')
    paint(8)
    expect(coverUp()).toBe(true)

    host.classList.add('scene-live')
    paint()
    expect(coverUp()).toBe(false)
  })

  it('a verdict and a claim that landed before the cover subscribed still count', () => {
    bus.emit('view:arrival', { segments: ['games', 'arkanoid'], view: 'postit' })
    bus.emit('view:active', { active: true, owner: 'postit-view' })
    hold()
    paint()
    expect(coverUp()).toBe(false)
  })
})

describe('the arrival cover — the hexagons', () => {
  it('lifts at the first painted or settled pass, never at an empty unsettled one', () => {
    hold()
    bus.emit('view:arrival', { segments: ['colony'], view: '' })
    bus.emit('render:cell-count', { count: 0 })
    expect(coverUp()).toBe(true)
    bus.emit('render:cell-count', { count: 0, settled: true })
    expect(coverUp()).toBe(false)
  })

  it('a pass replayed from the root the visit began on never lifts a door\'s cover', () => {
    hold()
    bus.emit('render:cell-count', { count: 0, settled: true, locationKey: '/' })
    bus.emit('view:arrival', { segments: ['business-card'], view: '' })
    expect(coverUp()).toBe(true)                 // the replay was the root's
    bus.emit('render:cell-count', { count: 3, locationKey: '/elsewhere' })
    expect(coverUp()).toBe(true)
    bus.emit('render:cell-count', { count: 0, settled: true, locationKey: '/business-card' })
    expect(coverUp()).toBe(false)
  })
})

describe('the arrival cover — the failsafe is always armed', () => {
  it('lifts a view verdict whose surface never comes', () => {
    hold()
    bus.emit('view:arrival', { segments: ['games', 'arkanoid'], view: 'postit' })
    document.body.classList.add('hc-view-covered')
    vi.advanceTimersByTime(COVER_FAILSAFE_MS - 1)
    paint()
    expect(coverUp()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(coverUp()).toBe(false)
  })

  it('lifts a boot that never reaches a verdict', () => {
    hold()
    vi.advanceTimersByTime(COVER_FAILSAFE_MS)
    expect(coverUp()).toBe(false)
  })

  it('a door that cannot open lifts through the returned lift', () => {
    const lift = hold()
    lift()
    expect(coverUp()).toBe(false)
  })
})
