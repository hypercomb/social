// commands/lightbox.queen.ts
//
// `/lightbox` — the LIGHTBOX view behaviour, and the bee that owns the
// `visual:lightbox:gallery` kind. Before this existed the kind was an orphan:
// essentials wrote it and read it, but nothing declared it, so every tile
// carrying one reported an unrecognized beehavior.
//
// ── What a lightbox shows ─────────────────────────────────────────────
//
// THE SET, if this tile is enrolled in one. A lightbox is the picture-facing
// VIEW of the same relation the slides view plays: every artifact wearing the
// mark, wherever it lives, opened AT the one you arrived through. Enrolling is
// `/enroll` and is not a lightbox command — a website, a slide and a photo all
// join a set the same way (pheromones/enrollment.ts).
//
// Otherwise, WHAT THIS TILE ITSELF HOLDS:
//   1. its own pictures — a `visual:lightbox:gallery` decoration whose payload
//      is `{ images: [ref, …] }` (written by `/lightbox add`)
//   2. its own picture — the tile's link/display image, so a tile you made by
//      dropping ONE image is already a one-picture lightbox
//
// RETIRED — its CHILDREN's pictures. A lightbox on a container used to be the
// gallery of everything dropped inside it, which made the container the thing
// that held the set. That path survives as a read-only fallback so existing
// hives keep working; the way to build a gallery now is to enrol pictures in a
// website artifact, which lets one picture belong to several galleries and lets
// a gallery hold pictures that live anywhere.
//
// Each entry in `images[]` is a LIFE PRIMITIVE hop — the signature of a meta
// envelope carrying the bytes, never the bytes' own signature. Raw legacy
// entries still resolve; nothing writes one again.
//
// ── Syntax ────────────────────────────────────────────────────────────
//   /lightbox                    — toggle hexagons ↔ lightbox
//   /lightbox on | open | view   — open the lightbox
//   /lightbox off | hex          — back to hexagons
//   /lightbox add | attach       — pick image files and hold them on this tile
//   /lightbox clear              — take the pictures off this tile (the images
//                                  themselves stay — they're content-addressed)
//
// `name@lightbox` from the command line attaches it declaratively (the
// behaviour is `attachable`: its content is what the tile already has, so
// writing the decoration IS the whole install). Clicking its photo-library
// icon opens it in place; clicking the tile body still navigates normally.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { writeDecoration, listDecorations, removeDecoration } from './decoration-manifest.js'
import { SITE_ARTIFACT_KIND } from '../pheromones/enrollment.js'
import { mintContentRef, terminalContentSig } from '../presentation/tiles/artifact-content.js'

/** Pictures held on a tile — the lightbox's own content, and a source for any
 *  view that renders a set this tile is enrolled in. Payload:
 *  `{ images: [ref, …] }`, where each ref is a Life Primitive content hop. */
export const GALLERY_KIND = 'visual:lightbox:gallery'

/** The slot a picture's incidence is held in. Distinct from a slide's, so the
 *  same bytes used both ways mint two envelopes rather than colliding. */
export const PICTURE_RELATION = 'picture'

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

/**
 * Every picture held on a tile, RESOLVED to the signature of its bytes.
 *
 * The payload declares a Life Primitive hop — a meta envelope under the current
 * model, a raw resource signature under the retired one — and this seam follows
 * it, so every caller gets the same thing it always got. That matters because
 * `Store.getResource` does NOT follow the hop: a consumer handed an envelope
 * signature would fetch the envelope's JSON and try to paint it as a picture.
 * Resolving once, here, is what keeps the full-screen lightbox and the images
 * chooser both correct without either learning about incidences.
 *
 * An envelope whose target is not held locally resolves to itself, which is the
 * honest answer — the caller's own fetch cascade is what can still reach it, and
 * `fetchThroughContentHop` is how it should.
 */
export async function galleryImageSigsAt(segments: readonly string[]): Promise<string[]> {
  const out: string[] = []
  const store = get<{ getResourceLocal?(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
  try {
    const decorations = await listDecorations<{ images?: unknown }>({
      kind: GALLERY_KIND,
      segments,
    })
    for (const { record } of decorations) {
      const images = record.payload?.images
      if (!Array.isArray(images)) continue
      for (const value of images) {
        const ref = String(value)
        if (!SIG.test(ref)) continue
        const imageSig = store?.getResourceLocal
          ? (await terminalContentSig(store as { getResourceLocal(s: string): Promise<Blob | null> }, ref)) ?? ref
          : ref
        if (!out.includes(imageSig)) out.push(imageSig)
      }
    }
  } catch { /* no readable gallery at this location */ }
  return out
}

export class LightboxQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lightbox'
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
        const bytesSig = await store.putResource(blob)
        if (!SIG.test(bytesSig)) continue
        // THE LIFE PRIMITIVE: the gallery points at a typed incidence, and the
        // incidence points at the bytes. Never raw bytes in a payload field.
        const ref = await mintContentRef(store, bytesSig, PICTURE_RELATION)
        if (SIG.test(ref)) added.push(ref)
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
      // A website artifact opens this face too: the lightbox and the slides
      // view are two VIEWS of one relation, not two containers.
      alsoKinds: [SITE_ARTIFACT_KIND],
      labelKey: 'view.lightbox',
      descriptionKey: 'view.lightbox.description',
      queenKey: '@diamondcoreprocessor.com/LightboxQueenBee',
      adoptable: true,
      // A tile's pictures are ITS OWN — there is no subtree to carry. A gallery
      // travels the way its relation does: member by member, each wearing the
      // same mark. (The retired children source is why this used to be
      // 'hierarchy'; it is a read-only fallback now.)
      adoptScope: 'tile',
      // Its content is what the tile ALREADY has (its picture, its children's
      // pictures), so writing the decoration IS the whole install — that is
      // what makes `name@lightbox` work straight off a dropped image.
      attachable: true,
      // Its photo-library icon shows the pictures in place, and closing returns
      // you to the layer where the icon was clicked.
      opensOnTileClick: true,
      // Retained as a legacy ordering hint; icon clicks identify the exact view.
      takeoverRank: 1,
      // Ships mobile-friendly: full-screen pictures are a first-class mobile
      // surface, and the viewer is the slides engine (already mobile-friendly).
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
  },
)
