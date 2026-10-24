// hypercomb-essentials/src/commands/publish-history.ts
//
// WHETHER A PUBLICATION SERVES ITS HISTORY — one record, one meaning: "this
// branch's earlier versions are public too, not only its head."
//
// The default is HEAD ONLY: no record at all. A branch whose root carries a
// `publish:history` decoration with payload `{ public: true }` has public
// history — the worker and the native host read the same mark off the
// published root, so the contract is this kind, this payload, this place.
//
// It is a DECORATION on the branch root, exactly like `publish:lights` and
// for the same reason: it is a fact about the PLACE, so it is undoable, it
// rides the layer commit to the root, and it is sealed into the published
// closure the host reads. Turning it on or off is a layer commit (typed human
// intent) followed by republishing, so the host sees the new head.
//
// MUTUAL EXCLUSIVITY IS STRUCTURAL: the writer is `replaceDecoration`, which
// drops every prior record of the kind before appending. A branch carries
// one mark or none.
//
// The kind is `publish:history`, deliberately NOT `visual:*`: show-features
// mints a "foreign behaviour" row for any unrecognized `visual:` kind, and
// this mark is not a behaviour.

import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'

/** The decoration kind — shared with the worker and the Rust host. */
export const PUBLISH_HISTORY_DECORATION_KIND = 'publish:history'

interface PublishHistoryPayload {
  public?: boolean
}

/** Whether this branch publishes its history: `true` when its root carries
 *  the mark with `public: true`, `false` when it carries a mark that says
 *  otherwise, `null` when it carries no mark at all — head only, the
 *  default. */
export async function publicHistoryAt(
  segments: readonly string[],
): Promise<boolean | null> {
  try {
    const records = await listDecorations<PublishHistoryPayload>({
      kind: PUBLISH_HISTORY_DECORATION_KIND,
      segments: [...segments],
    })
    for (const record of records) {
      const value = record.record?.payload?.public
      if (typeof value === 'boolean') return value
    }
  } catch { /* cold read — the caller treats a miss as "no mark" */ }
  return null
}

/** Mark this branch's history public. Replaces any prior mark here. This
 *  CHANGES THE HEAD — republish after it so the host sees the mark. */
export function writePublicHistory(segments: readonly string[]): Promise<string> {
  return replaceDecoration<PublishHistoryPayload>({
    kind: PUBLISH_HISTORY_DECORATION_KIND,
    appliesTo: [...segments],
    segments: [...segments],
    payload: { public: true },
    mark: 'persistent',
  })
}

/** Drop the mark — the branch publishes its head only. Awaited to the root
 *  so a re-read sees it gone. `false` when there was nothing to drop. */
export async function clearPublicHistory(segments: readonly string[]): Promise<boolean> {
  const records = await listDecorations<PublishHistoryPayload>({
    kind: PUBLISH_HISTORY_DECORATION_KIND,
    segments: [...segments],
  })
  if (records.length === 0) return false
  for (const record of records) {
    await removeDecorationAndWait({ sig: record.sig, segments: [...segments] })
  }
  return true
}
