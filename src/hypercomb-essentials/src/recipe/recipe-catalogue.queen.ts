// recipe/recipe-catalogue.queen.ts
//
// `catalogue`: THE WORD THAT OPENS THE CATALOGUE, AND THE FACE A PUBLISHED
// DOOR OPENS ON WHEN IT HAS NO TILES AND NO VIEW OF ITS OWN. The catalogue
// lists what the reader's sources offer, or, on a door, what the door's own
// zone offers (recipe-catalogue-view.drone.ts). This file is the two ways
// into it.
//
// THE WORD only ASKS. It announces where the reader stood (`view:spawn`, the
// record presentation/tiles/view-spawn.ts describes), then enters the view
// mode. The view's drone sleeps until that mode is entered, and leaving the
// view lands on the surface it was opened from.
//
// THE DEFAULT FACE is a visitor's arrival and nobody's command. Publishing
// is the whole step (P1, T9): a door with nothing else to show opens on what
// its host offers, with no menu entry and no page made for it. So the
// catalogue is entered by itself ONLY when a visitor stands at a published
// door's root, the hexagons are up, the root has SETTLED WITH NO TILES, the
// place names NO VIEW OF ITS OWN, and the door's host offers at least one
// recipe entry. A door whose root holds tiles keeps its hexagons: a
// publisher's index is one object on every door of the host, so what is
// offered there is no proof it was published at this address, and it must
// not take the landing face of a door that has a face of its own. The word
// `catalogue` still opens it anywhere. Never inside a hive: there the
// catalogue opens only when asked (T5). Never over a view that is already up,
// or over tiles that arrived while the host was asked. The host is asked once
// per page load, and a visitor who left the catalogue is not put back in it
// until they arrive at the root again.
//
// The watcher lives here and not in the view's drone because that drone is
// asleep until its mode is entered: something awake has to decide to enter it.
// It subscribes when this module loads, which is what keeps this queen awake
// (essentials scripts/passive-queen.ts: a queen that acts on load never sleeps).
//
// NOT IN THE VIEWS REGISTRY. A visual-bee descriptor requires a decoration
// kind, and the catalogue marks no tile and declares no slot, so it is left
// unregistered: it has no tile icon and no toggle, only this word and the
// face. It lights nothing and leaves nothing in a pool.
//
// This queen declares no machine grammar and no alias.

import { EffectBus, QueenBee, get } from '@hypercomb/core'
import { HEXAGONS, VIEW_SPAWN_EFFECT, type ViewSpawn } from '../presentation/tiles/view-spawn.js'
import { isPublishedVisitorShell } from '../sharing/behavior-enablement.js'
import { zoneDoor } from '../sharing/zone-door.js'
import { findRecipeEntries } from './recipe-entries.js'

/** The view-mode token the catalogue's drone renders. */
const VIEW = 'catalogue'
/** The verdict the view bee announces for each place: `{ segments, view, held? }`, `view: ''` for the hexagons. */
const ARRIVAL = 'view:arrival'
/** What the grid says after each paint: `{ count, settled? }`. */
const CELLS_COUNTED = 'render:cell-count'

type ViewModeShape = { mode?: string; setMode?(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[]; addEventListener?: EventTarget['addEventListener']; removeEventListener?: EventTarget['removeEventListener'] }

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const names = (segments: unknown): string[] =>
  Array.isArray(segments) ? segments.map(part => String(part ?? '').trim()).filter(Boolean) : []

const here = (): string[] => names([...(live<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])])

export class RecipeCatalogueQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'catalogue'
  override description = 'Browse the recipes your nodes offer: the domains you follow and the room you joined'
  override descriptionKey = 'slash.catalogue'
  override examples = [
    { input: '/catalogue', result: 'Opens the list of recipes offered by the domains switched on in the shelf and by the room you joined' },
  ]

  protected execute(): void {
    const vm = live<ViewModeShape>('@hypercomb.social/ViewMode')
    const mode = String(vm?.mode ?? '').trim()
    if (!vm?.setMode || mode === VIEW) return
    // Where the reader stood and what was up, said before the view takes over:
    // the view's drone hears it by replay when the mode wakes it, so it is stamped.
    const spawn: ViewSpawn & { at: number } = { view: VIEW, mode, segments: here(), at: Date.now() }
    EffectBus.emit(VIEW_SPAWN_EFFECT, spawn)
    vm.setMode(VIEW)
  }
}

// ── the default face of a published door ────────────────────────────────────

/** What the face decides with. Every part has a live stand-in. */
export interface RecipeCatalogueFaceDeps {
  /** True on a published door. The face is never offered anywhere else. */
  visitor(): boolean
  /** The view mode that is up. */
  mode(): string
  enter(mode: string): void
  /** Where the visitor stands. Empty at the door's root. */
  here(): readonly string[]
  /** Tell when the visitor walks. Answers the way to stop being told. */
  onWalk(walked: () => void): () => void
  /** The door's own zone. */
  zone(): string
  /** Whether the host at `zone` offers at least one recipe entry: one bounded read. */
  offers(zone: string): Promise<boolean>
}

const liveFaceDeps = (): RecipeCatalogueFaceDeps => ({
  visitor: isPublishedVisitorShell,
  mode: () => String(live<ViewModeShape>('@hypercomb.social/ViewMode')?.mode ?? '').trim(),
  enter: mode => live<ViewModeShape>('@hypercomb.social/ViewMode')?.setMode?.(mode),
  here,
  onWalk: walked => {
    const lineage = live<LineageShape>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', walked)
    return () => lineage?.removeEventListener?.('change', walked)
  },
  zone: () => zoneDoor(location.host),
  offers: async zone => (await findRecipeEntries({ zones: [zone] })).length > 0,
})

/**
 * Watch a published door for the moment its root has nothing of its own to
 * open on, and enter the catalogue then. That moment needs both: the grid
 * settled with no tile on the root, and the view bee named no view for it
 * (its verdict says "the hexagons", or no verdict came: a root with no layer
 * to read). A root that holds tiles is never taken over.
 * Answers the way to stop watching. Does nothing at all outside a door.
 */
export function watchRecipeCatalogueFace(deps: RecipeCatalogueFaceDeps = liveFaceDeps()): () => void {
  if (!deps.visitor()) return () => undefined
  /** What the view bee decided for the root: a view's name, '' for the hexagons, null before any verdict. */
  let verdict: string | null = null
  /** The grid's last word for the root: settled, with no tile on it. */
  let bare = false
  /** This arrival at the root was answered: entered, or found to offer nothing. */
  let answered = false
  /** The face is up because this watcher put it up. */
  let entered = false
  /** The one read of this page load. */
  let asked: Promise<boolean> | null = null
  let stopped = false

  const atRoot = (): boolean => deps.here().length === 0
  const grid = (): boolean => (deps.mode() || HEXAGONS) === HEXAGONS

  const consider = (): void => {
    if (stopped || answered || !atRoot() || !grid()) return
    // The root holds tiles of its own, or has not settled yet and may still show some.
    if (!bare) return
    // The place opens as a view of its own.
    if (verdict) return
    answered = true
    const zone = deps.zone()
    if (!zone) return
    asked ??= deps.offers(zone).catch(() => false)
    void asked.then(offered => {
      // Never over a view or tiles that came up meanwhile, never after the visitor walked on.
      if (stopped || !offered || !atRoot() || !grid() || !bare || verdict) return
      entered = true
      deps.enter(VIEW)
    })
  }

  const offArrival = EffectBus.on(ARRIVAL, (arrival: { segments?: unknown; view?: unknown; held?: unknown } | undefined) => {
    // A held arrival is a site moving between its own pages: nothing was decided.
    if (!arrival || arrival.held === true || names(arrival.segments).length) return
    verdict = String(arrival.view ?? '').trim()
    // The place named its own view after the face went up: the face steps aside for it.
    if (verdict && entered && deps.mode() === VIEW) {
      entered = false
      deps.enter(verdict)
      return
    }
    consider()
  })
  const offCells = EffectBus.on(CELLS_COUNTED, (counted: { count?: unknown; settled?: unknown } | undefined) => {
    if (!atRoot()) return
    bare = counted?.settled === true && Number(counted.count ?? 0) === 0
    consider()
  })
  const offWalk = deps.onWalk(() => {
    if (atRoot()) return
    // Away from the root: the next arrival there is a new one, and the root's face does not ride along.
    verdict = null
    bare = false
    answered = false
    if (entered && deps.mode() === VIEW) deps.enter(HEXAGONS)
    entered = false
  })

  return () => {
    stopped = true
    offArrival()
    offCells()
    offWalk()
  }
}

watchRecipeCatalogueFace()

window.ioc.register('@diamondcoreprocessor.com/RecipeCatalogueQueenBee', new RecipeCatalogueQueenBee())
