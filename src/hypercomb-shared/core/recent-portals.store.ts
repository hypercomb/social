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
//
// ── storage: two documents in one pool ────────────────────────────────
//
// The list and the mark are TWO DOCUMENTS (sub-buckets `recent` and `home`)
// in the participant's `portals:recent` pool (participant-document.ts):
// synchronous to read, hydrated from disk, written through. They stay apart
// for the reason they always were: the mark is a deliberate choice and the
// list is a byproduct of walking around, so the list falling over (a cap
// eviction, a bad parse) must not take the mark with it. The two old
// localStorage keys are read once as a fallback and never written again.

import { EffectBus } from '@hypercomb/core'
import { ParticipantDocument, legacyJson, type ParticipantDocumentOptions } from './participant-document'

/** LEGACY localStorage keys — read at construction, never written. */
const LEGACY_KEY = 'hc:recent-portals'
const LEGACY_PIN_KEY = 'hc:home-portal'
/** The document pool. Colon-scoped: no tile can name it. */
export const RECENT_PORTALS_MEANING = 'portals:recent'
const RECENT_SUBKEY = 'recent'
const HOME_SUBKEY = 'home'

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

/** The home mark, boxed so an EMPTY slot is still a document. */
type HomeRecord = { home: RecentPortal | null }

const pathKey = (segments: readonly string[]): string => segments.join('/')

const portal = (e: unknown): RecentPortal | null => {
  if (!e || typeof e !== 'object' || !Array.isArray((e as RecentPortal).segments)) return null
  const p = e as { label?: unknown; segments: unknown[]; at?: unknown }
  return {
    label: typeof p.label === 'string' ? p.label : '',
    segments: p.segments.filter((s): s is string => typeof s === 'string'),
    at: typeof p.at === 'number' ? p.at : 0,
  }
}

const parseList = (raw: unknown): RecentPortal[] | null =>
  Array.isArray(raw) ? raw.map(portal).filter((p): p is RecentPortal => p !== null).slice(0, CAP) : null

const parseHome = (raw: unknown): HomeRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const boxed = raw as { home?: unknown }
  // The pool shape is `{ home }`; the legacy key held the bare portal.
  if ('home' in boxed) return { home: boxed.home === null ? null : portal(boxed.home) }
  const bare = portal(raw)
  return bare ? { home: bare } : null
}

export class RecentPortalsStore extends EventTarget {

  readonly #list: ParticipantDocument<RecentPortal[]>
  readonly #mark: ParticipantDocument<HomeRecord>

  public get value(): readonly RecentPortal[] { return this.#list.value }

  /** The most recently walked portal. Feeds the Ctrl+click list only — home
   *  does NOT follow it. */
  public get latest(): RecentPortal | undefined { return this.#list.value[0] }

  /** The portal PINNED as home from the Portals toolwindow, if any.
   *
   *  ONE SLOT, not a list — pinning is mutually exclusive by construction
   *  rather than by a rule someone has to remember to enforce. Pinning a second
   *  portal is what unpins the first, because there is nowhere else for it to
   *  go. */
  public get pinned(): RecentPortal | undefined { return this.#mark.value.home ?? undefined }

  /** WHERE HOME GOES — the MARKED portal, and nothing else.
   *
   *  Home does not follow where you walk. Walking is how you look around, and a
   *  home that moved every time you looked at something was a home you could
   *  lose by accident. Home is a thing you SAY, once, from the Portals
   *  toolwindow. Nothing marked means the hive root, exactly as Home always
   *  meant. */
  public get home(): RecentPortal | undefined { return this.#mark.value.home ?? undefined }

  public isPinned = (segments: readonly string[]): boolean => {
    const home = this.#mark.value.home
    return !!home && pathKey(home.segments) === pathKey(segments.map(s => (s ?? '').trim()).filter(Boolean))
  }

  constructor(io: Pick<ParticipantDocumentOptions<unknown>, 'whenStore'> = {}) {
    super()
    this.#list = new ParticipantDocument<RecentPortal[]>({
      meaning: RECENT_PORTALS_MEANING, subKey: RECENT_SUBKEY, parse: parseList, empty: [],
      legacy: () => legacyJson(LEGACY_KEY), whenStore: io.whenStore,
    })
    this.#mark = new ParticipantDocument<HomeRecord>({
      meaning: RECENT_PORTALS_MEANING, subKey: HOME_SUBKEY, parse: parseHome, empty: { home: null },
      legacy: () => legacyJson(LEGACY_PIN_KEY), whenStore: io.whenStore,
    })
    // Either record arriving from disk repaints the surfaces that show it.
    for (const doc of [this.#list, this.#mark]) doc.addEventListener('change', this.#announce)

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
    this.#list.write([entry, ...this.#list.value.filter(e => pathKey(e.segments) !== key)].slice(0, CAP))
    this.#announce()
  }

  /** Pin a portal as home. Replaces whatever was pinned — the slot holds one,
   *  so mutual exclusivity is a property of the shape rather than a rule.
   *
   *  Pinning also records the walk, so a pinned portal is in the recent list
   *  too: unpinning leaves you with a sensible home instead of a hole. */
  public pin = (label: string, segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    this.#mark.write({ home: { label: (label ?? '').trim(), segments: clean, at: Date.now() } })
    this.record(label, clean)   // announces — the mark is already set
  }

  /** Release the pin. Home goes back to meaning the hive root — the portal
   *  itself stays in the recent list. */
  public unpin = (): void => {
    if (!this.#mark.value.home) return
    this.#mark.write({ home: null })
    this.#announce()
  }

  /** Pin if it is not home, release if it is. What the toolwindow toggle calls. */
  public togglePin = (label: string, segments: readonly string[]): void => {
    if (this.isPinned(segments)) this.unpin()
    else this.pin(label, segments)
  }

  /** Drop one portal from the list. Forgetting the PINNED portal releases the
   *  pin with it: a pin pointing at something you have deliberately forgotten
   *  is a home you can no longer see. */
  public remove = (segments: readonly string[]): void => {
    const key = pathKey(segments.map(s => (s ?? '').trim()).filter(Boolean))
    const next = this.#list.value.filter(e => pathKey(e.segments) !== key)
    const home = this.#mark.value.home
    const unpinning = !!home && pathKey(home.segments) === key
    if (next.length === this.#list.value.length && !unpinning) return
    if (unpinning) this.#mark.write({ home: null })
    if (next.length !== this.#list.value.length) this.#list.write(next)
    this.#announce()
  }

  /** Forget every portal — Home goes back to meaning the hive root. */
  public clear = (): void => {
    if (this.#list.value.length === 0 && !this.#mark.value.home) return
    if (this.#list.value.length > 0) this.#list.write([])
    if (this.#mark.value.home) this.#mark.write({ home: null })
    this.#announce()
  }

  #announce = (): void => {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('portals:recent-changed', { count: this.#list.value.length })
  }
}

register('@hypercomb.social/RecentPortalsStore', new RecentPortalsStore())
