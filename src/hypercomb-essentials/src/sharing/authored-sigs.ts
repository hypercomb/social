// sharing/authored-sigs.ts
//
// Participant-local registry of page/feature signatures the participant
// AUTHORED locally — the "own content" allow-set for the verification gate.
//
// Part of the per-signature gate redesign (see feature-availability.ts). The
// gate must fail CLOSED: an adopted page activates only if it is authored-by-
// you, verified (reviewed-and-accepted), or from a trusted domain. Provenance
// is keyed PER SIGNATURE, not by tree position — a page you authored is yours
// even when it sits under a subtree you once adopted, which the removed
// `isWithinAdoptedRoot` path-prefix heuristic could not express (it prefix-
// matched the adopted root AND every descendant, so it quarantined your own
// pages under a branch you'd adopted).
//
// Participant-local — never in any lineage, same principle as adopted-roots /
// viewport / feature-verified / feature-staging. localStorage is the SYNC read
// cache (the gate reads synchronously); the durable truth is the
// `sign('authored')` pool of meaning — one empty marker file per sig, a ledger
// pool like receipts (skip hash-verify). Writes mirror to both; the bootstrap
// worker reconciles them (a localStorage clear no longer loses authorship).
// Durability matters beyond the gate: resource offload eligibility is
// authored ∧ public (documentation/resource-offload-relays.md).
//
// ── STATUS: LIVE ──────────────────────────────────────────────────────────
// Producers (RECORD ON WRITE, and only on a write): a signature is marked
// where this hive wrote its bytes — the website, howto and tile-file writers,
// a page made from one of yours (page-commit.ts commitPageSigFrom), the
// participant's own console (website.queen.ts writeOwnPage), and the bridge for
// the bytes IT put (claude-bridge.worker.ts). NAMING A SIGNATURE NEVER MARKS IT
// (2026-11-28, inline-code-in-input-audit.md M1): `website page <sig>`,
// `/lounge here <sig>` and a bridge request naming bytes it did not put dress
// the tile and leave the bytes what they were. A typed signature can arrive
// from anywhere (`changes accept` types received sentences through the
// participant's own door), and a held page from a peer would have run as this
// hive. The grandfathering walk is retired (authored-bootstrap.worker.ts).
// `featureNeedsReview` consults `isLocallyAuthored` as the per-sig rescue for
// your own pages under adopted roots.

const KEY = 'hc:authored-sigs'
const SIG_RE = /^[a-f0-9]{64}$/

const AUTHORED_MEANING = 'authored'

/** Best-effort durable mirror: one empty marker file per sig in the
 *  sign('authored') pool. Fire-and-forget — localStorage stays the sync
 *  source for reads; the pool survives localStorage clears. */
function syncToPool(sigs: readonly string[]): void {
  if (sigs.length === 0) return
  void (async () => {
    try {
      const store = (globalThis as any).ioc?.get('@hypercomb.social/Store') as
        | { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }
        | undefined
      const pool = await store?.getPool?.(AUTHORED_MEANING)
      if (!pool) return
      for (const sig of sigs) {
        try { await pool.getFileHandle(sig, { create: true }) } catch { /* best effort */ }
      }
    } catch { /* Store not up yet — bootstrap reconcile covers it */ }
  })()
}

/** Two-way reconcile between the sign('authored') pool (durable) and the
 *  localStorage cache (sync reads). Pool-only sigs hydrate the cache;
 *  cache-only sigs backfill the pool. Returns the reconciled set size. */
export async function reconcileAuthoredPool(): Promise<number> {
  const store = (globalThis as any).ioc?.get('@hypercomb.social/Store') as
    | { getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null> }
    | undefined
  const pool = await store?.getPool?.(AUTHORED_MEANING)
  if (!pool) return read().size
  const inPool = new Set<string>()
  try {
    for await (const [name, handle] of pool as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (handle.kind === 'file' && SIG_RE.test(name)) inPool.add(name)
    }
  } catch { /* unreadable pool — treat as empty */ }
  const cached = read()
  const merged = new Set([...cached, ...inPool])
  if (merged.size > cached.size) {
    try { localStorage.setItem(KEY, JSON.stringify([...merged])) } catch { /* quota — best effort */ }
  }
  const missing = [...cached].filter(s => !inPool.has(s))
  syncToPool(missing)
  return merged.size
}

function read(): Set<string> {
  const out = new Set<string>()
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (Array.isArray(arr)) {
      for (const s of arr) {
        const v = String(s ?? '').trim().toLowerCase()
        if (SIG_RE.test(v)) out.add(v)
      }
    }
  } catch { /* malformed / no storage — nothing authored */ }
  return out
}

/** Record a page/feature signature as authored by this participant. Idempotent;
 *  non-sig inputs are ignored. */
export function markAuthored(sig: unknown): void {
  const s = String(sig ?? '').trim().toLowerCase()
  if (!SIG_RE.test(s)) return
  const set = read()
  if (set.has(s)) return
  set.add(s)
  try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch { /* quota — best effort */ }
  syncToPool([s])
}

/** Record several signatures at once (the bootstrap walk's entry point). */
export function markManyAuthored(sigs: Iterable<unknown>): void {
  const set = read()
  const added: string[] = []
  for (const raw of sigs) {
    const s = String(raw ?? '').trim().toLowerCase()
    if (SIG_RE.test(s) && !set.has(s)) { set.add(s); added.push(s) }
  }
  if (added.length > 0) {
    try { localStorage.setItem(KEY, JSON.stringify([...set])) } catch { /* quota — best effort */ }
    syncToPool(added)
  }
}

/** Is this signature in the participant's authored allow-set? */
export function isAuthored(sig: unknown): boolean {
  const s = String(sig ?? '').trim().toLowerCase()
  return SIG_RE.test(s) && read().has(s)
}

/** The full authored set (for the future gate reader / diagnostics). */
export function authoredSigs(): Set<string> {
  return read()
}

/** Record the page signatures a layer write carries THAT THE WRITER PUT. The
 *  `website` and `context` slots hold page/resource sigs DIRECTLY — the two
 *  slots the verification gate resolves a page from (alongside the decoration
 *  path, which records its htmlSig separately). The bridge's slot writers
 *  (#update / #bagSet / #bagMutate) call this with the bytes they put
 *  themselves (`written`): a slot also names pages the request only points at —
 *  a peer's page among them — and pointing at a page never makes it yours (M1,
 *  2026-11-28). Marking a non-page context resource is inert — a sig only ever
 *  gates when it IS the resolved page sig, and a resource you never render as
 *  a page is never checked. */
export function markLayerAuthoredPageSigs(layer: unknown, written: ReadonlySet<string>): void {
  if (!layer || typeof layer !== 'object') return
  const l = layer as Record<string, unknown>
  for (const slot of ['website', 'context']) {
    const v = l[slot]
    if (Array.isArray(v)) markManyAuthored(v.filter(s => written.has(String(s ?? '').trim().toLowerCase())))
  }
}
