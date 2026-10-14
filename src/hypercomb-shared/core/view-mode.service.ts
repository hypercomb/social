// hypercomb-shared/core/view-mode.service.ts
//
// ViewMode — the active presentation surface. Mutually exclusive,
// open-ended: any drone or component can activate when the mode matches
// its declared filter and stay inert otherwise. The merkle tree is the
// same across modes — only presentation differs.
//
// Built-in modes:
//   'hexagons' — default; Pixi canvas + show-cell + layout drones
//   'website'  — HTML/CSS rendering of the layer tree
//
// Adding a mode = registering a renderer drone (or shared component) that
// gates on `viewMode.mode === '<name>'`. No central enum; the string IS
// the contract. Mutual exclusivity falls out of "only one mode is active".
//
// Pattern: EventTarget + 'change' event + getter for current value, same
// as Lineage / SelectionService. Bridges to Angular signals via fromRuntime.
//
// Persistence: in-memory for fast reads + localStorage for refresh
// survival. Default 'hexagons'.

/** A view-mode is just a string — unlimited modes, mutual exclusion by
 *  "only one is active." Concrete modes are conventional, not enforced. */
export type ViewMode = string

const STORAGE_KEY = 'hc:view-mode'
const DEFAULT_MODE: ViewMode = 'hexagons'

// Transient surfaces hide (or fully cover) the Pixi canvas, so they must
// NEVER be restored on boot: a stale one strands the hive on a blank,
// body-coloured screen with no page mounted (the "white overlay over all
// tiles" regression). They are only ever entered live, and fall back to the
// hexagon canvas across a reload.
//
// MAINTENANCE RULE: every view whose renderer takes over the surface
// belongs here. Hand-maintained because this shell file cannot import the
// essentials VisualBeeRegistry (dependency direction) — when a new
// full-surface view registers, add its mode string. Missing entries were
// exactly the 2026-07-27 lightbox/tutor boot-strand bug.
//
// IT DRIFTED AGAIN: `document` was missing (found 2026-08-24), and a missing
// entry costs twice — the canvas is never suppressed under the view, and,
// worse, setMode PERSISTS the mode, so the next reload boots into a surface
// with no page mounted and the participant lands on a blank screen. The list
// is now guarded by a ratchet (`view-modes.spec.ts`): every view token the
// essentials side registers must appear here, and the ratchet fails the suite
// when one does not. Do not silence it — add the mode.
const TRANSIENT_MODES = new Set<ViewMode>([
  // `home` is retired, but older builds persisted it. Keep it here as a
  // tombstone so an existing browser cannot boot into a mode whose renderer
  // has been removed and strand the participant on a blank canvas.
  'website', 'home', 'slides', 'tree', 'lightbox', 'tutor', 'workflow',
  'living-brief', 'evidence-atlas', 'knowledge-studio', 'postit', 'document',
  // `revolucion-welcome` is retired (renamed to `square-tile-view`
  // 2026-08-23) — tombstone for older builds that persisted it.
  'square-tile-view', 'revolucion-welcome', 'revolucion-room',
  // The lounge takes the whole surface — a three.js room painted from the
  // tile's own `visual:lounge:room` record, with no hexagons under it.
  'lounge',
  // The publication directory — a bright page of plates built from the
  // host's publish ledger (the bare directory domain's welcome face).
  'publications',
  // A game takes the whole surface — the arcade overlay the tile's own
  // `visual:game:play` record names, with no hexagons under it. This is what
  // lets a published game be a place somebody visits rather than a gesture
  // somebody makes from inside the hive.
  'game',
])

/** True when `mode` is a full-surface (canvas-covering) view. The shells
 *  key `body.hc-view-covered` on this so the Pixi canvas is neutralised
 *  under EVERY takeover view, the way it always was under 'website' — the
 *  ground a view transition exposes is then the themed body, never a flash
 *  of hex tiles. */
export function isTransientMode(mode: ViewMode): boolean {
  return TRANSIENT_MODES.has(mode)
}

export class ViewModeService extends EventTarget {
  #mode: ViewMode
  #previous: ViewMode

  constructor() {
    super()
    const stored = (typeof localStorage !== 'undefined') ? (localStorage.getItem(STORAGE_KEY)?.trim() ?? '') : ''
    // Restore a persisted mode, but never a transient (canvas-hiding) one —
    // booting into a stale 'website' with no page mounted is the white-screen bug.
    this.#mode = (stored && !TRANSIENT_MODES.has(stored)) ? stored : DEFAULT_MODE
    this.#previous = this.#mode
  }

  get mode(): ViewMode {
    return this.#mode
  }

  /** The surface that was up immediately before the current one — THE VIEW
   *  THAT SPAWNED IT. A takeover view is entered from somewhere, and the way
   *  out of it is back to wherever that was; without this every view could
   *  only ever exit to the hexagons, so stepping into a website from a deck
   *  (or any other view) dumped the reader onto the raw grid. One step deep
   *  on purpose: a view is a place you stepped into, not a stack you push. */
  get previous(): ViewMode {
    return this.#previous
  }

  /** True when the active mode equals `name`. Filter helper for drones
   *  that gate on their own view name. */
  is(name: ViewMode): boolean {
    return this.#mode === name
  }

  /**
   * Set the active mode. No-op if unchanged. Persists to localStorage and
   * dispatches a 'change' event so listeners (including Angular signals
   * bridged via fromRuntime) update.
   */
  setMode(next: ViewMode): void {
    const cleaned = String(next ?? '').trim()
    if (!cleaned) throw new Error('[view-mode] empty mode name')
    if (this.#mode === cleaned) return
    this.#previous = this.#mode
    this.#mode = cleaned
    try {
      // PERSIST THE GROUND, NOTHING ELSE. A takeover mode must never survive a
      // reload — the hive would boot into a surface with no page mounted and
      // the participant would land on a blank, body-coloured screen. That used
      // to be gated on the hand-maintained TRANSIENT_MODES set, which meant a
      // view missing from the list persisted itself and stranded the next boot
      // (`document` did exactly that until 2026-08-24).
      //
      // So the test is INVERTED: only the hexagons — the one surface that is
      // the ground rather than a view — are written. An unknown mode is now
      // assumed to be a takeover, which is the safe direction: the cost of
      // being wrong is that a surface is not restored across a reload, not a
      // white screen with no way back. Nothing can drift into the dangerous
      // side of this branch any more.
      if (cleaned === DEFAULT_MODE) localStorage.setItem(STORAGE_KEY, cleaned)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* private mode / storage full — non-fatal */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { mode: cleaned, previous: this.#previous } }))
  }

  /** Convenience toggle between two modes (default: hexagons ⇄ website). */
  toggle(a: ViewMode = 'hexagons', b: ViewMode = 'website'): ViewMode {
    const next = this.#mode === a ? b : a
    this.setMode(next)
    return next
  }
}

// Self-register at module load — same pattern as Lineage / Store / SecretStore.
register('@hypercomb.social/ViewMode', new ViewModeService())
