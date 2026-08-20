// hypercomb-essentials/src/diamondcoreprocessor.com/commands/view-default.ts
//
// THE LAYER'S DEFAULT VIEW — one record, one meaning: "when you come to this
// layer, this is the view that opens."
//
// It is a DECORATION on the layer, not a participant preference. The default
// is a fact about the place, so it is undoable, it rides the layer commit to
// the root, it travels when the branch is adopted, and a peer who walks into
// your tile arrives the way you arranged it. (It replaced a
// `hc:view-defaults` localStorage map that could do none of those, and that
// only tinted an icon.)
//
// MUTUAL EXCLUSIVITY IS STRUCTURAL: the writer is `replaceDecoration`, which
// drops every prior record of the kind before appending. A layer has one
// default view or none — there is no list to reconcile.
//
// The kind is `view:default`, deliberately NOT `visual:*`: show-features
// mints a "foreign behaviour" row for any unrecognized `visual:` kind, and
// this mark is not a behaviour — it is a note about one.

import {
  listDecorations,
  removeDecorationAndWait,
  replaceDecoration,
} from './decoration-manifest.js'
import { DEFAULT_VIEW_DECORATION_KIND } from './decoration-kind-index.js'

interface DefaultViewPayload {
  /** The ViewMode token — `VisualBeeDescriptor.view`, e.g. `postit`. */
  view?: string
}

/** The view this layer opens as, or '' when it has no default. */
export async function defaultViewAt(segments: readonly string[]): Promise<string> {
  try {
    const records = await listDecorations<DefaultViewPayload>({
      kind: DEFAULT_VIEW_DECORATION_KIND,
      segments: [...segments],
    })
    for (const record of records) {
      const view = String(record.record?.payload?.view ?? '').trim()
      if (view) return view
    }
  } catch { /* cold read — the caller treats a miss as "no default" */ }
  return ''
}

/** Make `view` this layer's default. Replaces any prior default here. */
export function writeDefaultView(
  segments: readonly string[],
  view: string,
): Promise<string> {
  return replaceDecoration<DefaultViewPayload>({
    kind: DEFAULT_VIEW_DECORATION_KIND,
    appliesTo: [...segments],
    segments: [...segments],
    payload: { view },
    mark: 'persistent',
  })
}

/** Drop this layer's default — it goes back to opening as hexagons.
 *  Awaited to the root so the panel's re-read sees it gone. */
export async function clearDefaultView(segments: readonly string[]): Promise<boolean> {
  const records = await listDecorations<DefaultViewPayload>({
    kind: DEFAULT_VIEW_DECORATION_KIND,
    segments: [...segments],
  })
  if (records.length === 0) return false
  for (const record of records) {
    await removeDecorationAndWait({ sig: record.sig, segments: [...segments] })
  }
  return true
}
