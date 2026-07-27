// diamondcoreprocessor.com/history/seal-restore.ts
//
// The one restore walk: bring every location under `rootSegments` to the
// sealed tree's content. Shared by /restore (whole hive, snapshots) and
// /builds restore (a build root's subtree) so the two gestures cannot
// drift — same addressing, same append-only promotion, same monotonic-
// index carry-forward.
//
// Nothing is deleted and nothing is rewritten: each location whose head
// differs gets ONE appended head marker via `commitLayer` (byte-identical
// content dedups without writing). Tiles that exist now but not in the
// seal stop being reachable from the new head; their bags, markers and
// bytes all survive — which is precisely what makes "go back" work.
//
// `carrySlots` names index slots on the RESTORE ROOT that are carried
// FORWARD from the live head instead of reverted to what the seal held
// (`snapshots` for /restore, `builds` for /builds restore). The list is
// the participant's map of history; history must not eat the map.

import { get } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

/**
 * Walk `seal` and promote every differing location under `rootSegments`.
 * Recursion is BY LOCATION (parent segments + the sealed child's own
 * `name`), the same addressing sealSubtree used on the way out, so a
 * child lands in the bag it belongs to rather than wherever a stale
 * hint pointed.
 */
export async function applySealAt(
  rootSegments: readonly string[],
  seal: string,
  carrySlots: readonly string[] = [],
): Promise<{ changed: number; failed: number }> {
  const history = get<HistoryService>(HISTORY_KEY)
  if (!history?.getLayerBySig || !history?.commitLayer || !history?.sign
    || !history?.currentLayerAt || !history?.latestMarkerSigFor) {
    return { changed: 0, failed: 1 }
  }

  let changed = 0
  let failed = 0
  const seen = new Set<string>()

  const visit = async (segments: readonly string[], sealedSig: string, isRoot: boolean): Promise<void> => {
    if (seen.has(sealedSig)) return
    seen.add(sealedSig)

    const layer = await history.getLayerBySig(sealedSig)
    if (!layer) { failed++; return }

    const locSig = await history.sign({ explorerSegments: () => [...segments] })
    if (!locSig) { failed++; return }

    let toCommit: typeof layer = layer
    if (isRoot && carrySlots.length > 0) {
      const before = await history.currentLayerAt(locSig) as Record<string, unknown> | null
      for (const slot of carrySlots) {
        const live = before?.[slot]
        if (Array.isArray(live) && live.length > 0) {
          toCommit = { ...toCommit, [slot]: live }
        }
      }
    }

    const headBefore = await history.latestMarkerSigFor(locSig, layer.name ?? '')
    const after = await history.commitLayer(locSig, toCommit)
    if (after !== headBefore) changed++

    for (const raw of (Array.isArray(layer.children) ? layer.children : [])) {
      const childSig = String(raw ?? '').trim().toLowerCase()
      const child = await history.getLayerBySig(childSig)
      const childName = (child?.name ?? '').trim()
      if (!childName) { failed++; continue }
      await visit([...segments, childName], childSig, false)
    }
  }

  await visit([...rootSegments], seal, true)
  return { changed, failed }
}
