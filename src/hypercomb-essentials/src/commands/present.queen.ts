// commands/present.queen.ts
//
// `/present` — the SLIDES view behaviour. The render surface is a SINGLE GLOBAL
// flag (ViewModeService): `/present on` switches to slides, `/present off`
// returns to hexagons, bare `/present` toggles.
//
// ── This command no longer owns a container ──────────────────────────
//
// The retired model needed a PARENT: a cell wore `visual:diagram:deck` and its
// CHILDREN were the slides, so presenting anything meant first minting a box to
// hold it. That kind is retired — read-only, so existing decks still play, but
// nothing writes one.
//
// What `/present` owns now is exactly two things, and neither is a relation:
//
//   • the VIEW — hexagons ⇄ slides;
//   • `/present slide` — attach bytes to THIS tile so it IS a slide.
//
// RELATING artifacts is `/enroll`, which is not a slides command at all: a
// website, a slide, a photo and a page all enrol the same way, into the same
// kind of set. That is the point — no behaviour teaches its own container any
// more. See commands/enroll.queen.ts and
// documentation/website-artifact-paradigm.md.
//
// Syntax:
//   /present                    — toggle hexagons ⇄ slides (global)
//   /present on | play | view   — switch to slides view
//   /present off | hex          — back to hexagons
//   /present slide              — connect a file: pick an SVG/image/video/audio
//                                 and make the CURRENT tile a slide
//
// The render itself is SlidesViewDrone (presentation/tiles/slides-view.drone.ts).

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { listDecorations, replaceDecoration } from './decoration-manifest.js'
import { ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn } from '../sharing/behavior-enablement.js'
import { SITE_ARTIFACT_KIND } from '../pheromones/enrollment.js'
import {
  LEGACY_DECK_KIND,
  SLIDE_KIND,
  mintSlideContent,
  type SlidePayload,
} from '../presentation/tiles/slide-artifact.js'

export { SLIDE_KIND, SITE_ARTIFACT_KIND, LEGACY_DECK_KIND }

/** RETIRED alias. `visual:diagram:deck` is read-only legacy — kept exported so
 *  nothing that imported it breaks, never written. */
export const DECK_KIND = LEGACY_DECK_KIND

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
  override description = 'Slides view — play the presentation this tile belongs to, one screen at a time'
  override descriptionKey = 'slash.present'
  override options = ['on', 'off', 'slide']
  override examples = [
    { input: '/present', result: 'Plays the presentation this tile belongs to' },
    { input: '/present slide', result: 'Attach an SVG/image/video to make this tile a slide' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'slide'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'slide' || a === 'add' || a === 'attach') { this.#attachSlide(); return }
    // The retired container words. They used to mint a deck; there is no deck.
    if (a === 'here' || a === 'mark' || a === 'site') {
      this.#log('Slides — nothing holds slides any more. /present slide makes this tile one; /enroll <website> relates it in', '▶')
      return
    }

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

  /** Connect-a-file: open a picker, store the chosen bytes as a resource, wrap
   *  them in their Life-Primitive incidence, and stamp the CURRENT tile with a
   *  `visual:diagram:slide` decoration. Nothing above it is touched — there is
   *  no parent to mark. The picker opens synchronously so it rides the command's
   *  user-activation; the storing happens after the user picks. */
  #attachSlide(): void {
    const segments = this.#segments()
    if (segments.length === 0) {
      this.#log('Slides — stand on a tile first, then /present slide to make it a slide', '▶')
      return
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/svg+xml,image/*,video/*,audio/*'
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
      const bytesSig = await store.putResource(blob)
      // THE LIFE PRIMITIVE: the slide points at a typed incidence, and the
      // incidence points at the bytes. Never a raw resource sig in a payload.
      const content = await mintSlideContent(store, bytesSig)
      const title = file.name.replace(/\.[^.]+$/, '') || segments[segments.length - 1]

      // A caption already written is the participant's, not this command's, so
      // it survives re-attaching different bytes. No position is written here:
      // where a slide sits is a fact about its MEMBERSHIP, and `/enroll` puts it
      // on the mark.
      const existing = await listDecorations<SlidePayload>({ kind: SLIDE_KIND, segments })
      const caption = existing[0]?.record.payload?.caption
      await replaceDecoration({
        kind: SLIDE_KIND,
        appliesTo: segments,
        segments,
        payload: { content, title, ...(typeof caption === 'string' && caption ? { caption } : {}) },
        mark: 'persistent',
      })

      this.#log(`Slides — "${title}" is a slide; /enroll <website> relates it into a presentation`, '▶')
    } catch (err) {
      console.warn('[/present slide] failed', err)
      this.#log('Slides — could not attach that file (see console)')
    }
  }

  #log(message: string, icon = '▶'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

/** THE REMODEL MUST NOT ARRIVE DARK. The slides view's gate kind moved from the
 *  retired container to the two kinds that replaced it — and on a hive that
 *  already has an on-list, a kind nobody has ever seen is GLOBALLY OFF. Without
 *  this seed, decks that worked yesterday would flip straight back to hexagons
 *  with no error and nothing in the hidden pool. Lit as a COHORT: once, only
 *  after the census seed has materialized the on-list, and refused outright on a
 *  hive that opened dark — a hive that started with nothing lit must never have
 *  a light appear behind the participant.
 *  See project_new_view_arrives_dark_roster_trap. */
const SLIDES_COHORT = 'slide-artifact'

const lightSlidesOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(SLIDES_COHORT, [SLIDE_KIND, SITE_ARTIFACT_KIND])
}
lightSlidesOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightSlidesOnce)

const _present = new PresentQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PresentQueenBee', _present)

// Visual-bee registration — declares the view identity so the renderer + ViewBee
// toggle + adoption UI can discover the slides behaviour.
//
// The toggle surfaces on the SLIDE itself (`decorationKind`) and on the WEBSITE
// ARTIFACT that names the relation (`alsoKinds`) — the two things a participant
// can stand on. `legacyKinds` keeps the retired container recognized so decks
// made under the old model still play.
//
// `adoptScope: 'tile'` because a slide IS atomic: there is no child subtree to
// carry. A presentation travels the way its relation does — member by member,
// each wearing the same mark — which is the point of dropping the container.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'slides',
      slashCommand: '/present',
      iconName: 'slides',
      toggleIcon: 'slideshow',
      behavior: 'render',
      decorationKind: SLIDE_KIND,
      alsoKinds: [SITE_ARTIFACT_KIND],
      legacyKinds: [LEGACY_DECK_KIND],
      labelKey: 'view.slides',
      descriptionKey: 'view.slides.description',
      queenKey: '@diamondcoreprocessor.com/PresentQueenBee',
      adoptable: true,
      adoptScope: 'tile',
      // A slide's content IS whatever the tile already points at, so
      // `diagram@slides` only has to write the slide decoration — no authoring
      // pass, no slash-command toggle.
      attachable: true,
      // Clicking a slide's slideshow icon plays its presentation in place,
      // opened AT that slide; clicking the tile body still enters its layer.
      opensOnTileClick: true,
      // Ships mobile-friendly: slides playback is a first-class mobile surface
      // (and the gallery view reuses its engine).
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
  },
)
