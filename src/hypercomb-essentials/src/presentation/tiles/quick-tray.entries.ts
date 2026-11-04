// presentation/tiles/quick-tray.entries.ts
//
// The quick tray's entry set as pure functions — what the strip holds and how
// it changes, with no DOM and no bus, so the rules run in a spec. An entry is
// a REFERENCE: the tile's label, the page it was taken from, and (when that
// page already listed it) the signature the page lists it by. Nothing here
// writes; the tray is a selection that survives navigation
// (documentation/recents-and-the-quick-tray.md, codex A9).

export interface TrayEntry {
  readonly label: string
  readonly sourceSegments: readonly string[]
  /** The signature the source page lists the tile by, when known at the take.
   *  Identity for de-duplication and the thumbnail; the DROP re-seals the live
   *  subtree, so a sig that went stale here never places stale bytes. */
  readonly sig?: string
  /** An atom no page lists (recents-census.ts). It has no source to seal from
   *  or release, so the drop places this exact sig, and only as an appearance. */
  readonly loose?: true
  /** A tag on the shelf: a name, not a tile. It has no page, and its sig names
   *  the tag (tagSignature), so a kept shelf can hold it like any other member. */
  readonly kind?: 'tag'
}

const SIG = /^[0-9a-f]{64}$/

/** Identity of a row: label + source path, never the bare label. The same tile
 *  taken twice is one row; two same-named tiles from different pages are two.
 *  Loose atoms have no source path, so two of one name share a key: the later
 *  take replaces the earlier row. */
export const entryKey = (e: Pick<TrayEntry, 'label' | 'sourceSegments'> & { kind?: 'tag' }): string =>
  (e.kind === 'tag' ? '#' : '') + e.label + '\u0000' + e.sourceSegments.join('/')

/** Add references to what is held. Upserts by key: a second take of the same
 *  tile refreshes its sig when the second brought one and never erases the
 *  sig the first captured, instead of minting a second row. Order is the order
 *  of first take — the row you took first stays first. */
export const takeEntries = (held: readonly TrayEntry[], incoming: readonly TrayEntry[]): TrayEntry[] => {
  const byKey = new Map(held.map(e => [entryKey(e), e]))
  for (const raw of incoming) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    if (!label) continue
    const sourceSegments = Array.isArray(raw.sourceSegments)
      ? raw.sourceSegments.map(s => String(s ?? '').trim()).filter(Boolean)
      : []
    const kind = raw.kind === 'tag' ? ('tag' as const) : undefined
    const key = entryKey({ label, sourceSegments, kind })
    const prior = byKey.get(key)
    const sig = (typeof raw.sig === 'string' && SIG.test(raw.sig)) ? raw.sig : prior?.sig
    byKey.set(key, { label, sourceSegments, ...(sig ? { sig } : {}), ...(raw.loose ? { loose: true as const } : {}), ...(kind ? { kind } : {}) })
  }
  return [...byKey.values()]
}

/** Let go of the rows with these keys — the hover × and a drop that landed. */
export const dropEntries = (held: readonly TrayEntry[], keys: ReadonlySet<string>): TrayEntry[] =>
  held.filter(e => !keys.has(entryKey(e)))
