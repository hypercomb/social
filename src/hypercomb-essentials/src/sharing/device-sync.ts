// sharing/device-sync.ts
//
// THE WALK. Given a live, proven link to another of the participant's devices,
// bring THIS device up to what that device holds — and only ever add
// (documentation/device-sync.md). Any device can be the source and any device
// the backup: the one that asks is the one that walks.
//
// The tree is the set of LINEAGE BAGS, one per node. A bag is a folder of
// numbered markers; the highest marker names the node's current layer and the
// earlier ones are its history. Comparing two devices is comparing heads, bag
// by bag:
//
//   peer has no such bag      pull markers 0 … n
//   peer is ahead (n > mine)  pull markers mine+1 … n
//   same index, same layer    nothing to do
//   same index, other layer   a FORK — both devices advanced from the same
//                             point. Nothing is overwritten, nothing is
//                             merged here; it is recorded and left for a
//                             commit that joins both heads
//   I am ahead                nothing to pull; the peer's own walk fetches it
//
// Each marker is taken ONLY after the layer it names is wholly here: the
// closure is pulled first (through the replication walker, which hashes every
// atom against its name), the marker is appended after. A reader that follows
// a marker therefore never finds nothing, and a walk cut off halfway leaves a
// shorter history, never a broken one. A bag that fails stops there and the
// rest carry on; a second press resumes — there is no state to repair.
//
// WHAT IT WILL NOT TOUCH. Only lineage bags travel in this generation. Pools
// of meaning are excluded on purpose: a pool may be this machine's own setting
// (`device:pairing`, `swarm:keep-alive`), and "never widen what a backup
// copies" is the standing rule for anything that carries private bytes. A pool
// joins the walk when someone decides, pool by pool, that it travels.

import type { BagHead, DeviceLink } from './device-link.js'

export type ForkRecord = { bag: string; name: string; mine: string; theirs: string }

export type SyncSummary = {
  /** Bags compared. */
  bags: number
  /** Bags that moved forward. */
  advanced: number
  /** Markers appended. */
  markers: number
  /** Bags already level, or ahead of the peer. */
  level: number
  /** Where both devices went their own way. */
  forks: ForkRecord[]
  /** Bags that stopped, with why. */
  failed: { bag: string; reason: string }[]
  /** The peer would not tell us its heads, or the link dropped. */
  ok: boolean
}

/** This device's side of the walk. The real one reads the store; a test's is a map. */
export interface SyncStore {
  /** The head of every lineage bag held here that is NOT a pool. */
  heads(): Promise<BagHead[]>
  /** The layer marker `name` of `bag` names, or null. */
  markerLayer(bag: string, name: string): Promise<string | null>
  /**
   * Append marker `name` to `bag`, creating the bag if need be. Forward only:
   * false when `name` is not the very next marker, or a marker already holds
   * that name. Never replaces.
   */
  appendMarker(bag: string, name: string, layer: string): Promise<boolean>
}

/**
 * Pull `layer` and everything it names into the local heap, asking `fetch`
 * for what is missing. True only when the closure is COMPLETE — no holes, no
 * refused atoms. The real one is `replicate(root)` through `peerIo`.
 */
export type Pull = (layer: string, fetch: (signature: string) => Promise<Uint8Array<ArrayBuffer> | null>) => Promise<boolean>

export type SyncProgress = { bag: number; of: number; markers: number }

const markerName = (index: number): string => String(index).padStart(8, '0')

export const syncFromPeer = async (
  link: DeviceLink,
  store: SyncStore,
  pull: Pull,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncSummary> => {
  const summary: SyncSummary = { bags: 0, advanced: 0, markers: 0, level: 0, forks: [], failed: [], ok: false }

  const theirs = await link.heads()
  if (!theirs) return summary
  const mine = new Map((await store.heads()).map(head => [head.bag, head]))
  summary.ok = true
  summary.bags = theirs.length

  const fetch = (signature: string) => link.fetch(signature)

  let done = 0
  for (const remote of theirs) {
    onProgress?.({ bag: done++, of: theirs.length, markers: summary.markers })
    if (!link.peer) { summary.ok = false; break }

    const local = mine.get(remote.bag)
    const remoteIndex = Number(remote.name)
    const localIndex = local ? Number(local.name) : -1

    // Where we both have a marker, it must name the same layer — else the
    // histories diverged and following the peer would rewrite ours.
    if (local) {
      const sharedIndex = Math.min(localIndex, remoteIndex)
      const sharedName = markerName(sharedIndex)
      const mineThere = sharedIndex === localIndex ? local.layer : await store.markerLayer(remote.bag, sharedName)
      const theirsThere = sharedIndex === remoteIndex ? remote.layer : await link.marker(remote.bag, sharedName)
      if (mineThere && theirsThere && mineThere !== theirsThere) {
        summary.forks.push({ bag: remote.bag, name: sharedName, mine: mineThere, theirs: theirsThere })
        continue
      }
    }

    if (localIndex >= remoteIndex) { summary.level += 1; continue }

    let moved = 0
    let stopped: string | null = null
    for (let index = localIndex + 1; index <= remoteIndex; index++) {
      const name = markerName(index)
      const layer = index === remoteIndex ? remote.layer : await link.marker(remote.bag, name)
      if (!layer) { stopped = `marker ${name} unavailable`; break }
      // The layer first, the marker after: complete or absent.
      if (!(await pull(layer, fetch))) { stopped = `layer for ${name} incomplete`; break }
      if (!(await store.appendMarker(remote.bag, name, layer))) { stopped = `marker ${name} not appended`; break }
      moved += 1
      summary.markers += 1
    }
    if (moved > 0) summary.advanced += 1
    if (stopped) summary.failed.push({ bag: remote.bag, reason: stopped })
  }
  onProgress?.({ bag: theirs.length, of: theirs.length, markers: summary.markers })
  return summary
}
