// hypercomb-shared/core/pinned-entrances.store.ts
//
// Per-LEVEL pinned quick links — the participant drags an entrance icon off
// a tile onto the header bar to pin it THERE, on that level only.
//
// ── Reach: the page it was pinned to, plus a cascade ───────────────────
//
// A pin shows on the page it was dropped on and NOWHERE else — navigate away
// and the header is bare again. The one exception is a CASCADING behavior:
// when the entrance's behavior declares `cascades` (VisualBeeDescriptor), the
// behavior applies to the entrance's whole subtree, so its pin stays on the
// header for as long as the participant is standing inside that subtree. The
// icon is present exactly where the behavior is in effect.
//
// Cascade is READ at render time from the behavior's own declaration — never
// copied onto the pin, never inferred by walking the tree (scope is declared,
// see documentation and the application-scope rules). Today the declared
// cascading capability is the typed file dropbox; visual bees (website,
// dashboard, …) are node-local, so their pins are strictly per-page.
//
// A pin is a
// personal navigation arrangement, not content: like the hide list and the
// public flags it lives in localStorage keyed by the location, never in the
// layer (it must not skew layer signatures across peers), and it references
// the entrance by identity (groupId + memberKey) — the entrance itself stays
// first-class in its launch group / aggregation layer.
//
// The stored icon/label are a render fallback for the moment before the
// group's discovery scan lands; consumers prefer the LIVE member's glyph.

import { normalizeCell } from '@hypercomb/core'

export type PinnedEntrance = {
  /** Launch group that owns the entrance (websites, games, …). */
  groupId: string
  /** The member's stable key within the group. */
  memberKey: string
  /** Material glyph at pin time — fallback while the group scan is cold. */
  icon: string
  /** Display label at pin time — fallback for the same window. */
  label: string
  /** The behavior this entrance opens (`view-enter:<view>` → `<view>`), when
   *  the drag came from a view feature icon. Read at RENDER time against the
   *  VisualBeeRegistry to ask whether the behavior cascades — the flag is not
   *  copied here, so a behavior that changes its declared scope takes effect
   *  on existing pins immediately (the behavior owns its scope, the pin only
   *  points at it). */
  view?: string
  /** Full path to the entrance's own root cell. The pin lives one level ABOVE
   *  this (you drag up from the tile), so a cascading behavior's subtree is
   *  measured from here, not from the level the pin sits on. Fallback for the
   *  window before the group's discovery scan lands. */
  segments?: string[]
}

/** A pin plus the level it was dropped on — what `allPins` enumerates so a
 *  reader can decide, per pin, whether it reaches the current location. */
export type PinnedEntranceAt = {
  /** Normalized path segments of the level holding this pin. */
  level: string[]
  pin: PinnedEntrance
}

const KEY_PREFIX = 'hc:pinned-entrances:/'

/** Canonical per-level storage key. Every segment is normalized so raw nav
 *  paths and normalized descent paths agree (same rule as tilePath). */
function normalizePath(segments: readonly string[]): string[] {
  return segments
    .map(s => String(s ?? '').trim()).filter(Boolean)
    .map(s => normalizeCell(s) || s)
}

function storageKey(segments: readonly string[]): string {
  return `${KEY_PREFIX}${normalizePath(segments).join('/')}`
}

/** True when `here` is `root` or sits beneath it. Both are normalized first,
 *  so a raw nav path and a normalized descent path agree. An empty `root`
 *  (the hive root) contains everything — a cascade declared there is global. */
export function withinSubtree(here: readonly string[], root: readonly string[]): boolean {
  const h = normalizePath(here)
  const r = normalizePath(root)
  if (r.length > h.length) return false
  return r.every((seg, i) => seg === h[i])
}

class PinnedEntrancesStore extends EventTarget {
  pinsAt(segments: readonly string[]): PinnedEntrance[] {
    try {
      const raw = localStorage.getItem(storageKey(segments))
      const arr = raw ? JSON.parse(raw) : []
      if (!Array.isArray(arr)) return []
      return arr.filter((p): p is PinnedEntrance =>
        !!p && typeof p === 'object'
        && typeof (p as PinnedEntrance).groupId === 'string'
        && typeof (p as PinnedEntrance).memberKey === 'string')
    } catch {
      return []
    }
  }

  /** Every pin on every level, each tagged with the level holding it. The
   *  cascade rule needs this: a pin dropped on one page can still reach the
   *  current location, so the bar cannot look at one key alone. Cheap — a
   *  handful of short localStorage keys, walked on refresh. */
  allPins(): PinnedEntranceAt[] {
    const out: PinnedEntranceAt[] = []
    let keys: string[]
    try { keys = Object.keys(localStorage) } catch { return out }
    for (const key of keys) {
      if (!key.startsWith(KEY_PREFIX)) continue
      const level = key.slice(KEY_PREFIX.length).split('/').filter(Boolean)
      for (const pin of this.pinsAt(level)) out.push({ level, pin })
    }
    return out
  }

  /**
   * The pins that REACH `here` — the whole visibility rule in one place.
   *
   *   1. every pin dropped on this exact page, and
   *   2. every pin elsewhere whose behavior CASCADES and whose entrance root
   *      contains `here` (the root itself or anything beneath it).
   *
   * A pin satisfying both appears once, as the direct one — being pinned here
   * is the stronger claim, and it is the level removal must target.
   *
   * `resolve` supplies the two things storage cannot know: whether the pin's
   * behavior declares a cascade, and where the entrance actually roots (the
   * live launch-group member, falling back to the path recorded at pin time).
   * Keeping it a callback is what lets this rule be tested without a registry.
   */
  pinsForLocation(
    here: readonly string[],
    resolve: (pin: PinnedEntrance) => { cascades: boolean; root: readonly string[] },
  ): PinnedEntranceAt[] {
    const out: PinnedEntranceAt[] = []
    const seen = new Set<string>()
    const identity = (p: PinnedEntrance): string => `${p.groupId}:${p.memberKey}`

    const level = normalizePath(here)
    for (const pin of this.pinsAt(here)) {
      seen.add(identity(pin))
      out.push({ level, pin })
    }

    for (const entry of this.allPins()) {
      if (seen.has(identity(entry.pin))) continue
      const { cascades, root } = resolve(entry.pin)
      // An entrance with no hive location (an overlay game) has no subtree to
      // stand in, so it can never cascade anywhere.
      if (!cascades || root.length === 0) continue
      if (!withinSubtree(here, root)) continue
      seen.add(identity(entry.pin))
      out.push(entry)
    }
    return out
  }

  /** Add a pin at this level. Idempotent by (groupId, memberKey). */
  addPin(segments: readonly string[], pin: PinnedEntrance): void {
    const list = this.pinsAt(segments)
    if (list.some(p => p.groupId === pin.groupId && p.memberKey === pin.memberKey)) return
    this.#write(segments, [...list, pin])
  }

  removePin(segments: readonly string[], groupId: string, memberKey: string): void {
    const list = this.pinsAt(segments)
    const next = list.filter(p => !(p.groupId === groupId && p.memberKey === memberKey))
    if (next.length === list.length) return
    this.#write(segments, next)
  }

  #write(segments: readonly string[], pins: PinnedEntrance[]): void {
    try {
      if (pins.length === 0) localStorage.removeItem(storageKey(segments))
      else localStorage.setItem(storageKey(segments), JSON.stringify(pins))
    } catch { /* private-browsing edge case — pin won't persist */ }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const pinnedEntrances = new PinnedEntrancesStore()
