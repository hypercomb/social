// commands/layout-read.ts
//
// Reading a tile's layout: shared by the layout word (layout.queen.ts) and the
// grid's view of it (layout-view.drone.ts). Not a bee: a bee may not import
// from another bee's file, so what both need lives here.

import { listDecorations } from './decoration-manifest.js'
import { LAYOUT_KIND, currentLayout, layoutNames, type LayoutRecord } from './layout.js'

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(sig: string): Promise<Blob | null>
}

export const store = (): StoreLike | undefined => window.ioc.get<StoreLike>('@hypercomb.social/Store')

/** The word list behind a layout record, or [] when its bytes are not here. */
export async function namesOf(record: LayoutRecord | null): Promise<string[]> {
  if (!record?.names) return []
  try {
    const blob = await store()?.getResource(record.names)
    const parsed = blob ? JSON.parse(await blob.text()) : []
    return Array.isArray(parsed) ? layoutNames(parsed) : []
  } catch { return [] }
}

/** The layout a tile wears now, with its records (so a switch can retire them). */
export async function layoutAt(segments: readonly string[]) {
  const records = await listDecorations<LayoutRecord>({ kind: LAYOUT_KIND, segments })
  return { records, layout: currentLayout(records) }
}

