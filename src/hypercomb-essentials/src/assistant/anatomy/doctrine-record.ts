// assistant/anatomy/doctrine-record.ts
//
// THE DOCTRINE'S CODEX, DERIVED — one record per doctrine HEAD VECTOR.
//
// The doctrine is the `/doctrine` tile tree (doctrine-tree.ts). History is
// committed per page — a change commits only the tile it touched, and a
// parent's child signature is a hint that can lag — so no single layer
// signature names the doctrine. Its tiles' heads do: the signature of every
// doctrine tile's route and head layer signature (the walk's `vector`) names
// exactly one codex, because the codex is read from those head layers alone
// (notes from each layer's own `notes` slot). It is a pure function of that
// signature (M1: anyone holding the heads recomputes it, trusting nobody),
// which makes it a derived cache in the optimize-phase sense (D1–D5):
//
//   - keyed by the input signature, so it never goes stale: a changed
//     doctrine is a new head vector with no record yet;
//   - minted only in the optimize phase (doctrine-codex.drone.ts), complete
//     or absent — a read that met a tile not on this device is never minted;
//   - never load-bearing: a miss reads the notes and gets the same codex.
//
// What it buys: the doctrine read becomes one walk of heads (cached per tree
// epoch by the tree reader) plus one record read, instead of reading every
// tier's and rule's notes. And because the record names the codex by
// signature (`codexSig`), two hives that run the same doctrine hold the same
// codex resource — comparing one signature says they agree.
//
// The record is a pool document `{ source, codexSig }` under the source
// (head vector) signature; the codex text is a root resource the record names.

export const DOCTRINE_CODEX_MEANING = 'system:doctrine-codex'
const SIG = /^[a-f0-9]{64}$/

export type DoctrineRecordStore = {
  putResource?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }) => Promise<string | null>
}

export type DoctrineRecord = { readonly source: string; readonly codexSig: string; readonly codex: string }

/** The record for this doctrine signature, with the codex it names, or null.
 *  NEVER derives and never creates the pool. */
export const readDoctrineRecord = async (store: DoctrineRecordStore, source: string): Promise<DoctrineRecord | null> => {
  if (!SIG.test(source) || !store.getPoolDoc || !store.getResource) return null
  try {
    const pool = await (store.openPool ?? store.getPool)?.(DOCTRINE_CODEX_MEANING)
    if (!pool) return null
    const bytes = await store.getPoolDoc(pool, source)
    if (!bytes) return null
    const record = JSON.parse(new TextDecoder().decode(bytes)) as { source?: unknown; codexSig?: unknown }
    if (record.source !== source || typeof record.codexSig !== 'string' || !SIG.test(record.codexSig)) return null
    const codex = await (await store.getResource(record.codexSig))?.text()
    return codex ? { source, codexSig: record.codexSig, codex } : null
  } catch { return null }
}

/** Mint the record: the codex as a resource, the record naming it. Called
 *  from the optimize phase only. Best-effort — a failed write costs a slower
 *  read next time and nothing else. */
export const writeDoctrineRecord = async (store: DoctrineRecordStore, source: string, codex: string): Promise<boolean> => {
  if (!SIG.test(source) || !codex || !store.putResource || !store.getPool || !store.putPoolDoc) return false
  try {
    const codexSig = await store.putResource(new Blob([codex], { type: 'text/plain' }), { emit: false })
    const pool = await store.getPool(DOCTRINE_CODEX_MEANING)
    if (!pool) return false
    const bytes = new TextEncoder().encode(JSON.stringify({ source, codexSig })).buffer as ArrayBuffer
    return !!(await store.putPoolDoc(pool, bytes, source, { keep: 'current' }))
  } catch { return false }
}

// ── what the next optimize pass mints ──────────────────────────────────────
//
// A cold read derived a complete codex for a signature that has no record;
// it says so here and writes nothing. The drone drains this in the optimize
// phase. Keyed by the source signature, so asking twice queues once.
const queued = new Map<string, string>()

export const queueDoctrineRecord = (source: string, codex: string): void => {
  if (SIG.test(source) && codex) queued.set(source, codex)
}

/** Take everything queued (the drone's one door). */
export const takeQueuedDoctrineRecords = (): [string, string][] => {
  const out = [...queued]
  queued.clear()
  return out
}
