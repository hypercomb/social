// sharing/image-choice.queue.spec.ts — the images wall run over many tiles.
//
// `images:open` with `labels` opens the wall for each tile in turn: a picture
// chosen moves on, the skip tile (or →) moves on, and leaving the wall any
// other way ends the run. Every step is said as `images:queue`. One label is
// the wall as it always was — no skip tile, no queue word.
//
// Pixi is faked down to what the wall touches (positions, scale, toLocal), and
// the store seams answer from small maps, so the clicks below land where the
// wall painted its tiles.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class Point { constructor(public x = 0, public y = 0) {} }
  class Node {
    children: Node[] = []
    parent: Node | null = null
    label = ''
    position = { x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y } }
    scale = { x: 1, y: 1, set(x: number, y = x) { this.x = x; this.y = y } }
    anchor = { set: () => undefined }
    alpha = 1
    visible = true
    zIndex = 0
    sortableChildren = false
    mask: unknown = null
    resolution = 1
    width = 10
    addChild(child: Node): Node { child.parent = this; this.children.push(child); return child }
    removeChild(child: Node): void { this.children = this.children.filter(c => c !== child); child.parent = null }
    destroy(): void { /* nothing to free */ }
    toLocal(p: Point): Point { return new Point((p.x - this.position.x) / this.scale.x, (p.y - this.position.y) / this.scale.y) }
  }
  class Container extends Node {}
  class Graphics extends Node {
    poly() { return this } fill() { return this } stroke() { return this } rect() { return this } circle() { return this }
  }
  class Sprite extends Node { constructor(readonly texture: unknown) { super() } }
  class Text extends Node { text: string; constructor(o: { text?: string }) { super(); this.text = o?.text ?? '' } }
  const Texture = { from: () => ({ width: 100, height: 100, destroy: () => undefined }) }
  return { Container, Graphics, Point, Sprite, Text, Texture }
})

const seams = vi.hoisted(() => ({
  gallery: new Map<string, string[]>(),
  writes: [] as { cell: string; updates: Record<string, unknown> }[],
  // When set, every byte fetch waits on it: a pick still being written.
  hold: null as Promise<void> | null,
}))

vi.mock('../editor/tile-properties.js', () => ({
  readTilePropertiesAt: async () => ({}),
  writeTilePropertiesAt: async (_parent: readonly string[], cell: string, updates: Record<string, unknown>) => {
    seams.writes.push({ cell, updates })
  },
}))
vi.mock('../commands/decoration-kind-index.js', () => ({
  referenceEditsRootDefaultForLabel: () => false,
  referenceTargetForLabel: () => null,
}))
vi.mock('../commands/lightbox-kind.js', () => ({
  forgetPicture: async () => ({ removed: false }),
  forgetPreview: async () => ({ held: false }),
  galleryImageSigsAt: async (address: readonly string[]) => seams.gallery.get(address[address.length - 1] ?? '') ?? [],
  holdPictures: async () => undefined,
}))
vi.mock('../presentation/tiles/artifact-content.js', () => ({
  fetchThroughContentHop: async (sig: string) => { if (seams.hold) await seams.hold; return new Blob([sig]) },
  terminalContentSig: async (_store: unknown, sig: string) => sig,
}))
vi.mock('./peer-images.js', () => ({ canonicalPeerImageCandidates: async () => [] }))
vi.mock('./image-updates.js', () => ({ markSeen: async () => undefined, unseenNow: async () => new Set<string>() }))

vi.hoisted(() => {
  ;(globalThis as unknown as { ioc: unknown }).ioc = {
    register: () => {},
    whenReady: () => {},
    get: (key: string) => {
      if (key === '@hypercomb.social/Store') return { getResource: async (sig: string) => new Blob([sig]) }
      if (key === '@hypercomb.social/Lineage') return { explorerSegments: () => ['home'] }
      return undefined
    },
  }
  ;(globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = async () => ({})
})

import { EffectBus } from '@hypercomb/core'
import { Container } from 'pixi.js'
import { ImageChoiceDrone } from './image-choice.drone.js'
import type { ImageQueueState } from './image-queue.js'

type Fake = Container & { children: Fake[]; position: { x: number; y: number }; scale: { x: number }; label: string; text?: string }

const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)) }

let drone: ImageChoiceDrone
let root: Fake
let queueWords: ImageQueueState[] = []
let toasts: unknown[] = []

beforeEach(async () => {
  EffectBus.clear()
  seams.gallery = new Map([
    ['fog', ['f1', 'f2']],
    ['garden', ['g1', 'g2']],
    ['lantern', ['l1', 'l2']],
  ])
  seams.writes = []
  seams.hold = null
  queueWords = []
  toasts = []
  EffectBus.on<ImageQueueState>('images:queue', p => { queueWords.push(p) })
  EffectBus.on('toast:show', p => { toasts.push(p) })
  drone = new ImageChoiceDrone()
  await drone.pulse('')
  root = new Container() as Fake
  EffectBus.emit('render:host-ready', {
    container: root,
    canvas: document.createElement('canvas'),
    renderer: {
      screen: { width: 1000, height: 800 },
      resolution: 1,
      events: { mapPositionToPoint: (out: { x: number; y: number }, x: number, y: number) => { out.x = x; out.y = y } },
    },
  })
})

afterEach(() => {
  ;(drone as unknown as { dispose(): void }).dispose()
  EffectBus.clear()
})

/** The wall layer currently painted, if any. */
const wall = (): Fake | undefined => root.children[root.children.length - 1]

/** The screen point of the wall's i-th tile. */
const at = (i: number): { clientX: number; clientY: number } => {
  const layer = wall()!
  const tile = layer.children[i]!
  return { clientX: layer.position.x + tile.position.x * layer.scale.x, clientY: layer.position.y + tile.position.y * layer.scale.x }
}

const release = (point: { clientX: number; clientY: number }): void => {
  window.dispatchEvent(new MouseEvent('pointermove', { ...point }))
  window.dispatchEvent(new MouseEvent('pointerup', { ...point, button: 0 }))
}

/** The words a wall tile wears (the picture's who, or the skip tile's). */
const words = (tile: Fake): string =>
  (tile.children as unknown as { text?: string }[]).find(c => typeof c.text === 'string')?.text ?? ''

const current = () => queueWords[queueWords.length - 1]

describe('the images wall over many tiles', () => {
  it('one label is the wall as always: no skip tile and no queue word', async () => {
    EffectBus.emit('images:open', { label: 'fog', segments: ['home'] })
    await settle()
    expect(wall()?.children.length).toBe(2)
    expect(wall()!.children.map(words)).not.toContain('skip ›')
    expect(queueWords).toEqual([])
  })

  it('opens the first tile with a skip tile, and says the queue', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    expect(current()).toEqual({ segments: ['home'], labels: ['fog', 'garden', 'lantern'], done: [], current: 'fog' })
    expect(wall()?.children.length).toBe(3)
    expect(words(wall()!.children[2]!)).toBe('skip ›')
  })

  it('choosing a picture writes it and moves on to the next tile', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    release(at(0))
    await settle()
    expect(seams.writes.map(w => w.cell)).toEqual(['fog'])
    expect(current()).toEqual({ segments: ['home'], labels: ['fog', 'garden', 'lantern'], done: ['fog'], current: 'garden' })
    expect(wall()?.children.length).toBe(3)            // garden's wall, with its own skip tile
  })

  it('the skip tile moves on and writes nothing', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    release(at(2))
    await settle()
    expect(seams.writes).toEqual([])
    expect(current()).toMatchObject({ done: ['fog'], current: 'garden' })
  })

  it('→ skips too, and skipping the last tile closes the wall and ends the queue', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden'], segments: ['home'] })
    await settle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await settle()
    expect(current()).toMatchObject({ done: ['fog'], current: 'garden' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await settle()
    expect(current()).toEqual({ segments: ['home'], labels: [], done: ['fog', 'garden'], current: null })
    expect(wall()).toBeUndefined()
  })

  it('closing the wall (Esc) ends the queue where it stands', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    release(at(0))
    await settle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(current()).toEqual({ segments: ['home'], labels: [], done: ['fog'], current: null })
    expect(wall()).toBeUndefined()
    expect(seams.writes.map(w => w.cell)).toEqual(['fog'])
  })

  it('no skip while a pick is still being written: the next tile is not passed over unseen', async () => {
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    let letGo = (): void => undefined
    seams.hold = new Promise<void>(r => { letGo = r })
    const skipAt = at(2)
    release(at(0))                                   // pick a picture; its fetch waits
    await settle()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    release(skipAt)                                  // and the skip tile, while it waits
    await settle()
    expect(current()).toMatchObject({ done: [], current: 'fog' })
    seams.hold = null
    letGo()
    await settle()
    expect(seams.writes.map(w => w.cell)).toEqual(['fog'])
    expect(current()).toEqual({ segments: ['home'], labels: ['fog', 'garden', 'lantern'], done: ['fog'], current: 'garden' })
    expect(wall()?.children.length).toBe(3)            // garden's wall is up, waiting
  })

  it('a tile with nothing to choose is answered as it stands, and the queue carries on', async () => {
    seams.gallery.set('garden', [])
    EffectBus.emit('images:open', { label: 'fog', labels: ['fog', 'garden', 'lantern'], segments: ['home'] })
    await settle()
    release(at(2))
    await settle()
    expect(current()).toMatchObject({ done: ['fog', 'garden'], current: 'lantern' })
    expect(toasts.length).toBe(1)
    expect(wall()?.children.length).toBe(3)
  })
})
