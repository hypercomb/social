// presentation/tiles/viewer-walk.ts
//
// THE ORTHOGONAL GRAMMAR — two axes, and they never mean the same thing.
//
//   ↕  DOWN / UP      move INSIDE the thing you are looking at.
//                     The next slide, the next picture, the next section.
//                     Whatever "more of this" means to that viewer.
//
//   ↔  SIDEWAYS       move to the NEXT TILE along the row you came from,
//                     and STAY IN THE SAME VIEWER if the next tile has one.
//
//   ⊙  THE CLOSE-UP   pick WHICH viewer. It is the third axis, and it is
//                     where you land when the sideways step arrives at a
//                     tile that does not carry the viewer you were in.
//
// A phone user already knows this shape: a feed scrolls one way and changes
// subject the other. What the hive adds is that the subject is a TILE and the
// viewer is a CHOICE — so the sideways step has to answer a question a feed
// never has to: *does the tile I just arrived at have this viewer?*
//
//   YES → open it there. You never leave the viewer; the deck you were
//         reading becomes the next tile's deck. This is the whole point —
//         "if they have the same viewer you could just go straight to it".
//   NO  → open that tile's CLOSE-UP instead, which is exactly the screen
//         for choosing another option. You have not been dumped on the hive;
//         you have been handed the menu for where you now are.
//
// WHY THIS IS ONE MODULE AND NOT A METHOD ON EACH VIEWER. Every viewer needs
// the identical three answers — what row am I on, does that tile carry me, how
// do I open myself over there — and a viewer that answers any of them slightly
// differently is a viewer the grammar stops being true in. The row is tracked
// once here, from the render pass that every surface already publishes.
//
// NOTHING IS HAND-LISTED. "Does the tile carry this viewer" is the decoration
// index answering about a REGISTERED bee, and opening is the bee's own
// `view-enter:` action routed by visual-bee-icons — the same path the on-tile
// icon uses. A behaviour that registers itself gets the sideways walk for
// free, and a behaviour nobody has written yet will too.

import { EffectBus } from '@hypercomb/core'
import { hasDecorationKind } from '../../commands/decoration-kind-index.js'
import type { VisualBeeRegistry } from '../../commands/visual-bee-registry.js'

/** Where a sideways step lands. */
export type WalkTarget =
  /** The next tile carries this viewer — open it there and stay in it. */
  | { readonly kind: 'view'; readonly label: string }
  /** It does not — open its close-up so another option can be chosen. */
  | { readonly kind: 'tile'; readonly label: string }

/** THE ROW. Every tile the last render put on screen, in render order — the
 *  same list the close-up walks, tracked once for every viewer that walks it.
 *  `render:cell-count` is the only source: it is published by the render pass
 *  itself, so it is true for whatever surface is up, including none. */
let ROW: string[] = []

EffectBus.on<{ labels?: unknown }>('render:cell-count', payload => {
  const labels = Array.isArray(payload?.labels) ? payload.labels : []
  ROW = labels.map(s => String(s ?? '')).filter(Boolean)
})

/** The tile `delta` places along the row, wrapping at both ends. Null when
 *  there is nowhere to go — one tile on the layer, or this tile is no longer
 *  in it (deleted out from under the viewer). */
export function nextTile(label: string, delta: number): string | null {
  if (!label || ROW.length < 2) return null
  const at = ROW.indexOf(label)
  if (at < 0) return null
  const count = ROW.length
  const next = ROW[(at + (delta % count) + count) % count]
  return next && next !== label ? next : null
}

/** Does this tile carry this viewer's content? The registered bee's own
 *  decoration kind, asked of the index — never a per-view special case. */
export function tileHasView(label: string, view: string): boolean {
  const registry = window.ioc?.get?.<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  const bee = registry?.get?.(view)
  if (!bee || bee.behavior === 'navigation') return false
  return hasDecorationKind(label, bee.decorationKind)
}

/** The action name that OPENS a viewer on a tile — the affordance every render
 *  behaviour registers for the tiles that carry its content. The close-up
 *  partitions the overlay's icon set on this prefix: what opens the tile on
 *  one side, what acts on it on the other. */
export const VIEW_ENTER_PREFIX = 'view-enter:'

/** Every viewer this tile actually carries — the options its close-up can
 *  offer, and what a sideways step has to choose from. */
export function viewsFor(label: string): string[] {
  const registry = window.ioc?.get?.<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  return (registry?.all?.() ?? [])
    .filter(bee => bee.behavior !== 'navigation' && hasDecorationKind(label, bee.decorationKind))
    .map(bee => bee.view)
}

/**
 * ONE SIDEWAYS STEP, decided but NOT performed.
 *
 * The caller is the viewer being left, and only it knows how to close itself
 * (a mode flip, an unmount, a takeover release). So this answers *where* and
 * leaves *how* alone — close first, then `open(target)`.
 */
export function walkFrom(label: string, view: string, delta: number): WalkTarget | null {
  const next = nextTile(label, delta)
  if (!next) return null
  return { kind: tileHasView(next, view) ? 'view' : 'tile', label: next }
}

/** Open a viewer on a tile — through the bee's OWN `view-enter:` action, so
 *  in-place views mount in place and navigating views navigate, exactly as
 *  they do when the icon on the tile is pressed. */
export function openView(view: string, label: string): void {
  // A step along the row inside a viewer moves the subject, not the door: the
  // way back stays the close-up, now of the tile we stepped onto.
  if (ENTRY && ENTRY.view === view) ENTRY.label = label
  EffectBus.emit('tile:action', { action: `view-enter:${view}`, label })
}

/** Open a tile's CLOSE-UP — the screen for choosing another option. */
export function openTileMenu(label: string, segments?: readonly string[]): void {
  const at = segments ?? readLineage()
  EffectBus.emit('tile:view-open', { label, segments: at })
}

function readLineage(): string[] {
  const lineage = window.ioc?.get?.<{ explorerSegments?: () => readonly string[] }>(
    '@hypercomb.social/Lineage',
  )
  return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
}

// ── the way back out of a viewer ───────────────────────────

/**
 * THE CLOSE-UP IS WHERE A VIEWER WAS CHOSEN, SO IT IS WHERE CLOSING ONE RETURNS.
 *
 * Picking "open as …" is a question with several answers, and a viewer's X is
 * very often "not that one". Landing on the hive instead means finding the tile
 * again and holding it again just to see the same five chips — the choice is
 * thrown away every time it is exercised.
 *
 * WHY REMEMBERED RATHER THAN MEASURED. The close-up used to stay mounted under
 * whatever it opened and reveal itself again when the cover went (`#suspend`).
 * That works for a panel or an editor; it cannot work for a viewer, because
 * half of them NAVIGATE into the tile to open (`visual-bee-icons`
 * `dispatchEnterAction`) and navigation tears the close-up down — closing then
 * drops you on the tile's inside, one layer from where you started, with no
 * close-up left to reveal. One recorded entry point survives both kinds.
 *
 * ONE ENTRY, CONSUMED ONCE. Armed only when the viewer we opened actually
 * becomes the mode, and dropped on the first mode change after that — so a
 * viewer left for ANOTHER viewer hands the return over to nobody, and a stale
 * entry can never surprise a later close with a close-up nobody asked for.
 */
type CloseUpEntry = {
  /** Follows a sideways step: after walking the row inside a viewer, the way
   *  back is the close-up of the tile you are ACTUALLY looking at. */
  label: string
  readonly view: string
  /** The layer the close-up was open ON — where the return has to land, which
   *  for a navigating viewer is NOT where its close leaves the lineage. */
  readonly segments: readonly string[]
  armed: boolean
}

let ENTRY: CloseUpEntry | null = null

/** Record that this viewer is being opened FROM a tile's close-up, so its
 *  close comes back here. Called by the close-up as it hands over. */
export function rememberCloseUpEntry(view: string, label: string, segments: readonly string[]): void {
  if (!view || !label) return
  ENTRY = { view, label, segments: [...segments], armed: false }
}

/** Forget the way back — the close-up was left by a door that is not a viewer. */
export function forgetCloseUpEntry(): void { ENTRY = null }

function returnToCloseUp(entry: CloseUpEntry): void {
  // A navigating viewer went INTO the tile to open; the close-up belongs to the
  // layer above it. Put the lineage back before the card is asked for, or it
  // mounts for a tile the current layer no longer contains.
  const here = readLineage()
  const same = here.length === entry.segments.length
    && here.every((segment, i) => segment === entry.segments[i])
  if (!same) {
    const nav = window.ioc?.get?.<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
    nav?.goRaw?.(entry.segments)
  }
  openTileMenu(entry.label, entry.segments)
}

type ViewModeLike = EventTarget & { mode: string }

window.ioc?.whenReady?.<ViewModeLike>('@hypercomb.social/ViewMode', vm => {
  vm.addEventListener('change', () => {
    const entry = ENTRY
    if (!entry) return
    const mode = vm.mode
    // The viewer we opened just came up — from here its next mode change is
    // its close.
    if (mode === entry.view) { entry.armed = true; return }
    if (!entry.armed) return
    ENTRY = null
    // Left for the hive → hand back the screen that offered the choice. Left
    // for another viewer → that one now owns where its own close goes.
    if (mode === 'hexagons') returnToCloseUp(entry)
  })
})

/**
 * Land on whichever one `walkFrom` chose — and the one rule that makes the
 * grammar feel like one motion rather than two features:
 *
 *   SAME VIEWER → DO NOT CLOSE. Re-target in place. The viewer is already up
 *   and already knows how to point at another cell (that is what its own
 *   `view-enter:` action does), so the deck simply becomes the next tile's
 *   deck. Closing and reopening would flash the hive between every step,
 *   which is precisely the "why did I go back to the hive" this is fixing.
 *
 *   NO VIEWER THERE → close, and hand over the close-up. This is the only
 *   path that leaves, and it leaves into the screen for choosing.
 *
 * `closeViewer` is the caller's own way out (a mode flip, an unmount) and is
 * called ONLY on that second path.
 */
export function landOnWalkTarget(view: string, target: WalkTarget, closeViewer: () => void): void {
  if (target.kind === 'view') { openView(view, target.label); return }
  // This path hands the close-up over itself, for the tile we stepped ONTO —
  // so the remembered way back (the tile we started from) must not also fire
  // when `closeViewer` flips the mode.
  forgetCloseUpEntry()
  closeViewer()
  openTileMenu(target.label)
}

/**
 * THE TWO AXES, bound once, for every viewer that wants them.
 *
 * Committed on the RELEASE, with the axis decided by which travel dominates —
 * both meanings are live at the same time, so a mostly-vertical drag must
 * never become a tile step and a mostly-horizontal one must never become a
 * page turn. The 1.4 bias favours the viewer's OWN axis on an ambiguous
 * diagonal: turning a page by mistake costs one flick back, arriving on
 * another tile costs your place.
 *
 * Travel threshold is roughly a thumb's width, under which a finger resting
 * and lifting is still a tap — so nothing here disturbs a plain press on a
 * control.
 *
 * `vertical` is optional: a viewer that already scrolls natively (a long page)
 * wants the browser's own scrolling on that axis and only asks for `sideways`.
 */
export function bindAxes(
  host: HTMLElement,
  handlers: {
    readonly sideways?: (delta: number) => void
    readonly vertical?: (delta: number) => void
  },
  opts: { readonly thresholdPx?: number } = {},
): void {
  const threshold = opts.thresholdPx ?? 56
  let start: { id: number; x: number; y: number } | null = null
  host.addEventListener('pointerdown', e => { start = { id: e.pointerId, x: e.clientX, y: e.clientY } })
  host.addEventListener('pointercancel', () => { start = null })
  host.addEventListener('pointerup', e => {
    const from = start
    if (!from || from.id !== e.pointerId) return
    start = null
    const dx = e.clientX - from.x
    const dy = e.clientY - from.y
    if (Math.abs(dx) >= threshold && Math.abs(dx) >= Math.abs(dy) * 1.4) {
      // Drag LEFT to bring the next tile in from the right — the direction the
      // content moves, which is the one every deck and gallery has taught.
      handlers.sideways?.(dx < 0 ? 1 : -1)
      return
    }
    if (handlers.vertical && Math.abs(dy) >= threshold && Math.abs(dy) >= Math.abs(dx) * 1.4) {
      // Drag UP to bring the next one in from below — a feed, and the same
      // direction-of-travel rule as the sideways step.
      handlers.vertical(dy < 0 ? 1 : -1)
    }
  })
}
