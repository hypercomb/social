// commands/scroller.queen.ts
//
// `/scroller` — THE FEED. A hive full of pictures and videos, flicked through
// one full screen at a time: the third surface of the slides engine
// (presentation/tiles/slides-view.drone.ts), gated by the attachable kind
// `visual:scroller:feed`.
//
// A BRANCH IS THE UNIT. The scroller plays a tile's CHILDREN, every one of
// them: a link to a video plays in place, a picture paints, a YouTube / Vimeo
// page embeds on tap, and anything else becomes a card (the child's name, its
// tile picture, `open`) — so the counter never lies about how many things are
// in the branch. It ALWAYS mounts the native snap scroller, phone or not: the
// flick IS the point of this view, where slides and lightbox only borrow it
// under mobile mode.
//
// Two doors, no typing needed on a phone:
//   • an undecorated BRANCH is OFFERED the scroller under "open as"
//     (`offersFor: ctx => ctx.isBranch` → the `view-open:scroller` icon);
//   • a branch that CARRIES the kind opens it on its own icon / the deck.
//
// Syntax:
//   /scroller                  — toggle hexagons ⇄ scroller (the layer you stand on)
//   /scroller on | off         — switch the view on / back to hexagons
//   /scroller here             — mark the tile you are standing IN as a feed
//                                (writes `visual:scroller:feed` through the
//                                same `feature:apply` seam `name@scroller` uses)
//   /scroller here off         — take the mark off again

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import { ENABLEMENT_CHANGED, readGlobalOnKinds, seedCohortOn } from '../sharing/behavior-enablement.js'

/** The view token — doubles as the ViewMode string. */
export const SCROLLER_VIEW = 'scroller'

/** The mark a branch wears to carry the feed. Payload-free: the feed is
 *  whatever the branch already holds, so writing the record IS the install. */
export const SCROLLER_KIND = 'visual:scroller:feed'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const ON_KEYWORDS = new Set(['on', 'open', 'go', 'play', 'view', 'feed'])
const OFF_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close', 'stop'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

export class ScrollerQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'scroller'
  override description = 'Scroller — flick through this branch\'s pictures and videos as a feed'
  override descriptionKey = 'slash.scroller'
  override options = ['on', 'off', 'here']
  override examples = [
    { input: '/scroller', result: 'Flick through the pictures and videos of the layer you are on' },
    { input: '/scroller here', result: 'Make the tile you are standing in a feed — it opens as one from its icon' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'here'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase().replace(/\s+/g, ' ')

    if (a === 'here' || a === 'mark' || a === 'attach') { this.#mark(false); return }
    if (a === 'here off' || a === 'unmark' || a === 'detach') { this.#mark(true); return }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) { this.#log('Scroller unavailable'); return }

    if (ON_KEYWORDS.has(a)) { vm.setMode(SCROLLER_VIEW); this.#log('Scroller — on', '▶'); return }
    if (OFF_KEYWORDS.has(a)) { vm.setMode('hexagons'); this.#log('Scroller — off', '○'); return }

    // Bare /scroller (or 'toggle') — flip.
    const next = vm.mode === SCROLLER_VIEW ? 'hexagons' : SCROLLER_VIEW
    vm.setMode(next)
    this.#log(next === SCROLLER_VIEW ? 'Scroller — on' : 'Scroller — off', next === SCROLLER_VIEW ? '▶' : '○')
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Put the feed mark on (or take it off) the tile you are standing IN — the
   *  branch whose children are the feed. Through `feature:apply`, the one
   *  seam every attach uses (the command line's `name@scroller`, the close-up's
   *  creation plate, the Beehaviors panel), so there is exactly one writer of
   *  the record: show-features' #applyFeature. */
  #mark(remove: boolean): void {
    const segments = this.#segments()
    if (segments.length === 0) {
      this.#log('Scroller — step into a tile first; the feed is what that tile holds', '▶')
      return
    }
    EffectBus.emit('feature:apply', { view: SCROLLER_VIEW, segments, remove })
  }

  #log(message: string, icon = '▶'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

/** A NEW KIND MUST NOT ARRIVE DARK. On a hive that already has an on-list, a
 *  kind nobody has ever seen is GLOBALLY OFF, so the first `/scroller here`
 *  would mark a tile whose feed then refuses to open — no error, nothing in
 *  the hidden pool. Lit as a COHORT, exactly as present.queen does: once, only
 *  after the census seed has materialized the on-list, and refused on a hive
 *  that opened dark. See project_new_view_arrives_dark_roster_trap. */
const SCROLLER_COHORT = 'scroller-feed'

const lightScrollerOnce = (): void => {
  if (!readGlobalOnKinds()) return
  seedCohortOn(SCROLLER_COHORT, [SCROLLER_KIND])
}
lightScrollerOnce()
EffectBus.on(ENABLEMENT_CHANGED, lightScrollerOnce)

const _scroller = new ScrollerQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ScrollerQueenBee', _scroller)

// Visual-bee registration — ONE declaration the renderer, the ViewBee toggle,
// the tile icons, the close-up deck, the command line's `name@scroller`
// vocabulary and the Beehaviors panel all read.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: SCROLLER_VIEW,
      slashCommand: '/scroller',
      iconName: 'scroller',
      // A ligature the SHIPPED icon subset actually carries (public/fonts/
      // icons.txt): a name outside it renders as its own word on every DOM
      // surface. Pages that turn — a feed you flick through.
      toggleIcon: 'auto_stories',
      behavior: 'render',
      decorationKind: SCROLLER_KIND,
      labelKey: 'view.scroller',
      descriptionKey: 'view.scroller.description',
      queenKey: '@diamondcoreprocessor.com/ScrollerQueenBee',
      adoptable: true,
      // The feed IS the branch's children, so adopting a feed has to carry the
      // subtree — a mark on an empty tile is no feed at all.
      adoptScope: 'hierarchy',
      // Its content is what the branch ALREADY holds, so writing the record is
      // the whole install: `name@scroller`, the creation plate, `/scroller here`.
      attachable: true,
      // Its icon opens the feed IN PLACE over the current layer; closing lands
      // you back where you opened it. Tile-body taps still enter the tile.
      opensOnTileClick: true,
      // An undecorated BRANCH is offered the feed under "open as" — a hive full
      // of pictures should be flickable without first typing a mark onto it.
      offersFor: ctx => ctx.isBranch,
      // The feed is the phone's view; the desktop gets the same scroller.
      pheromones: ['platform:mobile', 'platform:desktop'],
    })
  },
)
