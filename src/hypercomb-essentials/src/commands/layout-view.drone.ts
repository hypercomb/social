// commands/layout-view.drone.ts
//
// THE GRID HEARS THE LAYOUT (layout.ts, layout.queen.ts). While a layer's
// layout is on, the children its words do not name are left out of the
// hexagon grid: not deleted, not moved, only not drawn. Turn the layout off
// and they are drawn again.
//
// It plugs in through the grid's own presence claim (decoration-kind-index.ts
// claimPresence): the grid asks, for each child on a page, whether a bee
// keeps it off the grid. The question is synchronous, so the layouts of the
// pages seen are kept warm here, read when a page is drawn, and re-read when
// its decorations or its layout change. A page whose layout is not read yet
// shows every child until it is; then the grid is told to draw again.

import { Drone, EffectBus, sameTraitWord } from '@hypercomb/core'
import { claimPresence } from './decoration-kind-index.js'
import { layoutAt, namesOf } from './layout-read.js'
import { standing } from './trait-read.js'

const keyOf = (segments: readonly string[]): string => segments.join('\u0000')

export class LayoutViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Leaves out of the grid the children a layer\'s layout does not name, while it is on'

  protected override listens = ['render:cell-count', 'decorations:changed', 'layout:changed']
  protected override emits = ['presence:claims-changed']

  /** Page → the words its layout shows, for pages whose layout is on. */
  #shows = new Map<string, readonly string[]>()
  /** Pages already read (on or off), so a draw does not re-read them. */
  #read = new Set<string>()
  #reading = new Map<string, Promise<void>>()

  constructor() {
    super()
    claimPresence((name, segments) => {
      const words = this.#shows.get(keyOf(segments))
      return !!words && !words.some(word => sameTraitWord(word, name))
    })
    EffectBus.on('render:cell-count', () => { void this.#warm(standing(), false) })
    EffectBus.on<{ segments?: readonly string[] }>('layout:changed', p => { void this.#warm(p?.segments ?? standing(), true) })
    EffectBus.on('decorations:changed', () => { void this.#warm(standing(), true) })
  }

  /** Read a page's layout if it is not known (or `again`), and tell the grid
   *  to draw again when what it leaves out has changed. */
  #warm(segments: readonly string[], again: boolean): Promise<void> {
    const key = keyOf(segments)
    if (!again && this.#read.has(key)) return Promise.resolve()
    const pending = this.#reading.get(key)
    if (pending) return pending
    const run = (async () => {
      try {
        const { layout } = await layoutAt(segments)
        const before = this.#shows.get(key)
        const words = layout?.on ? await namesOf(layout) : null
        this.#read.add(key)
        if (words && words.length) this.#shows.set(key, words)
        else this.#shows.delete(key)
        const after = this.#shows.get(key)
        if ((before ?? []).join('\u0000') !== (after ?? []).join('\u0000') || !!before !== !!after) {
          EffectBus.emit('presence:claims-changed', { segments })
        }
      } catch { /* an unreadable layout leaves every child drawn */ } finally {
        this.#reading.delete(key)
      }
    })()
    this.#reading.set(key, run)
    return run
  }
}

const _layoutView = new LayoutViewDrone()
window.ioc.register('@diamondcoreprocessor.com/LayoutViewDrone', _layoutView)
