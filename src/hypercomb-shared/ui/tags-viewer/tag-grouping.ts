// hypercomb-shared/ui/tags-viewer/tag-grouping.ts
//
// How the pheromone vocabulary is ORGANISED in the panel. Pure functions, kept
// out of the component so the rule can be tested without an Angular harness —
// it is a doctrine, not a layout detail.
//
// ── Where a mark comes from decides where it is listed ───────────────────────
//
//   Bouquets    — sets someone gathered and named. The organising unit.
//   Loose       — plain keywords in no bouquet. The fallback, and where a
//                 newly-typed keyword lands until it is gathered.
//   Namespaces  — `visual:website:page` and friends. DERIVED from the mark's
//                 own spelling; behaviours mint these to say what a tile IS, so
//                 they group themselves and nobody curates them.
//
// ── The rule that keeps it honest ───────────────────────────────────────────
//
// A bouquet is a SET, not a folder. A mark can be in several bouquets at once
// and in none, and being in one is not a home it moved into. That is why:
//
//   • a GATHERED mark leaves the loose list — it now has somewhere to be found;
//   • a NAMESPACED mark never leaves its namespace — that is where it *is*, not
//     where someone filed it, so it stays there even when also gathered.
//
// If a mark ever had to live in exactly one place, the bouquet would have
// become a taxonomy — the confusion this split exists to end.

/** The minimum a row needs to be grouped. The panel's own TagRow is wider
 *  (colour, count); grouping has no business knowing about either. */
export interface NamedMark { name: string }

/** The namespace a mark declares by its own spelling, or null for a plain
 *  keyword.
 *
 *  Split on the FIRST colon: the convention is `visual:<view>:<noun>`, so
 *  everything after the first segment is detail belonging to that namespace,
 *  not a further grouping level. A leading colon is not a namespace — that is a
 *  malformed name, and treating `''` as a group would collect every such
 *  mistake into one unnamed pile. */
export const namespaceOf = (name: string): string | null => {
  const at = name.indexOf(':')
  return at > 0 ? name.slice(0, at) : null
}

/** Plain keywords nobody has gathered into a bouquet yet. */
export const looseMarks = <T extends NamedMark>(
  rows: readonly T[],
  gathered: ReadonlySet<string>,
): T[] => rows.filter(r => namespaceOf(r.name) === null && !gathered.has(r.name))

/** Namespaced marks grouped by their prefix, each group's rows in the order
 *  they arrived (the caller sorts the vocabulary once, up front). Groups are
 *  ordered by name so the list does not reshuffle as counts change. */
export const namespaceGroupsOf = <T extends NamedMark>(
  rows: readonly T[],
): { name: string; rows: T[] }[] => {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const ns = namespaceOf(row.name)
    if (!ns) continue
    const list = groups.get(ns)
    if (list) list.push(row); else groups.set(ns, [row])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, rows: list }))
}

// ── the search ───────────────────────────────────────────────────────────────
//
// ONE rule everywhere: case-insensitive substring on the name. A blank query
// matches everything, so callers never branch on "is a search running". The
// same query filters all three parts of the panel — what differs per part is
// only WHAT counts as the searched name:
//
//   • a loose or namespaced mark — its own name;
//   • a bouquet — its name OR any mark it holds, because searching for a
//     keyword must surface the bouquets that would land it;
//   • a namespace group — the group name keeps the whole group, otherwise the
//     group survives with just its matching rows.

export const matchesQuery = (name: string, query: string): boolean => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return name.toLowerCase().includes(q)
}

export const filterRowsByQuery = <T extends NamedMark>(
  rows: readonly T[],
  query: string,
): T[] => rows.filter(r => matchesQuery(r.name, query))

export const bouquetMatchesQuery = (
  name: string,
  marks: readonly string[],
  query: string,
): boolean => matchesQuery(name, query) || marks.some(m => matchesQuery(m, query))

export const filterNamespaceGroups = <T extends NamedMark>(
  groups: readonly { name: string; rows: T[] }[],
  query: string,
): { name: string; rows: T[] }[] => {
  if (!query.trim()) return [...groups]
  const out: { name: string; rows: T[] }[] = []
  for (const group of groups) {
    if (matchesQuery(group.name, query)) { out.push(group); continue }
    const rows = filterRowsByQuery(group.rows, query)
    if (rows.length > 0) out.push({ name: group.name, rows })
  }
  return out
}
