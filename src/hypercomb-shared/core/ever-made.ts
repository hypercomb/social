// hypercomb-shared/core/ever-made.ts
//
// EVERY NAME THIS HIVE EVER MADE, as the command line completes it.
//
// The level (CellSuggestionProvider.suggestions) is only the tiles on the page
// you stand on. But typing a name is how a tile is made, and a tile is its
// name (hypergraph-molecule-lineage.md) — so the line has to know the names
// that were made anywhere, on any page, including tiles since removed from
// every page. Those come from the recents census (`atoms()`), which is derived
// from lineage bags and so cannot lose one: nothing is ever deleted (H2).
//
// Pure on purpose: the census is read by the provider, the merge is read here,
// and neither needs a browser to be proved.

/** Rows the line may add from beyond the level. A one-letter prefix over a
 *  large hive would otherwise hand the dropdown thousands of rows; the next
 *  letter narrows it, which is the whole gesture of typing. */
export const EVER_MADE_CAP = 30

/** The census's atoms as a name list for completion: newest first (the order
 *  `atoms()` already answers in), one row per NAME however many tiles carry it,
 *  case-folded for the comparison and kept in the spelling first seen. */
export const everMadeNames = (atoms: readonly { readonly label?: unknown }[]): readonly string[] => {
  const seen = new Set<string>()
  const names: string[] = []
  for (const atom of atoms) {
    const name = typeof atom?.label === 'string' ? atom.label.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/** The names beyond what the line already shows that begin with what was
 *  typed. Prefix only — the ghost text and Tab complete by extending the typed
 *  letters, so a name that merely contains them could not be offered honestly.
 *  An empty prefix offers nothing: a blank line is never answered with the
 *  whole of a hive's history. */
export const namesBeyond = (
  prefix: string,
  shown: readonly string[],
  ever: readonly string[],
  cap = EVER_MADE_CAP,
): readonly string[] => {
  const typed = prefix.trim().toLowerCase()
  if (!typed) return []
  const have = new Set(shown.map(name => name.toLowerCase()))
  const out: string[] = []
  for (const name of ever) {
    if (out.length >= cap) break
    const key = name.toLowerCase()
    if (have.has(key) || !key.startsWith(typed)) continue
    out.push(name)
  }
  return out
}
