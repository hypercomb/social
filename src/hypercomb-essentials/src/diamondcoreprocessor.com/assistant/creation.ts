// diamondcoreprocessor.com/assistant/creation.ts
//
// CREATION ID — one identity for everything made in a single act.
//
// Structural operations create SEVERAL tiles at once, and until now nothing
// recorded that they belonged together. That gap is not cosmetic: when an
// organize minted eight group tiles and then failed to move anything into
// them, the result was eight tiles sitting at the top level looking exactly
// like ordinary first-level content. Nothing in the hive could say "these
// eight came out of one run, and that run did not finish."
//
// So every structural act mints a creation id and stamps it on every tile it
// makes. With it:
//   • a half-finished batch is IDENTIFIABLE — find the tiles carrying the id
//   • a batch can be finished, or undone, as a UNIT rather than tile by tile
//   • the participant can see that a cluster of tiles was one decision
//
// The id is a SIGNATURE, per doctrine — sha256 of the canonical descriptor of
// the act (task, where, when). Same act, same id; a different act can never
// collide with it. It travels in the ask payload so the responder stamps the
// tiles IT creates with the same id the hive would have used.
//
// The stamp is a `kind:'creation'` decoration. Marks classify; nothing reads
// it to resolve content, so a tile missing its stamp renders identically —
// this is an index, never load-bearing.
import { SignatureService } from '@hypercomb/core'

/** Decoration kind carrying the creation id. */
export const CREATION_KIND = 'creation'

type StoreLike = {
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type CommitterLike = { update?: (segments: readonly string[], layer: object) => Promise<unknown> }

/** The id of one structural act. Deterministic: the same task at the same
 *  place and instant is the same creation, so a retry that re-derives it
 *  stamps the same batch rather than inventing a second one. */
export const mintCreationId = async (
  task: string,
  scopePath: readonly string[],
  at: number,
): Promise<string> => {
  const descriptor = JSON.stringify({ task, scope: [...scopePath], at })
  return SignatureService.sign(new TextEncoder().encode(descriptor).buffer as ArrayBuffer)
}

/** Stamp one tile as part of a creation. Appends — never replaces — because a
 *  tile can legitimately be touched by more than one act over its life, and
 *  losing the earlier stamp would erase the record of how it got here.
 *
 *  Returns false when it could not be written. A missing stamp degrades the
 *  index, not the tile: callers report it and carry on rather than aborting
 *  work the participant asked for. */
export const stampCreation = async (
  segments: readonly string[],
  creationId: string,
  task: string,
  role: string,
): Promise<boolean> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
  if (!store?.putResource || !history || !committer?.update) return false

  try {
    const record = {
      kind: CREATION_KIND,
      appliesTo: [...segments],
      // `role` says what this tile WAS in the act — 'group' for a container
      // organize minted, 'part' for a piece break-apart created. A resume needs
      // to tell a container it should fill from a leaf it already finished.
      payload: { id: creationId, task, role, at: Date.now() },
      mark: 'persistent',
    }
    const sig = await store.putResource(
      new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]),
    )

    const locationSig = await history.sign({ explorerSegments: () => [...segments] })
    const layer = await history.currentLayerAt(locationSig)
    if (!layer) return false

    const priorRaw = layer['decorations']
    const prior = Array.isArray(priorRaw)
      ? priorRaw.map(String).filter(s => /^[0-9a-f]{64}$/.test(s))
      : []
    if (prior.includes(sig)) return true

    await committer.update(segments, { ...layer, decorations: [...prior, sig] })
    return true
  } catch (err) {
    console.warn('[creation] could not stamp', segments.join('/'), err)
    return false
  }
}

/** Read the creation stamps on a layer. Empty when the tile carries none —
 *  which is the normal state for anything a participant made by hand. */
export const creationsOf = async (
  layer: Record<string, unknown> | null,
): Promise<Array<{ id: string; task: string; role: string }>> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const raw = layer?.['decorations']
  if (!store?.getResource || !Array.isArray(raw)) return []

  const out: Array<{ id: string; task: string; role: string }> = []
  for (const sig of raw) {
    try {
      const blob = await store.getResource(String(sig))
      if (!blob) continue
      const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
      if (rec?.kind !== CREATION_KIND) continue
      const p = rec.payload ?? {}
      out.push({
        id: String(p['id'] ?? ''),
        task: String(p['task'] ?? ''),
        role: String(p['role'] ?? ''),
      })
    } catch { /* unreadable decoration — not this index's problem */ }
  }
  return out
}
