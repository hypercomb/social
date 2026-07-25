// diamondcoreprocessor.com/commands/lightbox.queen.ts
//
// `/lightbox` — the LIGHTBOX view behaviour, and the bee that owns the
// `visual:lightbox:gallery` kind. Before this existed the kind was an orphan:
// essentials wrote it and read it, but nothing declared it, so every tile
// carrying one reported an unrecognized beehavior.
//
// ── What a lightbox shows ─────────────────────────────────────────────
//
// Everything the tile holds, in this order (SlidesViewDrone's `lightbox`
// surface resolves them):
//   1. its own gallery images — a `visual:lightbox:gallery` decoration whose
//      payload is `{ images: [sig, …] }` (written by `/lightbox add`)
//   2. its own picture — the tile's link/display image, so a tile you made by
//      dropping ONE image is already a one-image lightbox
//   3. its children's pictures — so a lightbox on a CONTAINER is the gallery
//      of everything dropped inside it, and a newly dropped image joins it
//      with nothing to type
//
// That third source is what makes the drop flow streamline: put the lightbox
// on the container once, and every image dropped in from then on shows up in
// it automatically.
//
// ── Syntax ────────────────────────────────────────────────────────────
//   /lightbox                    — toggle hexagons ↔ lightbox
//   /lightbox on | open | view   — open the lightbox
//   /lightbox off | hex          — back to hexagons
//   /lightbox add | attach       — pick image files and hold them on this tile
//   /lightbox clear              — take the gallery off this tile (the images
//                                  themselves stay — they're content-addressed)
//
// `name@lightbox` from the command line attaches it declaratively (the
// behaviour is `attachable`: its content is what the tile already has, so
// writing the decoration IS the whole install). Clicking a tile that carries
// it OPENS it in place — closing drops you back where you were, which is
// exactly what a lightbox is for.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { writeDecoration, listDecorations, removeDecoration } from './decoration-manifest.js'

/** Images held on a tile — the lightbox's content, and (on a CHILD of a deck)
 *  a slide source for `/present`. Payload: `{ images: [sig, …] }`. */
export const GALLERY_KIND = 'visual:lightbox:gallery'

/** The ViewMode surface this behaviour renders on. Matches the kind's own
 *  `visual:<view>:<noun>` middle segment — the vocabulary the command line's
 *  `name@lightbox` and the Beehaviors panel both read. */
export const LIGHTBOX_VIEW = 'lightbox'

const SIG = /^[0-9a-f]{64}$/

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const ON_KEYWORDS = new Set(['on', 'open', 'go', 'view', 'show', 'play'])
const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close', 'stop'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type StoreShape = { putResource(blob: Blob): Promise<string> }

export class LightboxQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lightbox'
  override readonly aliases = ['gallery', 'images']
  override description = 'Lightbox view — show the pictures this tile holds, one screen at a time'
  override descriptionKey = 'slash.lightbox'
  override options = ['on', 'off', 'add', 'clear']
  override examples = [
    { input: '/lightbox add', result: 'Pick images and hold them on this tile' },
    { input: '/lightbox', result: 'Shows this tile\'s pictures full screen' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'add', 'clear'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'add' || a === 'attach') { this.#attachImages(); return }
    if (a === 'clear' || a === 'remove') { await this.#clearHere(); return }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) { this.#log('Lightbox unavailable'); return }

    if (ON_KEYWORDS.has(a)) { vm.setMode(LIGHTBOX_VIEW); this.#log('Lightbox — on', '▶'); return }
    if (OFF_KEYWORDS.has(a)) { vm.setMode('hexagons'); this.#log('Lightbox — off', '○'); return }

    const next = vm.mode === LIGHTBOX_VIEW ? 'hexagons' : LIGHTBOX_VIEW
    vm.setMode(next)
    this.#log(next === LIGHTBOX_VIEW ? 'Lightbox — on' : 'Lightbox — off', next === LIGHTBOX_VIEW ? '▶' : '○')
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Take the gallery off this tile. The image RESOURCES stay in the store —
   *  they are content-addressed, so the same bytes come back under the same
   *  signature if the gallery is rebuilt (and other tiles may reference them). */
  async #clearHere(): Promise<void> {
    const segments = this.#segments()
    if (segments.length === 0) { this.#log('Lightbox — stand on a tile first', '▶'); return }
    try {
      const existing = await listDecorations({ kind: GALLERY_KIND, segments })
      if (existing.length === 0) { this.#log('Lightbox — no gallery on this tile', '○'); return }
      for (const e of existing) removeDecoration({ sig: e.sig, segments })
      this.#log(`Lightbox — gallery removed from "${segments[segments.length - 1]}"`, '○')
    } catch (err) {
      console.warn('[/lightbox clear] failed', err)
      this.#log('Lightbox — could not clear this tile (see console)')
    }
  }

  /** Connect files: open a MULTI picker, store each image as a resource, and
   *  write one gallery decoration carrying every signature. The picker opens
   *  synchronously so it rides the command's user-activation. */
  #attachImages(): void {
    const segments = this.#segments()
    if (segments.length === 0) {
      this.#log('Lightbox — stand on a tile first, then /lightbox add', '▶')
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])]
      input.remove()
      if (files.length) void this.#storeImages(segments, files)
    }, { once: true })
    document.body.appendChild(input)
    input.click()
  }

  /** Store the picked images and write the gallery. Existing images are kept:
   *  a gallery grows by adding, and the record is REPLACED with the merged list
   *  (one decoration per tile — the payload is the whole gallery). */
  async #storeImages(segments: readonly string[], files: readonly File[]): Promise<void> {
    const store = get<StoreShape>('@hypercomb.social/Store')
    if (!store?.putResource) { this.#log('Lightbox — storage unavailable'); return }
    const label = segments[segments.length - 1] ?? ''
    try {
      const added: string[] = []
      for (const file of files) {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' })
        const sig = await store.putResource(blob)
        if (SIG.test(sig)) added.push(sig)
      }
      if (added.length === 0) { this.#log('Lightbox — nothing could be stored', '○'); return }

      const existing = await listDecorations<{ images?: unknown }>({ kind: GALLERY_KIND, segments })
      const kept: string[] = []
      for (const { record } of existing) {
        const imgs = record.payload?.images
        if (Array.isArray(imgs)) {
          for (const s of imgs) {
            const v = String(s)
            if (SIG.test(v) && !kept.includes(v)) kept.push(v)
          }
        }
      }
      const images = [...kept, ...added.filter(s => !kept.includes(s))]

      await writeDecoration({
        kind: GALLERY_KIND,
        appliesTo: segments,
        segments,
        payload: { images },
        mark: 'persistent',
      })
      // One gallery per tile: the merged record replaces the old ones.
      for (const e of existing) removeDecoration({ sig: e.sig, segments })

      this.#log(
        `Lightbox — ${added.length} image${added.length === 1 ? '' : 's'} on "${label}" (${images.length} total)`,
        '▶',
      )
    } catch (err) {
      console.warn('[/lightbox add] failed', err)
      this.#log('Lightbox — could not add those images (see console)')
    }
  }

  #log(message: string, icon = '▶'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _lightbox = new LightboxQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LightboxQueenBee', _lightbox)

// Visual-bee registration — ONE declaration the renderer, the ViewBee toggle,
// adoption, the command line's `name@lightbox` vocabulary and the Beehaviors
// panel all read.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: LIGHTBOX_VIEW,
      slashCommand: '/lightbox',
      iconName: 'lightbox',
      toggleIcon: 'photo_library',
      behavior: 'render',
      decorationKind: GALLERY_KIND,
      labelKey: 'view.lightbox',
      descriptionKey: 'view.lightbox.description',
      queenKey: '@diamondcoreprocessor.com/LightboxQueenBee',
      adoptable: true,
      // A lightbox on a CONTAINER shows the pictures of its children, so
      // adopting it must carry them — same reasoning as a slides deck.
      adoptScope: 'hierarchy',
      // Its content is what the tile ALREADY has (its picture, its children's
      // pictures), so writing the decoration IS the whole install — that is
      // what makes `name@lightbox` work straight off a dropped image.
      attachable: true,
      // A lightbox is a takeover by definition: clicking the tile shows the
      // pictures in place, and closing returns you to the layer you came from.
      opensOnTileClick: true,
      // Ships mobile-friendly: full-screen pictures are a first-class mobile
      // surface, and the viewer is the slides engine (already mobile-friendly).
      pheromones: ['mobile:friendly'],
    })
  },
)
