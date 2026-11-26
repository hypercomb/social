// hypercomb-shared/core/recent-portals.store.ts
//
// HOME — the root-level home page, and the Recent list it is chosen from.
//
// ── the pin is the home page, at the root ─────────────────────────────
//
// Home is ONE place, pinned. While it is pinned the hive root SHOWS it and
// the address stays `/` (home-root.ts): choosing a home puts you AT THE
// ROOT, never at a nested address. The place keeps its real lineage behind
// that `/`, so swarm and every cross-domain index and search still read where
// it actually lives.
//
// ── Recent is the pin's own history ───────────────────────────────────
//
// There is no list to keep (jwize 2026-11-26: "we don't need to remember a
// specific home page anymore, we just look through the history for this
// pool"). Every pin is a document write, and a document write keeps its
// versions: an atom plus a `000x` marker. So every home ever pinned is
// already on disk in order, and `recent()` only reads the markers back,
// newest first, one row per place. Choosing a row pins it again, which puts
// it at the top. Nothing is tracked: a marker is written only when you pin.
// The walking trail retired 2026-10-03 stays retired; this is not that.
//
// ── storage ───────────────────────────────────────────────────────────
//
// ONE DOCUMENT (sub-bucket `home`) in the participant's `portals:recent`
// pool (participant-document.ts): synchronous to read, hydrated from disk,
// written through, every version marked. The old localStorage key is read
// once as a fallback and never written again.

import { EffectBus } from '@hypercomb/core'
import { ParticipantDocument, legacyJson, type ParticipantDocumentOptions } from './participant-document'

/** LEGACY localStorage key — read at construction, never written. */
const LEGACY_PIN_KEY = 'hc:home-portal'
/** The document pool. Colon-scoped: no tile can name it. */
export const RECENT_PORTALS_MEANING = 'portals:recent'
const HOME_SUBKEY = 'home'

export interface RecentPortal {
  /** The place's name — what Home's tooltip and its Recent row show. */
  readonly label: string
  /** Where it leads. `[]` is the hive root. */
  readonly segments: readonly string[]
  /** Epoch ms it was pinned. */
  readonly at: number
}

/** The home mark, boxed so an EMPTY slot is still a document. */
type HomeRecord = { home: RecentPortal | null }

const pathKey = (segments: readonly string[]): string => segments.join('/')
const clean = (segments: readonly string[]): string[] => segments.map(s => (s ?? '').trim()).filter(Boolean)

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

  /** WHERE HOME GOES — the pinned place, shown at the root. Nothing pinned
   *  means the hive root itself, exactly as Home always meant. */
  public get home(): RecentPortal | undefined { return this.#mark.value.home ?? undefined }

  public isHome = (segments: readonly string[]): boolean => {
    const home = this.#mark.value.home
    const here = clean(segments)
    return home ? pathKey(home.segments) === pathKey(here) : here.length === 0
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

  /** Pin a place as the root-level home page. One slot: pinning a second
   *  place is what releases the first. Each pin is a marker in the pool, so
   *  it joins Recent. An empty path releases the pin (home = the hive root). */
  public pin = (label: string, segments: readonly string[]): void => {
    const path = clean(segments)
    if (path.length === 0) { this.unpin(); return }
    this.#mark.write({ home: { label: (label ?? '').trim() || path[path.length - 1], segments: path, at: Date.now() } })
    this.#announce()
  }

  /** Release the pin. Home goes back to meaning the hive root. */
  public unpin = (): void => {
    if (!this.#mark.value.home) return
    this.#mark.write({ home: null })
    this.#announce()
  }

  /** RECENT — every place ever pinned as home, newest first, one row per
   *  place, read from the pool's own markers. The current pin, when it has
   *  not reached disk yet, leads anyway: the slot is newer than the disk. */
  public recent = async (): Promise<readonly RecentPortal[]> => {
    const versions = await this.#mark.history()
    const seen = new Set<string>()
    const out: RecentPortal[] = []
    const add = (p: RecentPortal | null | undefined): void => {
      if (!p || p.segments.length === 0) return
      const key = pathKey(p.segments)
      if (seen.has(key)) return
      seen.add(key)
      out.push(p)
    }
    add(this.#mark.value.home)
    for (const v of versions) add(v.home)
    return out
  }

  #announce = (): void => {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('portals:recent-changed', {})
  }
}

register('@hypercomb.social/RecentPortalsStore', new RecentPortalsStore())
