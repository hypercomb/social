// hypercomb-shared/core/pinned-entrances.store.ts
//
// Per-LEVEL pinned quick links — the participant drags an entrance icon off
// a tile onto the header bar to pin it THERE, on that level only. A pin is a
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
}

/** Canonical per-level storage key. Every segment is normalized so raw nav
 *  paths and normalized descent paths agree (same rule as tilePath). */
function storageKey(segments: readonly string[]): string {
  const norm = segments
    .map(s => String(s ?? '').trim()).filter(Boolean)
    .map(s => normalizeCell(s) || s)
    .join('/')
  return `hc:pinned-entrances:/${norm}`
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
