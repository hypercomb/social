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

export class ViewModeService extends EventTarget {
  #mode: ViewMode

  constructor() {
    super()
    const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null
    this.#mode = (stored && stored.trim()) ? stored : DEFAULT_MODE
  }

  get mode(): ViewMode {
    return this.#mode
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
    this.#mode = cleaned
    try {
      localStorage.setItem(STORAGE_KEY, cleaned)
    } catch { /* private mode / storage full — non-fatal */ }
    this.dispatchEvent(new CustomEvent('change', { detail: { mode: cleaned } }))
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
