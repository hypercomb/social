// /square-tile-view — the SQUARE TILE VIEW. A cell carrying
// `visual:square-tile:view` opens as a bright page whose ELEMENTS are the
// cell's children: each child tile becomes a square plate in a clean centred
// gallery grid, and stepping through a plate navigates into that child —
// whose own arrival face takes the surface from there.
//
// One layer at a time: the view renders exactly the layer you stand on;
// child layers are doorways, not content. It is a BRANCH scope: the mark at
// a root makes the view available on every descendant, so a `view:default`
// mark at the root can cover the whole branch (nearest mark wins; an
// explicit `hexagons` mark opts a page back out).
//
// HISTORY: born as the Revolución welcome threshold
// (`visual:revolucion:welcome` / `revolucion-welcome`, revolucionstyle.com).
// Renamed and promoted first-class 2026-08-23. Marks and `view:default`
// payloads written under the old names live on layers in the wild — the
// registry's `legacyKinds` and the view-token alias in
// decoration-kind-index keep them recognized. Writers mint only the new
// names.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from './visual-bee-registry.js'
import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'

export const SQUARE_TILE_VIEW = 'square-tile-view'
export const SQUARE_TILE_KIND = 'visual:square-tile:view'

/** The retired Revolución names — read-side aliases only, never written. */
export const LEGACY_WELCOME_VIEW = 'revolucion-welcome'
export const LEGACY_WELCOME_KIND = 'visual:revolucion:welcome'

/** Payload of a `visual:square-tile:view` record. Everything is optional —
 *  the view is built from the cell's CHILDREN, not from authored content. */
export interface SquareTilePayload {
  readonly version: 1
  /** Headline over the grid. Falls back to the cell's title. */
  readonly title?: string
  /** One line under the headline. */
  readonly tagline?: string
}

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class SquareTileViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'square-tile-view'
  override readonly aliases = ['welcome', 'threshold']
  override description = 'Square tile view — the layer\'s children as square plates on a bright page'
  override options = ['here [tagline]', 'remove', 'on', 'off']
  override examples = [
    { input: '/square-tile-view here Walk in — the room is yours', result: 'Marks the current cell as a square-tile page' },
    { input: '/square-tile-view', result: 'Opens or closes the square tile view' },
    { input: '/square-tile-view remove', result: 'Takes the square-tile mark off the current cell' },
  ]

  protected async execute(args: string): Promise<void> {
    const trimmed = args.trim()
    const [verb = ''] = trimmed.toLowerCase().split(/\s+/, 1)

    if (verb === 'here' || verb === 'mark' || verb === 'attach') {
      await this.#attach(trimmed.slice(verb.length).trim())
      return
    }
    if (verb === 'remove' || verb === 'detach') {
      await this.#remove()
      return
    }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (verb === 'off' || verb === 'close') {
      vm.setMode('hexagons')
      return
    }
    vm.setMode(verb === 'on' || verb === 'open'
      ? SQUARE_TILE_VIEW
      : vm.mode === SQUARE_TILE_VIEW ? 'hexagons' : SQUARE_TILE_VIEW)
  }

  #segments(): string[] {
    return [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
  }

  /** One live record per cell — re-marking replaces, never piles. */
  async #attach(tagline: string): Promise<void> {
    const segments = this.#segments()
    const payload: SquareTilePayload = { version: 1, ...(tagline ? { tagline } : {}) }
    await replaceDecoration({
      kind: SQUARE_TILE_KIND,
      appliesTo: segments,
      segments,
      payload,
      mark: 'persistent',
    })
    EffectBus.emit('activity:log', { message: 'Square tile view set on this cell', icon: 'grid_view' })
  }

  /** Removes the mark — under its current name AND the retired one, so a
   *  remove on a legacy-marked cell actually clears it (drain-on-remove). */
  async #remove(): Promise<void> {
    const segments = this.#segments()
    const existing = [
      ...await listDecorations({ kind: SQUARE_TILE_KIND, segments }),
      ...await listDecorations({ kind: LEGACY_WELCOME_KIND, segments }),
    ]
    if (!existing.length) return
    await Promise.all(existing.map(record =>
      removeDecorationAndWait({ sig: record.sig, segments })))
    EffectBus.emit('activity:log', { message: 'Square tile view removed', icon: 'grid_view' })
  }
}

const _squareTileView = new SquareTileViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SquareTileViewQueenBee', _squareTileView)

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  registry => registry.register({
    view: SQUARE_TILE_VIEW,
    slashCommand: '/square-tile-view',
    iconName: 'grid_view',
    toggleIcon: 'grid_view',
    behavior: 'render',
    decorationKind: SQUARE_TILE_KIND,
    // Marks written while this was the Revolución welcome threshold.
    legacyKinds: [LEGACY_WELCOME_KIND],
    labelKey: 'view.squareTileView',
    descriptionKey: 'view.squareTileView.description',
    queenKey: '@diamondcoreprocessor.com/SquareTileViewQueenBee',
    adoptable: true,
    // The content IS the cell's children — no authoring step, so a bare
    // `name@square-tile-view` install works.
    attachable: true,
    // The view opens where the tile stands — the children behind it
    // are what the view shows.
    opensOnTileClick: true,
    // An APPLICATION SCOPE: one mark at a root makes every descendant a
    // member — the toggle follows you down the branch, which is what lets
    // a `view:default` mark at the root cover the WHOLE branch (the view
    // renders any layer's children as plates, so it mounts anywhere
    // inside). A descendant opts out with its own `view:default` mark —
    // nearest mark wins.
    scope: 'branch',
    pheromones: ['platform:mobile', 'platform:desktop'],
  }),
)
