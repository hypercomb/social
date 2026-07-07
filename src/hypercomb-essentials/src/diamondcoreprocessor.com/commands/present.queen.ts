// diamondcoreprocessor.com/commands/present.queen.ts
//
// `/present` — the SLIDES view behaviour, the presentation sibling of
// `/website`, `/home`, and `/tutor`. Plays the current tile area's child
// DIAGRAM tiles as a PowerPoint-style, screen-by-screen slideshow. The render
// surface is a SINGLE GLOBAL flag (ViewModeService): `/present on` switches to
// slides wherever the current cell is a deck, `/present off` returns to
// hexagons, bare `/present` toggles.
//
// A cell is a DECK when it carries a `visual:diagram:deck` decoration — that is
// what lights the ViewBee toggle on it, and what SlidesViewDrone renders from
// (it enumerates the deck cell's children as slides). A child becomes a SLIDE
// via any of (renderer resolution order): a `visual:diagram:slide` decoration
// (canonical — carries contentSig/format/title/caption/order), a legacy
// `visual:lightbox:gallery` decoration, or its own `link` pointing at an image
// resource. So the existing `/diagrams` branch presents with zero migration.
//
// Syntax:
//   /present                    — toggle hexagons ↔ slides (global)
//   /present on | play | view   — switch to slides view
//   /present off | hex          — back to hexagons
//   /present here | mark        — mark THIS cell as a deck (re-run to unmark)
//   /present slide              — connect a file: pick an SVG/image and make the
//                                 CURRENT tile a slide (auto-marks its parent deck)
//
// The render itself is SlidesViewDrone (presentation/tiles/slides-view.drone.ts).

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { writeDecoration, listDecorations, removeDecoration } from './decoration-manifest.js'

/** Marks a cell as a slide deck — the ViewBee toggle + SlidesViewDrone gate on this. */
export const DECK_KIND = 'visual:diagram:deck'
/** Marks a child tile as a diagram slide (canonical, richest payload). */
export const SLIDE_KIND = 'visual:diagram:slide'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const ON_KEYWORDS = new Set(['on', 'open', 'go', 'play', 'view', 'present'])
const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close', 'stop'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type StoreShape = { putResource(blob: Blob): Promise<string> }

export class PresentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'present'
  override readonly aliases = ['slides', 'slideshow']
  override description = 'Slides view — play this tile area\'s diagram tiles as a screen-by-screen slideshow'
  override descriptionKey = 'slash.present'
  override options = ['on', 'off', 'here', 'slide']
  override examples = [
    { input: '/present', result: 'Plays the current area\'s diagram tiles as slides' },
    { input: '/present slide', result: 'Attach an SVG/image to make this tile a slide' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'here', 'slide'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'here' || a === 'mark') { await this.#markHere(); return }
    if (a === 'slide' || a === 'add' || a === 'attach') { this.#attachSlide(); return }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) { this.#log('Slides view unavailable'); return }

    if (ON_KEYWORDS.has(a)) { vm.setMode('slides'); this.#log('Slides view — on', '▶'); return }
    if (OFF_KEYWORDS.has(a)) { vm.setMode('hexagons'); this.#log('Slides view — off', '○'); return }

    // Bare /present (or 'toggle') — flip.
    const next = vm.mode === 'slides' ? 'hexagons' : 'slides'
    vm.setMode(next)
    this.#log(next === 'slides' ? 'Slides view — on' : 'Slides view — off', next === 'slides' ? '▶' : '○')
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Mark the current cell as a slide deck; re-run clears the mark. */
  async #markHere(): Promise<void> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : '/'
    try {
      const existing = await listDecorations({ kind: DECK_KIND, segments })
      if (existing.length) {
        for (const e of existing) removeDecoration({ sig: e.sig, segments })
        this.#log(`Slides — ${where} is no longer a deck`, '○')
        return
      }
      await writeDecoration({
        kind: DECK_KIND,
        appliesTo: segments,
        segments,
        payload: { icon: 'slideshow' },
        mark: 'persistent',
      })
      this.#log(`Slides — ${where} marked as a deck; toggle /present to play it`, '▶')
    } catch (err) {
      console.warn('[/present here] failed', err)
      this.#log('Slides — could not mark this cell (see console)')
    }
  }

  /** Ensure the given cell carries a deck decoration (idempotent; no-op if it
   *  already has one). Used to auto-mark the parent when a slide is attached to
   *  a child, so `/present` lights up without a manual `/present here`. */
  async #ensureDeck(segments: readonly string[]): Promise<void> {
    try {
      const existing = await listDecorations({ kind: DECK_KIND, segments })
      if (existing.length) return
      await writeDecoration({
        kind: DECK_KIND,
        appliesTo: segments,
        segments,
        payload: { icon: 'slideshow' },
        mark: 'persistent',
      })
    } catch (err) {
      console.warn('[/present] auto-mark deck failed', err)
    }
  }

  /** Connect-a-file: open a picker, store the chosen SVG/image as a resource,
   *  and stamp the CURRENT tile with a `visual:diagram:slide` decoration. The
   *  parent cell is auto-marked as a deck. The picker is opened synchronously so
   *  it rides the command's user-activation; the storing happens after the user
   *  picks a file. */
  #attachSlide(): void {
    const segments = this.#segments()
    if (segments.length === 0) {
      this.#log('Slides — stand on a tile first, then /present slide to make it a slide', '▶')
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/svg+xml,image/*'
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) void this.#storeSlide(segments, file)
    }, { once: true })
    document.body.appendChild(input)
    input.click()
  }

  async #storeSlide(segments: readonly string[], file: File): Promise<void> {
    const store = get<StoreShape>('@hypercomb.social/Store')
    if (!store?.putResource) { this.#log('Slides — storage unavailable'); return }
    try {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
      const contentSig = await store.putResource(blob)
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
      const title = file.name.replace(/\.[^.]+$/, '') || segments[segments.length - 1]

      await writeDecoration({
        kind: SLIDE_KIND,
        appliesTo: segments,
        segments,
        payload: { contentSig, format: isSvg ? 'svg' : 'image', title },
        mark: 'persistent',
      })
      // Auto-mark the parent as a deck so /present appears there immediately.
      await this.#ensureDeck(segments.slice(0, -1))

      this.#log(`Slides — "${title}" added as a slide; /present on its parent to play`, '▶')
    } catch (err) {
      console.warn('[/present slide] failed', err)
      this.#log('Slides — could not attach that file (see console)')
    }
  }

  #log(message: string, icon = '▶'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _present = new PresentQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PresentQueenBee', _present)

// Visual-bee registration — declares the view identity so the renderer +
// ViewBee toggle + adoption UI can discover the slides behaviour. The toggle
// surfaces on any cell carrying a `visual:diagram:deck` decoration; clicking it
// flips ViewMode (hexagons ⇄ slides). `adoptScope: 'hierarchy'` because a deck's
// slides ARE its child tiles — adopting the deck must carry the children.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'slides',
      slashCommand: '/present',
      iconName: 'slides',
      toggleIcon: 'slideshow',
      behavior: 'render',
      decorationKind: DECK_KIND,
      labelKey: 'view.slides',
      descriptionKey: 'view.slides.description',
      queenKey: '@diamondcoreprocessor.com/PresentQueenBee',
      adoptable: true,
      adoptScope: 'hierarchy',
    })
  },
)
