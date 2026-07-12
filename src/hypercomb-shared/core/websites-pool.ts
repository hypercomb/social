// hypercomb-shared/core/websites-pool.ts
//
// The sign('websites:menu') pool — now ONLY the websites menu's one-time
// seed sentinel.
//
// Menu MEMBERSHIP moved to the aggregation LAYER (aggregation-layer.ts +
// documentation/aggregation-layer-model.md): the ['websites'] page layer's
// children are the source of truth, enable/disable are ordinary commits,
// and undo/redo is the location's normal history. The append-only marker
// chain this pool briefly held (enable/disable records) was retired the
// same day it was built and never shipped — no profile in the wild ever
// wrote it, so there is nothing to drain.
//
// What remains here is the bootstrap ledger: a single content-addressed
// sentinel record marking that the legacy decoration walk (websites-group's
// findWebsiteSites) has already been folded into the layer on this profile,
// so the walk never runs twice. Participant-local, never synced.
//
// WHY THE COLON in the meaning: lineage bags and pools share the flat OPFS
// root, and a location bag is named sha256(lineageKey(segments)) — a bare
// sign('websites') is byte-identical to the /websites launcher-page bag
// (verified live). lineageKey folds every non-letter/number to '-', so no
// location can ever hash a colon-bearing string — ':' makes this address
// collision-proof against every possible tile path. (Rule recorded in the
// CLAUDE.md pools table.)
//
// Shell-level: Store resolves through the global ioc at call time.

import { SignatureService, isSignature } from '@hypercomb/core'

const SEEDED_KIND = 'websites-seeded'
/** The pool's meaning string — its address is sign('websites:menu'), derived. */
const MEANING = 'websites:menu'

type StoreLike = { getPool(meaning: string): Promise<FileSystemDirectoryHandle | null> }
type PoolDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

async function pool(): Promise<PoolDir | null> {
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.getPool) return null
  return (await store.getPool(MEANING)) as PoolDir | null
}

/** Has the one-time legacy-walk seed already run on this profile? */
export async function isSeeded(): Promise<boolean> {
  const dir = await pool()
  if (!dir) return false
  try {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        if ((JSON.parse(await file.text()) as { kind?: string })?.kind === SEEDED_KIND) return true
      } catch { /* not the sentinel */ }
    }
  } catch { /* pool unreadable */ }
  return false
}

/** Mark the seed done — the discovery walk never runs again after this. */
export async function markSeeded(): Promise<void> {
  const dir = await pool()
  if (!dir) return
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: SEEDED_KIND }))
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    const handle = await dir.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes as unknown as BlobPart) } finally { await writable.close() }
  } catch { /* best-effort — an unseeded pool just re-runs the walk */ }
}
