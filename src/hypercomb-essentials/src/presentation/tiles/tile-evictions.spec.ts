// tile-evictions.spec.ts — AN ATLAS SLOT REUSED UNDER A TILE ON SCREEN, on its
// own. A displaced picture or name on screen repaints, bounded; the victim is
// handed to readiness's promise repair; an oversized layer's out-of-view
// names and a paint's own bake ask for nothing; a converged paint resets the
// shared bound.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EVICT_REPAINT_MAX, EvictionRepaint, type EvictedCell, type EvictionHost } from './tile-evictions.js'

const hostWith = (cells: EvictedCell[], over: Partial<EvictionHost> = {}) => {
  const images = new Set<string>()
  const labels = new Set<string>()
  const calls = { repaints: 0, images: [] as (string | undefined)[], labels: [] as (string | undefined)[] }
  const host: EvictionHost & { images: Set<string>; labels: Set<string>; calls: typeof calls } = {
    images, labels, calls,
    imageAtlas: () => ({ hasImage: sig => images.has(sig), hasFailed: () => false }),
    labelAtlas: () => ({ hasLabel: label => labels.has(label) }),
    cells: () => cells,
    hidesName: c => !!c.hideText,
    imageEvicted: sig => { calls.images.push(sig) },
    labelEvicted: label => { calls.labels.push(label) },
    pinned: () => true,
    baking: () => false,
    repaint: () => { calls.repaints++ },
    ...over,
  }
  return host
}
const evicted = (detail: Record<string, string>) => new CustomEvent('evicted', { detail })

afterEach(() => { vi.restoreAllMocks() })

describe('eviction repaints', () => {
  it('a displaced picture on screen repaints, and the victim goes to promise repair', () => {
    const host = hostWith([{ label: 'garden', imageSig: 'a' }])
    new EvictionRepaint(host).onImage(evicted({ sig: 'a' }))
    expect(host.calls.repaints).toBe(1)
    expect(host.calls.images).toEqual(['a'])
  })

  it('a displaced name on screen repaints; a hidden one or one the paint did not pin does not', () => {
    const host = hostWith([{ label: 'garden' }])
    new EvictionRepaint(host).onLabel(evicted({ label: 'garden' }))
    expect(host.calls.repaints).toBe(1)
    expect(host.calls.labels).toEqual(['garden'])
    for (const over of [{ pinned: () => false }, { hidesName: () => true }, { baking: () => true }] as Partial<EvictionHost>[]) {
      const quiet = hostWith([{ label: 'garden' }], over)
      new EvictionRepaint(quiet).onLabel(evicted({ label: 'garden' }))
      expect(quiet.calls.repaints).toBe(0)
      expect(quiet.calls.labels).toEqual(['garden'])
    }
  })

  it('is bounded while the layer keeps evicting itself, until a paint converges', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = hostWith([{ label: 'garden', imageSig: 'a' }])
    const repaint = new EvictionRepaint(host)
    for (let i = 0; i < EVICT_REPAINT_MAX + 3; i++) repaint.onLabel()
    expect(host.calls.repaints).toBe(EVICT_REPAINT_MAX)
    // The image half shares the bound.
    repaint.onImage()
    expect(host.calls.repaints).toBe(EVICT_REPAINT_MAX)
    repaint.converged()
    repaint.onImage()
    expect(host.calls.repaints).toBe(EVICT_REPAINT_MAX + 1)
  })

  it('a clean picture scan resets the bound by itself', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = hostWith([{ label: 'garden', imageSig: 'a' }])
    const repaint = new EvictionRepaint(host)
    for (let i = 0; i < EVICT_REPAINT_MAX; i++) repaint.onImage()
    host.images.add('a')
    repaint.onImage()
    host.images.delete('a')
    repaint.onImage()
    expect(host.calls.repaints).toBe(EVICT_REPAINT_MAX + 1)
  })
})
