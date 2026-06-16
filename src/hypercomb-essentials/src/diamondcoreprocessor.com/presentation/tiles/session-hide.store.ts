// diamondcoreprocessor.com/presentation/tiles/session-hide.store.ts
//
// SESSION-ONLY hide store. Tile + lineage hides live in memory for the
// lifetime of the page ONLY — a refresh recreates the JS context, so the
// store starts empty and every hide is gone. This is deliberate: persisting
// hides (the old localStorage backing) let a hide made in one swarm/zone
// session silently leak into a LATER (private) session — it kept a real tile
// hidden that the participant never hid in that session ("operations" at
// /dolphin). Session-only means "hide while you look around; a refresh shows
// everything again."
//
// It mirrors the get/set/remove shape of the localStorage calls it replaces,
// so callers swap the backing without changing any key logic — the keys are
// exactly the strings hideStorageKey() and the hidden-lineages key produce.
// NON-hide keys (hc:current-zone, hc:show-hidden) stay in localStorage: they
// are settings, not hide lists.

// Method names mirror localStorage's (getItem/setItem/removeItem) so a caller
// can pick the backing at runtime — `const store = isHide ? sessionHideStore :
// localStorage` — which #hideOrBlock needs: HIDES are session-only (this
// store) while device-scoped BLOCKS stay persistent (localStorage).
interface KeyValueBacking {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const mem = new Map<string, string>()

export const sessionHideStore: KeyValueBacking = {
  getItem(key: string): string | null {
    return mem.has(key) ? (mem.get(key) as string) : null
  },
  setItem(key: string, value: string): void {
    mem.set(key, value)
  },
  removeItem(key: string): void {
    mem.delete(key)
  },
}
