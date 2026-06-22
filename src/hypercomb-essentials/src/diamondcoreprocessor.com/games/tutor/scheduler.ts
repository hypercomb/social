// diamondcoreprocessor.com/games/tutor/scheduler.ts
//
// The memory engine. Decides WHICH item to drill next and HOW its spacing
// changes after each answer. This is the "statistically best for memory"
// part of the feature, made concrete:
//
//   • Active recall  — every game makes the learner RETRIEVE, not re-read.
//   • Spaced repetition (SM-2-lite + Leitner boxes) — items you miss come
//     back fast; items you nail get pushed further out. Intervals scale by
//     a per-item ease factor.
//   • Interleaving — due items are served mixed across source cells/tags
//     rather than blocked by topic (interleaving beats blocking for
//     retention and transfer).
//
// ── LAYER PURITY (critical) ───────────────────────────────────────────
//
// Progress NEVER touches the layer. It is participant-local, in
// localStorage under `hc:tutor:progress:<deckSig>` — the same rule as
// clipboard and viewport. A learner's own boxes/ease/due must not change
// the deck's identity, or two peers studying the same shared deck would
// fork its lineage signature. Keyed by deckSig so a regenerated deck
// starts clean while old progress survives a revert; item state is keyed
// by the STABLE `item.id` so progress carries across regenerations that
// keep an item.

import type { StudyItem, Grade } from './deck.types.js'

/** Per-item spacing state. Persisted; keyed by item.id. */
interface ItemState {
  box: number       // 0..5 — Leitner box
  ease: number      // 1.3..3.0 — interval multiplier
  due: number       // epoch ms the item is next due
  reps: number      // total times answered
  lapses: number    // total `again` grades
  last: number      // epoch ms last seen (interleaving tie-break)
}

/** Learning stage derived from box — drives the shell's game biasing. */
export type Stage = 'new' | 'learning' | 'review'

/** Snapshot for the toolbar HUD. */
export interface SchedulerStats {
  total: number
  due: number
  learned: number   // box >= GRADUATED_BOX
  seen: number      // has any state
}

const PROGRESS_PREFIX = 'hc:tutor:progress:'

// Box → base interval (ms). Low boxes recur within a sitting (so weak
// items repeat a few times this session); box>=GRADUATED items leave for
// a day+, which ends the session for that item ("cleared for today").
const BOX_INTERVAL_MS = [
  20_000,        // box 0 — ~20s, comes right back
  60_000,        // box 1 — ~1 min
  5 * 60_000,    // box 2 — ~5 min
  24 * 3_600_000,// box 3 — ~1 day (graduated for today)
  3 * 24 * 3_600_000,
  7 * 24 * 3_600_000,
]
const MAX_BOX = BOX_INTERVAL_MS.length - 1
const GRADUATED_BOX = 3   // box at which an item is "done for this session"

const EASE_START = 2.5
const EASE_MIN = 1.3
const EASE_MAX = 3.0

export class TutorScheduler {
  /** localStorage namespace — a stable per-deck key (the cell's location sig). */
  readonly #progressKey: string
  readonly #items: readonly StudyItem[]
  readonly #byId: Map<string, StudyItem>
  #state: Record<string, ItemState>
  /** Source cell of the last served item — interleaving avoids repeating it. */
  #lastSource: string | null = null
  /** When true, `next()` keeps serving the soonest item even if nothing is strictly due. */
  #drillMode = false

  constructor(items: readonly StudyItem[], progressKey: string) {
    this.#progressKey = progressKey
    this.#items = items
    this.#byId = new Map(items.map(i => [i.id, i]))
    this.#state = this.#load()
  }

  // ── selection ──────────────────────────────────────────────

  /**
   * The next item to drill, or null when the session is complete (every
   * item graduated, or nothing due and not in drill mode). Interleaves:
   * among due items, prefers the lowest box and the most overdue, while
   * avoiding repeating the previous source cell when an alternative
   * exists.
   */
  next(): StudyItem | null {
    const now = Date.now()
    const due = this.#items.filter(i => this.#stateOf(i.id).due <= now)
    let pool = due
    if (pool.length === 0) {
      if (!this.#drillMode) return null
      // Drill mode: nothing strictly due — serve the soonest-due items so
      // the learner can keep practicing past "cleared for today".
      pool = [...this.#items].sort((a, b) => this.#stateOf(a.id).due - this.#stateOf(b.id).due).slice(0, 8)
    }
    if (pool.length === 0) return null

    // Rank: lowest box first (weakest), then most overdue, then least-recently seen.
    const rank = (i: StudyItem): number => {
      const s = this.#stateOf(i.id)
      const overdue = now - s.due
      return s.box * 1e12 - overdue - (now - s.last) * 1e-3
    }
    pool = [...pool].sort((a, b) => rank(a) - rank(b))

    // Interleave: skip the front item if it shares the previous source and
    // a different-source candidate exists nearby.
    let pick = pool[0]
    if (this.#lastSource && pool.length > 1) {
      const alt = pool.find(i => i.sourceCell !== this.#lastSource)
      if (alt && pool[0].sourceCell === this.#lastSource) pick = alt
    }
    this.#lastSource = pick.sourceCell
    return pick
  }

  /** Allow drilling past "caught up" — the completion screen's "keep going". */
  enableDrill(): void { this.#drillMode = true }

  // ── recording ──────────────────────────────────────────────

  /** Fold an answer into the item's spacing state and persist. */
  record(itemId: string, grade: Grade): void {
    if (!this.#byId.has(itemId)) return
    const s = { ...this.#stateOf(itemId) }
    const now = Date.now()
    s.reps += 1
    s.last = now

    if (grade === 'again') {
      s.box = 0
      s.lapses += 1
      s.ease = Math.max(EASE_MIN, s.ease - 0.2)
    } else if (grade === 'good') {
      s.box = Math.min(MAX_BOX, s.box + 1)
    } else { // easy
      s.box = Math.min(MAX_BOX, s.box + 2)
      s.ease = Math.min(EASE_MAX, s.ease + 0.15)
    }

    const base = BOX_INTERVAL_MS[s.box]
    const factor = s.box >= GRADUATED_BOX ? s.ease / EASE_START : 1
    s.due = now + Math.round(base * factor)

    this.#state[itemId] = s
    this.#save()
  }

  // ── introspection ──────────────────────────────────────────

  /** Stage of an item — drives the shell's game biasing. */
  stageOf(item: StudyItem): Stage {
    const s = this.#state[item.id]
    if (!s) return 'new'
    if (s.box <= 1) return 'learning'
    return 'review'
  }

  stats(): SchedulerStats {
    const now = Date.now()
    let due = 0, learned = 0, seen = 0
    for (const i of this.#items) {
      const s = this.#state[i.id]
      if (s) { seen += 1; if (s.box >= GRADUATED_BOX) learned += 1 }
      if (this.#stateOf(i.id).due <= now) due += 1
    }
    return { total: this.#items.length, due, learned, seen }
  }

  /** True when every item has graduated for this session. */
  get complete(): boolean {
    return this.#items.every(i => (this.#state[i.id]?.box ?? 0) >= GRADUATED_BOX)
  }

  // ── persistence (participant-local) ────────────────────────

  #stateOf(id: string): ItemState {
    return this.#state[id] ?? { box: 0, ease: EASE_START, due: 0, reps: 0, lapses: 0, last: 0 }
  }

  #key(): string { return `${PROGRESS_PREFIX}${this.#progressKey}` }

  #load(): Record<string, ItemState> {
    try {
      const raw = localStorage.getItem(this.#key())
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, ItemState>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch { return {} }
  }

  #save(): void {
    try { localStorage.setItem(this.#key(), JSON.stringify(this.#state)) } catch { /* quota / private mode — non-fatal */ }
  }

  /** Wipe this deck's progress (the completion screen's "start over"). */
  reset(): void {
    this.#state = {}
    this.#lastSource = null
    this.#drillMode = false
    try { localStorage.removeItem(this.#key()) } catch { /* non-fatal */ }
  }
}
