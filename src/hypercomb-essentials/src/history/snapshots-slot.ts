// history/snapshots-slot.ts
//
// `snapshots` layer slot — named restore points for the whole hive.
//
// ── What a snapshot is ────────────────────────────────────────────────
//
// ONE signature and a name. The signature is `sealSubtree([])` — a
// merkle-coherent root re-derived from live location heads — and it
// already names EVERYTHING the participant owns:
//
//   • tiles      — the `children` walk the seal performs
//   • behaviours — `decorations` is an ordinary slot, so it is INSIDE
//                  the layer signature; there is no metadata escape
//                  hatch and nothing extra to capture
//
// So a snapshot record is deliberately tiny:
//
//     { seal: <64-hex>, label: 'before the redesign', at: <ms> }
//
// It rides the resource pool like any other content, and the slot holds
// its signature — the same shape as `website` and `tutor`.
//
// ── What is NOT in it ─────────────────────────────────────────────────
//
// The installed module set (DCP's `syncSig`) is NOT recorded. That is
// the participant's local install state, not a property of their hive —
// folding it in would couple a snapshot to one machine. When a restored
// snapshot names a behaviour whose bee is absent, the sentinel fetches
// it BY SIGNATURE, sha256-gated, exactly as adopt already does. The
// proxy is a delivery mechanism, never snapshot state.
//
// Feature on/off is likewise absent, and for a stronger reason: the OFF
// switch writes a `kind:'hidden'` record into a participant-local pool
// and NEVER removes the decoration (features-viewer/feature-hidden.ts).
// Hiding is a visibility LENS — it exists so a swarm view can be cleared
// of features you do not own, and moving it into the layer would mean
// writing to layers that are not yours. It belongs with viewport and
// clipboard: local, never in history, never in a snapshot.
//
// ── Why a slot and not a pool ─────────────────────────────────────────
//
// Undo ⇒ layer + lineage bag. A pool is where things go to be EXCLUDED
// from history — `putPoolDoc` deletes every prior member on write, and
// no pool anywhere carries a cursor. Snapshots must be undoable, must
// travel on adoption, and must sit inside the merkle; that is a slot.
// (A `sign('snapshots')` pool would additionally need a colon in its
// meaning to avoid colliding with a root tile named `snapshots`.)
//
// ── Where it lives ────────────────────────────────────────────────────
//
// On the ROOT layer (`segments: []`) — the snapshot list is a property
// of the hive, not of any one tile. Appending one is a normal commit, so
// it is a single marker on the root lineage: one gesture, one entry,
// undoable like anything else.
//
// Note the benign recursion: appending snapshot N changes the root
// layer, so the seal taken by snapshot N+1 covers snapshot N. That is
// correct — the chain of snapshots is itself history.
//
// ── Read / write ──────────────────────────────────────────────────────
//
// READ:  `layer.snapshots` on the root layer — newest entry last.
// WRITE: `committer.commitSlotAppend([], 'snapshots', recordSig)`, or
//        the generic slot op:
//
//     { op: 'bag-set', segments: [], slot: 'snapshots', cells: [sig] }
//
// ── Registration ──────────────────────────────────────────────────────
//
// Registered PASSIVE (`triggers: []`): committed through the committer's
// public slot API, so no trigger event drives it. Registration declares
// the slot so the preloader warms it and history diff / introspection
// see it as first-class. Module-load-order independent via `whenReady`.
// Kept alive against tree-shaking by snapshot.queen.ts's import of
// `SNAPSHOTS_SLOT`.

// ── The index is monotonic ────────────────────────────────────────────
//
// One asymmetry, and it is deliberate. UNDO of a snapshot commit drops
// that snapshot from the list — it is an ordinary marker, so of course
// it does. But RESTORE carries the live `snapshots` slot FORWARD instead
// of reverting it to whatever the seal held. Otherwise restoring to an
// early point would erase every later restore point from the index and
// make restore a one-way door. The list is your map of history; history
// must not eat the map.

import { get } from '@hypercomb/core'
import type { LayerSlotRegistry } from './layer-slot-registry.js'

/**
 * Slot name on the layer JSON. Constant so the writer and any reader
 * share one string and cross-references stay greppable.
 */
export const SNAPSHOTS_SLOT = 'snapshots'

/** The JSON a snapshot record resource holds. */
export interface SnapshotRecord {
  /** `sealSubtree([])` at the moment the snapshot was taken. */
  seal: string
  /** The name the participant goes back to. */
  label: string
  /** When it was taken (ms since epoch). */
  at: number
  /** The record's own resource signature (filled in by the reader — it is
   *  the slot member id, not part of the stored JSON). */
  sig?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

/**
 * The root layer's `snapshots` slot, resolved to records, oldest first.
 * Shared by every surface that lists or resolves snapshots so the read
 * shape lives in exactly one place.
 *
 * Unreadable or malformed members are SKIPPED rather than failing the
 * whole read — one bad record must never make the index unusable.
 */
export async function readSnapshots(): Promise<SnapshotRecord[]> {
  const history = get<{
    sign?: (l: unknown) => Promise<string>
    currentLayerAt?: (sig: string) => Promise<Record<string, unknown> | null>
  }>('@diamondcoreprocessor.com/HistoryService')
  const store = get<{ getResource?: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return []

  const rootSig = await history.sign({ explorerSegments: () => [] })
  if (!rootSig) return []
  const root = await history.currentLayerAt(rootSig)
  const sigs = Array.isArray(root?.[SNAPSHOTS_SLOT]) ? root[SNAPSHOTS_SLOT] as unknown[] : []

  const out: SnapshotRecord[] = []
  for (const raw of sigs) {
    const sig = String(raw ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) continue
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      const parsed = JSON.parse(await blob.text()) as Partial<SnapshotRecord>
      if (typeof parsed?.seal !== 'string' || !SIG_RE.test(parsed.seal)) continue
      out.push({
        seal: parsed.seal,
        label: typeof parsed.label === 'string' ? parsed.label : '',
        at: typeof parsed.at === 'number' ? parsed.at : 0,
        sig,
      })
    } catch { /* skip unreadable member */ }
  }
  return out
}

/** Case-insensitive exact-label lookup, newest match wins (labels are not
 *  unique by construction — the participant may reuse a name). */
export function findSnapshot(records: readonly SnapshotRecord[], label: string): SnapshotRecord | null {
  const want = String(label ?? '').trim().toLowerCase()
  if (!want) return null
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].label.trim().toLowerCase() === want) return records[i]
  }
  return null
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: SNAPSHOTS_SLOT,
      triggers: [],
    })
  },
)
