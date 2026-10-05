// hypercomb-shared/core/recent-portals.store.ts
//
// HOME — the portal you marked.
//
// A portal is a reference tile: clicking it travels to another lineage. The
// hive root stops being the place you keep landing back on and becomes what it
// actually is — the thing everything else hangs off. Work you are not doing
// stays out of sight.
//
// ── home is MARKED, never inferred ────────────────────────────────────
//
// Home is the lineage you MARKED from Portals or Ctrl/⌘+click on Home. It does
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
// The walking trail beside it is retired: no tracking (jwize 2026-10-03).
//
// ── storage ───────────────────────────────────────────────────────────
//
// The mark is ONE DOCUMENT (sub-bucket `home`) in the participant's
// `portals:recent` pool (participant-document.ts): synchronous to read,
// hydrated from disk, written through. The old localStorage key is read once
// as a fallback and never written again.

import { EffectBus } from '@hypercomb/core'
import { ParticipantDocument, legacyJson, type ParticipantDocumentOptions } from './participant-document'

/** LEGACY localStorage key — read at construction, never written. */
const LEGACY_PIN_KEY = 'hc:home-portal'
/** The document pool. Colon-scoped: no tile can name it. */
export const RECENT_PORTALS_MEANING = 'portals:recent'
const HOME_SUBKEY = 'home'

export interface RecentPortal {
  /** The portal tile's name — what Home's tooltip shows. */
  readonly label: string
  /** Where it leads. `[]` is the hive root. */
  readonly segments: readonly string[]
  /** Epoch ms it was marked. */
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

const parseHome = (raw: unknown): HomeRecord | null => {
  if (!raw || typeof raw !== 'object') return null
  const boxed = raw as { home?: unknown }
  // The pool shape is `{ home }`; the legacy key held the bare portal.
  if ('home' in boxed) return { home: boxed.home === null ? null : portal(boxed.home) }
  const bare = portal(raw)
  return bare ? { home: bare } : null
}

export class RecentPortalsStore extends EventTarget {

  readonly #mark: ParticipantDocument<HomeRecord>

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
    this.#mark = new ParticipantDocument<HomeRecord>({
      meaning: RECENT_PORTALS_MEANING, subKey: HOME_SUBKEY, parse: parseHome, empty: { home: null },
      legacy: () => legacyJson(LEGACY_PIN_KEY), whenStore: io.whenStore,
    })
    // The record arriving from disk repaints the surfaces that show it.
    this.#mark.addEventListener('change', this.#announce)
  }

  /** Pin a portal as home. Replaces whatever was pinned — the slot holds one,
   *  so mutual exclusivity is a property of the shape rather than a rule. */
  public pin = (label: string, segments: readonly string[]): void => {
    const clean = segments.map(s => (s ?? '').trim()).filter(Boolean)
    this.#mark.write({ home: { label: (label ?? '').trim(), segments: clean, at: Date.now() } })
    this.#announce()
  }

  /** Release the pin. Home goes back to meaning the hive root. */
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

  #announce = (): void => {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('portals:recent-changed', {})
  }
}

register('@hypercomb.social/RecentPortalsStore', new RecentPortalsStore())
