// Personal, per-level entrance pins. This is module-owned chrome state: it
// lives in localStorage and never changes a layer signature.
import { normalizeCell } from '@hypercomb/core'

export type PinnedEntrance = {
  groupId: string
  memberKey: string
  icon: string
  label: string
  view?: string
  segments?: string[]
}

export type PinnedEntranceAt = { level: string[]; pin: PinnedEntrance }

const KEY_PREFIX = 'hc:pinned-entrances:/'

const normalizePath = (segments: readonly string[]): string[] =>
  segments
    .map(segment => String(segment ?? '').trim()).filter(Boolean)
    .map(segment => normalizeCell(segment) || segment)

const storageKey = (segments: readonly string[]): string =>
  `${KEY_PREFIX}${normalizePath(segments).join('/')}`

export function withinSubtree(here: readonly string[], root: readonly string[]): boolean {
  const current = normalizePath(here)
  const base = normalizePath(root)
  return base.length <= current.length && base.every((segment, index) => segment === current[index])
}

class PinnedEntrancesStore extends EventTarget {
  pinsAt(segments: readonly string[]): PinnedEntrance[] {
    try {
      const raw = localStorage.getItem(storageKey(segments))
      const entries: unknown = raw ? JSON.parse(raw) : []
      if (!Array.isArray(entries)) return []
      return entries.filter((entry): entry is PinnedEntrance =>
        !!entry && typeof entry === 'object'
        && typeof (entry as PinnedEntrance).groupId === 'string'
        && typeof (entry as PinnedEntrance).memberKey === 'string')
    } catch { return [] }
  }

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

  pinsForLocation(
    here: readonly string[],
    resolve: (pin: PinnedEntrance) => { cascades: boolean; root: readonly string[] },
  ): PinnedEntranceAt[] {
    const out: PinnedEntranceAt[] = []
    const seen = new Set<string>()
    const identity = (pin: PinnedEntrance): string => `${pin.groupId}:${pin.memberKey}`
    const level = normalizePath(here)
    for (const pin of this.pinsAt(here)) {
      seen.add(identity(pin))
      out.push({ level, pin })
    }
    for (const entry of this.allPins()) {
      if (seen.has(identity(entry.pin))) continue
      const { cascades, root } = resolve(entry.pin)
      if (!cascades || root.length === 0 || !withinSubtree(here, root)) continue
      seen.add(identity(entry.pin))
      out.push(entry)
    }
    return out
  }

  addPin(segments: readonly string[], pin: PinnedEntrance): void {
    const current = this.pinsAt(segments)
    if (current.some(entry => entry.groupId === pin.groupId && entry.memberKey === pin.memberKey)) return
    this.#write(segments, [...current, pin])
  }

  removePin(segments: readonly string[], groupId: string, memberKey: string): void {
    const current = this.pinsAt(segments)
    const next = current.filter(entry => !(entry.groupId === groupId && entry.memberKey === memberKey))
    if (next.length !== current.length) this.#write(segments, next)
  }

  #write(segments: readonly string[], pins: PinnedEntrance[]): void {
    try {
      if (pins.length) localStorage.setItem(storageKey(segments), JSON.stringify(pins))
      else localStorage.removeItem(storageKey(segments))
    } catch { /* private browsing: the pin remains session-only */ }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const pinnedEntrances = new PinnedEntrancesStore()
