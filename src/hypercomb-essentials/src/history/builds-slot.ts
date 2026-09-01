// history/builds-slot.ts
//
// `builds` layer slot — build revisions for a subtree: named restore
// points minted by a BUILD PASS (a site regen, a game stamp, any
// producer that writes many files in one gesture).
//
// ── What a build revision is ──────────────────────────────────────────
//
// A SCOPED SNAPSHOT. Same record shape, one scope narrower:
//
//     { seal: <64-hex>, label: 'dolphin build 3', at: <ms> }
//
// where `seal` is `sealSubtree(buildRootSegments)` taken right after the
// pass — one signature that already names EVERYTHING the build touched:
//
//   • every cell's page — the `website`/`tutor`/`decorations` slots are
//     ordinary slots, so they are INSIDE the layer signatures the seal
//     folds; there is no metadata escape hatch
//   • every shared asset (chrome.css, images, engine files) — pinned
//     transitively, because page BYTES reference assets sig-only
//     (`resource:<sig>` forms), and the pages are pinned by the seal
//
// Page-to-page links stay NAME-based (lineage-is-the-route — see
// documentation/embedded-sites.md); they are revision-safe because a
// build restores AS A UNIT, so name links always land on pages of the
// same generation.
//
// The record's own resource sig is the revision handle. NO random
// revision code, no build id: an identical rebuild produces the identical
// seal, so "did anything change" is one compare — `mintBuildRecord`
// no-ops on it and the chain never grows on a no-change rebuild.
//
// ── Why a slot (same reasoning as snapshots-slot.ts) ─────────────────
//
// Undo ⇒ layer + lineage bag. The record must be undoable, must travel
// on adoption/share, and must sit inside the merkle — that is a slot on
// the BUILD ROOT's layer, not a pool. The chain of `builds` sigs down
// that cell's lineage IS the build history — read, not recorded, exactly
// like page versions in websites.source.ts.
//
// The index is MONOTONIC on restore (see seal-restore.ts): restoring an
// old build carries the live `builds` slot forward so later revisions
// stay in the list — history must not eat the map.
//
// ── Registration ──────────────────────────────────────────────────────
//
// Registered PASSIVE (`triggers: []`), like `website` and `snapshots`:
// committed through the committer's public slot API. Kept alive against
// tree-shaking by builds.queen.ts and claude-bridge.worker.ts importing
// `BUILDS_SLOT` / `mintBuildRecord`.

import { get, SignatureService } from '@hypercomb/core'
import { HistoryService } from './history.service.js'
import type { LayerSlotRegistry } from './layer-slot-registry.js'

/**
 * Slot name on the layer JSON. Constant so writers and readers share one
 * string and cross-references stay greppable.
 */
export const BUILDS_SLOT = 'builds'

/** The JSON a build record resource holds — the snapshot record shape,
 *  scoped to a subtree. */
export interface BuildRecord {
  /** `sealSubtree(buildRootSegments)` right after the pass. */
  seal: string
  /** The name of the pass (producer-supplied, or `build-N`). */
  label: string
  /** When the pass finished (ms since epoch). */
  at: number
  /** The record's own resource signature (filled in by the reader — it is
   *  the slot member id, not part of the stored JSON). */
  sig?: string
}

const SIG_RE = /^[a-f0-9]{64}$/

interface HistoryLike {
  sign?: (l: unknown) => Promise<string>
  currentLayerAt?: (sig: string) => Promise<Record<string, unknown> | null>
  sealSubtree?: (segments: readonly string[]) => Promise<string | null>
  healSubtreeBags?: (segments: readonly string[]) => Promise<unknown>
  getLayerBySig?: (sig: string) => Promise<Record<string, unknown> | null>
}
interface StoreLike {
  putResource?: (b: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}
interface CommitterLike {
  commitSlotAppend?: (segments: readonly string[], slot: string, sig: string) => Promise<void>
}

const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

/**
 * The `builds` slot at `segments`, resolved to records, oldest first.
 * Unreadable or malformed members are SKIPPED — one bad record must
 * never make the chain unusable.
 */
export async function readBuildsAt(segments: readonly string[]): Promise<BuildRecord[]> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return []

  const locationSig = await history.sign({ explorerSegments: () => [...segments] })
  if (!locationSig) return []
  const layer = await history.currentLayerAt(locationSig)
  const sigs = Array.isArray(layer?.[BUILDS_SLOT]) ? layer[BUILDS_SLOT] as unknown[] : []

  const out: BuildRecord[] = []
  for (const raw of sigs) {
    const sig = String(raw ?? '').trim().toLowerCase()
    if (!SIG_RE.test(sig)) continue
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      const parsed = JSON.parse(await blob.text()) as Partial<BuildRecord>
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

/**
 * The seal a build revision is COMPARED by: the sealed root layer with
 * its `builds` slot stripped, re-signed (no commit). Appending a record
 * changes the root layer — the snapshots doc's benign recursion — so the
 * RAW seal can never equal itself across a mint; the index is a map of
 * history, not content, and must not count as change. Restore still
 * walks the RAW seal (with the index carried forward). Falls back to the
 * raw seal when the sealed layer cannot be loaded.
 */
async function contentSealOf(rawSeal: string): Promise<string> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const layer = await history?.getLayerBySig?.(rawSeal)
  if (!layer) return rawSeal
  const stripped = { ...layer } as Record<string, unknown>
  delete stripped[BUILDS_SLOT]
  const canonical = HistoryService.canonicalizeLayer(stripped as { name: string })
  const bytes = new TextEncoder().encode(JSON.stringify(canonical))
  return SignatureService.sign(bytes.buffer as ArrayBuffer)
}

/**
 * Mint a build revision at `segments`: seal the subtree, no-op if the
 * head record already names that seal (idempotent rebuild), otherwise
 * write the record and append its sig to the `builds` slot — one commit,
 * one marker, undoable like anything else.
 *
 * The single implementation behind the bridge `build-record` op and the
 * `/builds record` gesture, so producers and participants mint the exact
 * same record.
 *
 * `dryRun` seals and compares but NEVER writes — the atomicity audit's
 * probe (`scripts/audit-atomicity.cjs`): `unchanged` then answers "does
 * the live subtree still match its last recorded build?" and an empty
 * `sig` answers "has this root never recorded one?".
 */
export async function mintBuildRecord(
  segments: readonly string[],
  label?: string,
  opts?: { dryRun?: boolean },
): Promise<{ sig: string; seal: string; label: string; unchanged: boolean; dryRun?: boolean } | { error: string }> {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<StoreLike>(STORE_KEY)
  const committer = get<CommitterLike>(COMMITTER_KEY)
  if (!history?.sealSubtree || !store?.putResource || !committer?.commitSlotAppend) {
    return { error: 'core services are not ready' }
  }

  // Seal from live heads; heal once, retry, else fail LOUD — never name
  // a tree that cannot dereference (same contract as /snapshot).
  let seal = await history.sealSubtree(segments)
  if (!seal) {
    try { await history.healSubtreeBags?.(segments) } catch { /* heal is best-effort */ }
    seal = await history.sealSubtree(segments)
  }
  if (!seal || !SIG_RE.test(seal)) {
    return { error: 'the subtree could not be sealed (a cell is cold or unresolvable) — visit it once and retry' }
  }

  const existing = await readBuildsAt(segments)
  const head = existing.length ? existing[existing.length - 1] : null
  // Compare by CONTENT seal (builds slot stripped): the record's own
  // append must not read as change, or no mint could ever be a no-op.
  const unchanged = head
    ? (head.seal === seal || (await contentSealOf(head.seal)) === (await contentSealOf(seal)))
    : false
  if (head && unchanged) {
    return { sig: head.sig ?? '', seal: head.seal, label: head.label, unchanged: true, ...(opts?.dryRun ? { dryRun: true } : {}) }
  }
  if (opts?.dryRun) {
    // Probe only: report the head (or its absence) without minting.
    return { sig: head?.sig ?? '', seal, label: head?.label ?? '', unchanged: false, dryRun: true }
  }

  const name = (label ?? '').trim() || `build-${existing.length + 1}`
  const record: BuildRecord = { seal, label: name, at: Date.now() }
  const sig = await store.putResource(
    new Blob([JSON.stringify(record)], { type: 'application/json' }),
  )
  if (!sig || !SIG_RE.test(sig)) return { error: 'the build record could not be written' }

  await committer.commitSlotAppend(segments, BUILDS_SLOT, sig)
  return { sig, seal, label: name, unchanged: false }
}

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: BUILDS_SLOT,
      triggers: [],
    })
  },
)
