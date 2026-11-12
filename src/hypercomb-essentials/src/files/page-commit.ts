// files/page-commit.ts
//
// ONE WAY A TILE'S PAGE IS REPLACED. The bytes are already a resource; this
// points the tile at them where the site view will find them:
//
//   - a tile whose page is kept in the `website` slot gets the new sig
//     appended there (the newest entry is the page);
//   - otherwise the page decoration is replaced, keeping what the prior one
//     said about itself (its label, its icon) and changing only the bytes.
//
// Nothing is deleted: the bytes it replaces stay at the content root and the
// tile's history still reaches them, so a replacement is one undo away. Used
// by a model's write block (tile-files.drone.ts) and by inline text editing on
// a website (presentation/tiles/site-text-edit.ts).

import { get } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { ensureWebsiteBoundAt } from '../commands/website-binding.js'

const PAGE_KIND = 'visual:website:page'
const WEBSITE_SLOT = 'website'

type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}
type CommitterLike = { commitSlotSet?(segments: readonly string[], slot: string, sigs: readonly string[]): Promise<void> }

const isSig = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export type PageCommit = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** Point the tile at `segments` to the page `htmlSig`. */
export async function commitPageSig(segments: readonly string[], htmlSig: string): Promise<PageCommit> {
  const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  const layer = history ? await history.currentLayerAt(await history.sign({ explorerSegments: () => segments })).catch(() => null) : null
  const slot = Array.isArray(layer?.[WEBSITE_SLOT]) ? (layer![WEBSITE_SLOT] as unknown[]).filter(isSig) : []
  if (slot.length) {
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!committer?.commitSlotSet) return { ok: false, error: 'the layer committer is not available' }
    await committer.commitSlotSet(segments, WEBSITE_SLOT, [...slot.filter(s => s !== htmlSig), htmlSig])
    await bind(segments)
    return { ok: true }
  }
  const priors = await listDecorations<Record<string, unknown>>({ kind: PAGE_KIND, segments })
  for (const prior of priors) await removeDecorationAndWait({ sig: prior.sig, segments })
  const kept = priors[priors.length - 1]?.record.payload ?? {}
  await writeDecoration({
    kind: PAGE_KIND,
    appliesTo: segments,
    payload: { order: 0, ...kept, htmlSig, createdAt: Date.now() },
    segments,
    mark: 'persistent',
  })
  await bind(segments)
  return { ok: true }
}

/** A PAGE IS ONLY SEEN WHERE ITS BEHAVIOUR IS AWAKE. A hive that binds the website
 *  behaviour to the tiles that hold sites reads every other tile as dormant, and the
 *  view quietly falls back to hexagons: a page a model wrote existed and could not
 *  be reached (jwize's hive, 2026-10-25). A write binds the tile it dresses. Never
 *  load-bearing: a failure here leaves the page written. */
async function bind(segments: readonly string[]): Promise<void> {
  try { await ensureWebsiteBoundAt(segments) } catch { /* the page is written; binding is re-derived by the session sweep */ }
}
