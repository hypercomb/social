// hypercomb-shared/core/recent-portals.store.ts
//
// HOME, and the portals you have walked through.
//
// A portal is a reference tile: clicking it travels to another lineage. The
// hive root stops being the place you keep landing back on and becomes what it
// actually is — the thing everything else hangs off. Work you are not doing
// stays out of sight.
//
// ── home is MARKED, never inferred ────────────────────────────────────
//
// Home is the lineage you MARKED with Ctrl/⌘+click on the global Home icon. It does
// not follow where you walk. Walking is how you look around, and a home that
// moved every time you looked at something was a home you could lose by
// accident — you dip into one thing and home is no longer what you meant.
//
// The mark is ONE SLOT, not a list, so mutual exclusivity is a property of the
// shape rather than a rule anything has to enforce. Marking a second portal is
// what releases the first, because there is nowhere else for it to go.
//
// It PERSISTS: a refresh must not cost you your focus. That is the whole point —
// the mark outlives the page, so coming back puts you where you left.
//
// ── the recent list ───────────────────────────────────────────────────
//
// Walking still leaves a trail for navigation surfaces that choose to show it.
// Jumping to one of those TRAVELS, it does not re-home — that is what the mark
// is for. The hive root is always the last row, and the leading breadcrumb crumb
// still goes there directly, so marking a portal never strands the root.

import { EffectBus } from '@hypercomb/core'

const KEY = 'hc:recent-portals'
/** The pinned home, if one has been chosen. Its own key — see #writePin. */
const PIN_KEY = 'hc:home-portal'

/** How many portals stay in the list. Small on purpose: this is a focus list,
 *  not a log — past a handful the menu stops being scannable and the walk back
 *  down the tree is no slower than reading it. */
const CAP = 8

export interface RecentPortal {
  /** The portal tile's name — what was clicked, and what the menu shows. */
  readonly label: string
  /** Where it led. `[]` is the hive root. */
  readonly segments: readonly string[]
  /** Epoch ms of the last walk through it. */
  readonly at: number
}

const pathKey = (segments: readonly string[]): string => segments.join('/')

export class RecentPortalsStore extends EventTarget {

  #value: readonly RecentPortal[]

  public get value(): readonly RecentPortal[] { return this.#value }

  /** The most recently walked portal. Feeds the Ctrl+click list only — home
   *  does NOT follow it. */
  public get latest(): RecentPortal | undefined { return this.#value[0] }

  /** The portal PINNED as home from the Portals toolwindow, if any.
   *
   *  ONE SLOT, not a list — pinning is mutually exclusive by construction
   *  rather than by a rule someone has to remember to enforce. Pinning a second
   *  portal is what unpins the first, because there is nowhere else for it to
   *  go. */
  public get pinned(): RecentPortal | undefined { return this.#pinned ?? undefined }

  /** WHERE HOME GOES — the MARKED portal, and nothing else.
   *
   *  Home does not follow where you walk. Walking is how you look around, and a
   *  home that moved every time you looked at something was a home you could
   *  lose by accident. Home is a thing you SAY, once, from the Portals
   *  toolwindow. Nothing marked means the hive root, exactly as Home always
   *  meant. */
  public get home(): RecentPortal | undefined { return this.#pinned ?? undefined }

  public isPinned = (segments: readonly string[]): boolean =>
    !!this.#pinned && pathKey(this.#pinned.segments) === pathKey(segments.map(s => (s ?? '').trim()).filter(Boolean))

  #pinned: RecentPortal | null

  constructor() {
    super()
    this.#value = this.#read()
    this.#pinned = this.#readPin()

    // A portal announces itself WITH its target before travelling, because only
    // the reference cell knows where it points — once we have landed it is
    // behind us. A payload with no target comes from a bee older than this
    // store; skip it rather than record a guess.
    EffectBus.on<{ label?: string; target?: readonly string[] }>(
      'tile:navigate-reference',
      payload => {
        if (!Array.isArray(payload?.target)) return
        this.record(payload.label ?? '', payload.target)
      },
    )
  }

  /** Remember a portal walk. Re-walking one moves it to the front rather than
   *  duplicating it — the list is where you have been, not how often. */
  public record = (label: string, segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    const key = pathKey(clean)
    const entry: RecentPortal = {
      label: (label ?? '').trim(),
      segments: clean,
      at: Date.now(),
    }
    this.#value = [entry, ...this.#value.filter(e => pathKey(e.segments) !== key)].slice(0, CAP)
    this.#commit()
  }

  /** Pin a portal as home. Replaces whatever was pinned — the slot holds one,
   *  so mutual exclusivity is a property of the shape rather than a rule.
   *
   *  Pinning also records the walk, so a pinned portal is in the recent list
   *  too: unpinning leaves you with a sensible home instead of a hole. */
  public pin = (label: string, segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    this.#pinned = { label: (label ?? '').trim(), segments: clean, at: Date.now() }
    this.record(label, clean)   // #commit runs inside — the pin is already set
  }

  /** Release the pin. Home goes back to following the walk from wherever you
   *  stand now — the portal itself stays in the recent list. */
  public unpin = (): void => {
    if (!this.#pinned) return
    this.#pinned = null
    this.#commit()
  }

  /** Pin if it is not home, release if it is. What the toolwindow toggle calls. */
  public togglePin = (label: string, segments: readonly string[]): void => {
    if (this.isPinned(segments)) this.unpin()
    else this.pin(label, segments)
  }

  /** Drop one portal from the list. Removing the front one hands Home to the
   *  next most recent — that is how you put something down. Forgetting the
   *  PINNED portal releases the pin with it: a pin pointing at something you
   *  have deliberately forgotten is a home you can no longer see. */
  public remove = (segments: readonly string[]): void => {
    const key = pathKey(segments.map(s => (s ?? '').trim()).filter(Boolean))
    const next = this.#value.filter(e => pathKey(e.segments) !== key)
    const unpinning = !!this.#pinned && pathKey(this.#pinned.segments) === key
    if (next.length === this.#value.length && !unpinning) return
    if (unpinning) this.#pinned = null
    this.#value = next
    this.#commit()
  }

  /** Forget every portal — Home goes back to meaning the hive root. */
  public clear = (): void => {
    if (this.#value.length === 0 && !this.#pinned) return
    this.#value = []
    this.#pinned = null
    this.#commit()
  }

  #commit = (): void => {
    this.#write(this.#value)
    this.#writePin(this.#pinned)
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('portals:recent-changed', { count: this.#value.length })
  }

  #read = (): readonly RecentPortal[] => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(e => e && typeof e === 'object' && Array.isArray(e.segments))
        .map(e => ({
          label: typeof e.label === 'string' ? e.label : '',
          segments: (e.segments as unknown[]).filter(s => typeof s === 'string') as string[],
          at: typeof e.at === 'number' ? e.at : 0,
        }))
        .slice(0, CAP)
    } catch { return [] }
  }

  #write = (v: readonly RecentPortal[]): void => {
    try {
      if (v.length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(v))
    } catch { /* private mode / quota — the list is a convenience, never truth */ }
  }

  // The pin is stored APART from the list, under its own key. It is a
  // deliberate choice and the list is a byproduct of walking around, so the
  // list falling over (quota, a bad parse, a cap eviction) must not take the
  // pin with it.

  #readPin = (): RecentPortal | null => {
    try {
      const raw = localStorage.getItem(PIN_KEY)
      if (!raw) return null
      const e = JSON.parse(raw)
      if (!e || typeof e !== 'object' || !Array.isArray(e.segments)) return null
      return {
        label: typeof e.label === 'string' ? e.label : '',
        segments: (e.segments as unknown[]).filter(s => typeof s === 'string') as string[],
        at: typeof e.at === 'number' ? e.at : 0,
      }
    } catch { return null }
  }

  #writePin = (p: RecentPortal | null): void => {
    try {
      if (!p) localStorage.removeItem(PIN_KEY)
      else localStorage.setItem(PIN_KEY, JSON.stringify(p))
    } catch { /* same as the list — a convenience, never truth */ }
  }
}

register('@hypercomb.social/RecentPortalsStore', new RecentPortalsStore())
