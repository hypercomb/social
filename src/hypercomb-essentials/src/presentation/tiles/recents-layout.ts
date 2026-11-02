// presentation/tiles/recents-layout.ts
//
// Where each atom stands in the full-screen recents view, as a pure rule
// (documentation/recents-and-the-quick-tray.md, codex H7): the newest at the
// centre, older ones ring by ring outward, hidden ones after every lit atom
// so they sit further out, shaded and never absent.
//
// THE VIEW IS PAGED, NEVER CAPPED. A screen holds RECENTS_WINDOW atoms, because
// the atlases pin everything on it; a hive holds far more. Every atom is
// reachable by paging out, so "always able to view every tile" survives the
// screen being finite. A filter narrows what is shown; it never edits the set.

export type Axial = { q: number; r: number }

/** The one atom shape this view reads (the census reader's RecentAtom). */
export type LaidOutAtom = {
  readonly sig: string
  readonly label: string
  readonly path: readonly string[]
  readonly placed: boolean
  readonly hidden: boolean
}

/** Six rings around a centre: 1 + 6 + 12 + 18 + 24 + 30 + 36. */
export const RECENTS_WINDOW = 127

const RING_STEPS: readonly Axial[] = [
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
]

/** The first `count` hexes: the centre, then each ring in turn. */
export const ringSlots = (count: number): Axial[] => {
  const out: Axial[] = []
  if (count <= 0) return out
  out.push({ q: 0, r: 0 })
  for (let ring = 1; out.length < count; ring++) {
    let at: Axial = { q: ring, r: 0 }
    for (const step of RING_STEPS) {
      for (let i = 0; i < ring && out.length < count; i++) {
        out.push(at)
        at = { q: at.q + step.q, r: at.r + step.r }
      }
    }
  }
  return out
}

/** Lit atoms first, then hidden ones. The sort is stable, so each group keeps
 *  the newest-first order it arrived in. */
export const litBeforeHidden = <T extends { hidden: boolean }>(atoms: readonly T[]): T[] =>
  [...atoms].sort((a, b) => Number(a.hidden) - Number(b.hidden))

/** Name or path, case-folded. An empty query narrows nothing. */
export const filterAtoms = <T extends { label: string; path: readonly string[] }>(atoms: readonly T[], query: string): T[] => {
  const q = query.trim().toLowerCase()
  if (!q) return [...atoms]
  return atoms.filter(a => a.label.toLowerCase().includes(q) || a.path.join('/').toLowerCase().includes(q))
}

/** Page starts for `total` atoms, clamped so the last page is never empty. */
export const clampPage = (requested: number, total: number, size = RECENTS_WINDOW): number => {
  const last = total > 0 ? Math.floor((total - 1) / size) : 0
  return Math.min(Math.max(0, requested), last)
}

/** One page of the view: which atoms, in which hexes. */
export const layoutPage = <T extends { hidden: boolean }>(
  atoms: readonly T[],
  page: number,
  size = RECENTS_WINDOW,
): { atom: T; slot: Axial }[] => {
  const ordered = litBeforeHidden(atoms)
  const start = clampPage(page, ordered.length, size) * size
  const shown = ordered.slice(start, start + size)
  const slots = ringSlots(shown.length)
  return shown.map((atom, i) => ({ atom, slot: slots[i]! }))
}

/** What a click on an atom does. TAKE sends a reference to the quick tray and
 *  leaves the view up, so several can be gathered. An atom no page lists has
 *  nowhere to walk to, so taking it is the only way back onto a page. */
export type RecentsClick =
  | { kind: 'take'; source: readonly string[] }
  | { kind: 'walk'; travel: readonly string[] }

export const recentsClickPlan = (atom: Pick<LaidOutAtom, 'path' | 'placed'>, take: boolean): RecentsClick =>
  (take || !atom.placed)
    ? { kind: 'take', source: atom.path.slice(0, -1) }
    : { kind: 'walk', travel: [...atom.path] }
