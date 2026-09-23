// tutorial/tutorial-provenance.ts
//
// Scoped provenance pool for the bee tutorial — `sign('tutorial:artifacts')`.
// One document per WORD (subKey bucket = the molecule address of the tile the
// practice structure was minted under) recording what the tour minted there:
// its rendered label, the parent segments as a route, its merkle sig at
// record time, and the cover resource sigs. The name is the identity and a
// path is a route (hypergraph-molecule-lineage.md): the record follows the
// word wherever it is routed, as a tile's notes do.
//
// Cleanup is provenance-gated, never name-matched: only a RECORDED planner
// whose CURRENT child sig still equals the recorded sig may be GC'd. The
// moment a participant edits anything beneath it, the merkle sig diverges
// and the structure is theirs forever — a tour can never eat user work.
//
// The meaning carries a colon per the pool collision rule: lineage sigbags
// share the flat root namespace, so a bare-word meaning (e.g.
// `weekly-planner-tutorial`) would collide with any tile slugged the same.

import { moleculeAddress } from '@hypercomb/core'
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
  /** GROUP SIGNATURE of the course that minted this — `sign('group:tutorial:
   *  course:<level>')`. Everything one course makes carries the same one, so a
   *  course's artifacts are addressable, countable, and removable as ONE unit
   *  instead of as whatever a cleanup function happens to remember. See
   *  core/group-signature.ts. */
  groupSig?: string
  /** Human-readable meaning behind `groupSig`, so a record is legible without
   *  re-deriving the signature. */
  groupMeaning?: string
}

type StoreApi = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}
type LineageApi = { domain?: () => string }
type HistoryApi = {
  getLayerBySig(sig: string): Promise<{ name?: string } | null>
  sign?(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
}

const store = (): StoreApi | undefined =>
  window.ioc.get<StoreApi>('@hypercomb.social/Store') ?? undefined

/** The old sub-bucket: a PATH string, lowercased and joined — a spelling
 *  minted here and nowhere else (write-conformance, tutorial-provenance.ts:82).
 *  READ-FALLBACK ONLY: records written under it stay readable; nothing is
 *  rewritten and nothing new lands here. */
const legacyLocationKey = (segments: readonly string[]): string =>
  'tutorial:planner:' + segments.map(s => String(s).toLowerCase()).join('/')

/** THE SUB-BUCKET IS THE WORD: the molecule address of the tile the practice
 *  structure lives under — the last segment, canonical and folded, signed
 *  (core moleculeAddress). Null at the root, where there is no word and
 *  therefore nothing is written. */
const wordAddress = async (segments: readonly string[]): Promise<string | null> => {
  const word = segments.at(-1)
  if (typeof word !== 'string' || !word.trim()) return null
  try { return await moleculeAddress(word) } catch { return null }
}

/** The interim sub-bucket (2026-09-04 to 2026-09-23): the location's
 *  PATH-DERIVED bag signature — a route hashed, which the molecule doctrine
 *  retires as an identity (write-conformance check 4, the adjudication's
 *  incomplete fix). READ-FALLBACK ONLY, like the path string before it. */
const legacyPathAddress = async (segments: readonly string[]): Promise<string | null> => {
  const history = window.ioc.get<HistoryApi>('@diamondcoreprocessor.com/HistoryService')
  if (!history?.sign) return null
  try {
    const sig = await history.sign({ explorerSegments: () => segments.map(s => String(s)) })
    return /^[0-9a-f]{64}$/i.test(sig) ? sig.toLowerCase() : null
  } catch { return null }
}

export const readTutorialRecord = async (
  segments: readonly string[],
): Promise<TutorialArtifactRecord | null> => {
  const s = store()
  if (!s) return null
  const pool = await s.getPool(MEANING)
  if (!pool) return null
  const address = await wordAddress(segments)
  const bytes = (address ? await s.getPoolDoc(pool, address) : null)
    ?? await (async () => { const interim = await legacyPathAddress(segments); return interim ? s.getPoolDoc(pool, interim) : null })()
    ?? await s.getPoolDoc(pool, legacyLocationKey(segments))
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
  const address = await wordAddress(record.segments)
  if (!address) return   // no word (the root), no address, no write — never a path
  const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2))
  await s.putPoolDoc(pool, bytes.buffer as ArrayBuffer, address)
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
