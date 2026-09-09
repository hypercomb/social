// THE WAY BACK TO THE GROUP — derived, never stored.
//
// A holder that already gathers references knows where they came from only
// through the children themselves: each reference child wears the ROUTE of
// its target, and the group is the parent those routes share. Nothing is
// written on the holder's layer for this — a back-pointer there would move
// the holder's signature every time its members changed and ruin the merkle
// tree (documentation/reference-designer.md, section 7). When the routes
// disagree the most common parent wins; ties fall to the first seen.

type HistoryLike = {
  sign(l: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type DecorationServiceLike = {
  list<T>(query: { kind: string; segments: readonly string[] }): Promise<Array<{ record: { payload?: T } }>>
}
/** Mirrors REFERENCE_DECORATION_KIND in essentials — a string, not an import:
 *  shared must not reach into a module. */
const REFERENCE_KIND = 'reference'
const ioc = (): { get(k: string): unknown } | undefined => (globalThis as { ioc?: { get(k: string): unknown } }).ioc

export const gatheredFrom = async (holder: readonly string[]): Promise<readonly string[] | null> => {
  const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
  const decorations = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
  if (!history?.getLayerBySig || !decorations?.list || holder.length === 0) return null
  try {
    const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => holder }))
    const childSigs = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]).map(String) : []
    const votes = new Map<string, { segments: readonly string[]; count: number }>()
    for (const sig of childSigs) {
      const name = (await history.getLayerBySig(sig))?.['name']
      if (typeof name !== 'string' || !name) continue
      const rows = await decorations.list<{ targetSegments?: unknown }>({ kind: REFERENCE_KIND, segments: [...holder, name] })
      const raw = rows.find(row => Array.isArray(row.record.payload?.targetSegments))?.record.payload?.targetSegments
      if (!Array.isArray(raw)) continue
      const parent = raw.map(s => String(s ?? '')).filter(Boolean).slice(0, -1)
      if (parent.length === 0) continue
      const key = parent.join('/')
      const vote = votes.get(key) ?? { segments: parent, count: 0 }
      vote.count++
      votes.set(key, vote)
    }
    let best: { segments: readonly string[]; count: number } | null = null
    for (const vote of votes.values()) if (!best || vote.count > best.count) best = vote
    return best?.segments ?? null
  } catch { return null }
}
