// diamondcoreprocessor.com/tutorial/tutorial-provenance.ts
//
// Scoped provenance pool for the bee tutorial — `sign('tutorial:artifacts')`.
// One document per location (subKey bucket) recording the practice structure
// the tour itself minted there: its rendered label, the parent segments, its
// merkle sig at record time, and the cover resource sigs.
//
// Cleanup is provenance-gated, never name-matched: only a RECORDED planner
// whose CURRENT child sig still equals the recorded sig may be GC'd. The
// moment a participant edits anything beneath it, the merkle sig diverges
// and the structure is theirs forever — a tour can never eat user work.
//
// The meaning carries a colon per the pool collision rule: lineage sigbags
// share the flat root namespace, so a bare-word meaning (e.g.
// `weekly-planner-tutorial`) would collide with any tile slugged the same.

import { resolveCurrentLayer, type PlacementHistory } from '../history/layer-placement.js'

const MEANING = 'tutorial:artifacts'

export type TutorialArtifactRecord = {
  /** Rendered (canonical slug) label of the practice structure. Empty = tombstone. */
  label: string
  /** Parent location it was minted at. */
  segments: readonly string[]
  /** Child sig at record time — the divergence detector. */
  plannerSig: string | null
  coverSigs: readonly string[]
  updatedAt: number
  /** True for the disposable practice PAGE — advertised as tidied-away, so a
   *  crash leftover is reclaimed WITHOUT the sig gate. Kept structures (the
   *  older keep-flow) stay sig-gated. */
  transient?: boolean
}

type StoreApi = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}
type LineageApi = { domain?: () => string }
type HistoryApi = { getLayerBySig(sig: string): Promise<{ name?: string } | null> }

const store = (): StoreApi | undefined =>
  window.ioc.get<StoreApi>('@hypercomb.social/Store') ?? undefined

const locationKey = (segments: readonly string[]): string =>
  'tutorial:planner:' + segments.map(s => String(s).toLowerCase()).join('/')

export const readTutorialRecord = async (
  segments: readonly string[],
): Promise<TutorialArtifactRecord | null> => {
  const s = store()
  if (!s) return null
  const pool = await s.getPool(MEANING)
  if (!pool) return null
  const bytes = await s.getPoolDoc(pool, locationKey(segments))
  if (!bytes) return null
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as TutorialArtifactRecord
    return record?.label ? record : null // tombstone reads as absent
  } catch {
    return null
  }
}

export const writeTutorialRecord = async (record: TutorialArtifactRecord): Promise<void> => {
  const s = store()
  if (!s) return
  const pool = await s.getPool(MEANING)
  if (!pool) return
  const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2))
  await s.putPoolDoc(pool, bytes.buffer as ArrayBuffer, locationKey(record.segments))
}

/** Document pools always hold one current member — clearing writes a tombstone. */
export const clearTutorialRecord = async (segments: readonly string[]): Promise<void> => {
  await writeTutorialRecord({ label: '', segments, plannerSig: null, coverSigs: [], updatedAt: Date.now() })
}

/**
 * The planner's CURRENT child sig in the parent layer at `segments` — the
 * merkle divergence detector (any edit anywhere beneath it changes this).
 * Null when the planner (or the parent layer) can't be resolved.
 */
export const tutorialPlannerSig = async (
  segments: readonly string[],
  label: string,
): Promise<string | null> => {
  const history = window.ioc.get<HistoryApi>('@diamondcoreprocessor.com/HistoryService')
  const lineage = window.ioc.get<LineageApi>('@hypercomb.social/Lineage')
  if (!history || !lineage) return null
  const cursor = window.ioc.get<{ currentLayerSig?: string }>('@diamondcoreprocessor.com/HistoryCursorService')
  const parent = await resolveCurrentLayer(
    history as unknown as PlacementHistory,
    lineage.domain,
    segments,
    cursor?.currentLayerSig,
  )
  const childSigs = Array.isArray((parent as { children?: unknown })?.children)
    ? ((parent as { children: unknown[] }).children)
    : []
  const wanted = label.toLowerCase()
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && typeof child.name === 'string' && child.name.toLowerCase() === wanted) {
      return String(sig)
    }
  }
  return null
}
