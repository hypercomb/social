// diamondcoreprocessor.com/sharing/push-queue.service.ts
//
// Queue-with-receipts for mirroring local sigs up to DCP. Two reasons
// to push, one mechanism:
//
//   1. Latent backup — every local sig should also live in DCP so
//      any device/lineage can restore from sig later.
//   2. Branch readiness — /save (later) creates a branch label →
//      merkle root sig. Every leaf in that root must have been
//      received by DCP, otherwise published branches dereference
//      into nothing for peers. /save gates on hasReceipt().
//
// On-disk shape: two POOLS OF MEANING at the OPFS root — dirs named by
// sign(meaning), sha256 of the UTF-8 meaning bytes, the same derivation
// Store uses (no typed __folders__, ever):
//
//   sign('push')/{sig}.{kind}  ← queued bytes. Filename encodes both
//                                the sig and the kind (layer | bee |
//                                dependency | resource). Content is
//                                the actual bytes — drain reads the
//                                file, posts to sentinel, no separate
//                                byte lookup needed. mtime is enqueue
//                                time, so the queue is naturally FIFO.
//
//   sign('receipts')/{sig}     ← receipt. File existence = "DCP has
//                                confirmed this sig." Empty for the
//                                scaffolding pass; a future revision can
//                                store DCP-signed acknowledgement bytes
//                                here for cryptographic audit without
//                                changing the gate semantics (existence
//                                stays the boolean).
//
// NOTE two deliberate deviations from content-addressed pool shape:
// queue entries carry the kind in the NAME (`{sig}.{kind}`), and
// receipts are EMPTY files named by the TARGET sig — the name is a
// foreign sig, the content is not its preimage. Any generic pool
// sweeper must never hash-verify these two pools.
//
// LEGACY: `__push__/queue/` and `__receipts__/` are the pre-pool
// locations. They are read-fallback/drain sources ONLY — opened
// without create, unioned into reads while they exist, and absorbed
// into the pools by the self-cleaning drain (#absorbLegacy: per-entry
// copy→remove, gated non-recursive removeEntry once fully drained).
// Receipts are the only "DCP already holds this" ledger — losing one
// re-PUTs its sig on every drain — so nothing is removed before its
// copy is confirmed in the pool.
//
// Lifecycle of a sig:
//
//   enqueue(sig)
//     → write sign('push')/{sig}.{kind}
//     → kick drain() in background
//
//   drain()  (no-reentry guarded; loops until queue is empty so
//            entries enqueued mid-drain are picked up in the same run)
//     · absorb any legacy dirs into the pools (single-flighted with
//       the queue ops by the same guard)
//     · for each queued sig:
//         - if receipt already held: drop the queue entry, skip
//         - else: push (STUB in scaffolding: synthesize receipt
//           locally) → on success write receipt + drop queue entry
//         - on failure: leave queue entry, next drain retries
//
//   hasReceipt(sig) → boolean. Used by /save and the migrator.
//   isPending(sig)  → in queue but no receipt yet.
//   pending()       → all unreceipted queued sigs in mtime order.
//
// Why this shape:
//   - Crash-safe by construction. Queue lives on OPFS; nothing is in
//     volatile memory. A reload picks up exactly where it stopped.
//   - Idempotent. Sig is the filename, so repeated enqueues collapse.
//     Re-pushing an already-receipted sig is a no-op (drain skips).
//   - Mechanical. No content inspection on read — filename shape
//     (64-hex sig) IS the type. Same convention as the bag layout.
//   - Receipt is an atomic file create. Either it exists or it
//     doesn't; no half-states. Branch readiness is a directory probe.
//
// What is intentionally NOT here yet:
//   - BranchService / Save. That layer reads hasReceipt(); building
//     it next is straightforward now that the transport exists.

import { EffectBus, registerPoolMeaning } from '@hypercomb/core'

export type IntakeKind = 'layer' | 'bee' | 'dependency' | 'resource'

type SentinelBridgeLike = {
  intake?: (sig: string, kind: IntakeKind, bytes: ArrayBuffer) => Promise<boolean>
}

type QueueEntry = {
  sig: string
  kind: IntakeKind
  fileName: string
  mtime: number
  dir: FileSystemDirectoryHandle
}

export class PushQueueService extends EventTarget {

  static readonly #PUSH_MEANING = 'push'
  static readonly #RECEIPTS_MEANING = 'receipts'
  // Legacy drain sources — pre-pool dirs. Opened WITHOUT create (a
  // drained dir stays gone); read/absorb only, never written.
  static readonly #LEGACY_PUSH_DIR = '__push__'
  static readonly #LEGACY_QUEUE_SUBDIR = 'queue'
  static readonly #LEGACY_RECEIPTS_DIR = '__receipts__'
  static readonly #SIG_RE = /^[a-f0-9]{64}$/
  static readonly #ENTRY_RE = /^([a-f0-9]{64})\.(layer|bee|dependency|resource)$/

  /** sign(meaning) → pool address, memoized, via the core POOL REGISTRY.
   *  Deriving the address REGISTERS the meaning, so anything that walks
   *  the OPFS root can tell this pool apart from a lineage sigbag (they
   *  share one flat namespace, and a bare-word meaning hashes to the same
   *  address as a same-named root tile). Never re-derive locally. */
  static #poolSignature = (meaning: string): Promise<string> => registerPoolMeaning(meaning)

  #draining = false
  /** True once both legacy dirs are confirmed gone — skips the absorb
   *  probe on subsequent drains. */
  #legacyDrained = false

  constructor() {
    super()
    // Auto-enqueue any content written to OPFS. Store (in shared) and
    // HistoryService (in essentials) both emit `content:wrote` after a
    // successful write. Going through EffectBus keeps shared from
    // having to import this service, respecting the
    // shared-cannot-import-essentials boundary.
    EffectBus.on<{ sig: string; kind: IntakeKind; bytes: ArrayBuffer }>(
      'content:wrote',
      ({ sig, kind, bytes }) => { void this.enqueue(sig, kind, bytes) }
    )
  }

  // -------------------------------------------------
  // public API
  // -------------------------------------------------

  /**
   * Mark a sig as needing to land in DCP. Idempotent — the queue is
   * keyed by `{sig}.{kind}`, so repeat calls for the same sig+kind
   * collapse into one entry. Skips the enqueue entirely if a receipt
   * already exists (nothing to push). Writes the actual bytes to the
   * queue file so drain has everything it needs without a separate
   * byte lookup. Fires drain() in the background; callers don't await
   * the network.
   */
  public readonly enqueue = async (sig: string, kind: IntakeKind, bytes: ArrayBuffer): Promise<void> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return
    if (await this.hasReceipt(sig)) return
    const queueDir = await this.#getQueueDir(true)
    if (!queueDir) return   // store not initialized yet — silent no-op
    try {
      const handle = await queueDir.getFileHandle(`${sig}.${kind}`, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort — next enqueue or drain will retry */ }
    void this.drain()
  }

  /**
   * Process the queue. Single-flight via #draining; a concurrent
   * drain() returns immediately. The in-flight drain re-lists the
   * queue every loop, so anything enqueued during the run is picked
   * up without a separate drain() call. The legacy absorb runs under
   * the same guard, so it can never race the queue removals it would
   * otherwise be copying out from under.
   */
  public readonly drain = async (): Promise<void> => {
    if (this.#draining) return
    this.#draining = true
    try {
      await this.#absorbLegacy()
      for (;;) {
        const entries = await this.#listQueue()
        if (entries.length === 0) break

        for (const entry of entries) {
          if (await this.hasReceipt(entry.sig)) {
            // Already pushed in a prior session — drop the stale
            // queue entry without re-pushing.
            await this.#removeQueueEntry(entry)
            continue
          }
          const ok = await this.#pushAndReceipt(entry)
          if (!ok) continue   // leave the entry; retry on next drain
          await this.#removeQueueEntry(entry)
          this.dispatchEvent(new CustomEvent('receipt', { detail: { sig: entry.sig } }))
          EffectBus.emit('push:receipt', { sig: entry.sig })
        }
      }
    } finally {
      this.#draining = false
    }
  }

  /**
   * True iff a receipt file exists for this sig. Branch creation
   * gates on this for every leaf in the merkle root. Dual-read: the
   * sign('receipts') pool first, then the legacy `__receipts__` drain
   * source while it still exists — an empty pool must never read as
   * "nothing receipted" mid-migration (that would re-PUT everything).
   */
  public readonly hasReceipt = async (sig: string): Promise<boolean> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return false
    for (const dir of [
      await this.#getReceiptsDir(false),
      await this.#getLegacyReceiptsDir(),
    ]) {
      if (!dir) continue
      try {
        await dir.getFileHandle(sig, { create: false })
        return true
      } catch { /* not in this source */ }
    }
    return false
  }

  /**
   * True iff the sig is queued and not yet receipted. A queued entry
   * lives at `{sig}.{kind}` for some kind, so probe by listing the
   * queue rather than building the filename — kind is not part of
   * the public sig identity.
   */
  public readonly isPending = async (sig: string): Promise<boolean> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return false
    if (await this.hasReceipt(sig)) return false
    const entries = await this.#listQueue()
    return entries.some(e => e.sig === sig)
  }

  /**
   * All currently pending sigs (queued, no receipt yet), ordered by
   * enqueue time. /save can call this to wait until pending() is
   * empty before stamping the branch.
   */
  public readonly pending = async (): Promise<string[]> => {
    const queue = await this.#listQueue()
    const out: string[] = []
    for (const entry of queue) {
      if (!(await this.hasReceipt(entry.sig))) out.push(entry.sig)
    }
    return out
  }

  // -------------------------------------------------
  // internal — directory resolution
  // -------------------------------------------------

  readonly #getPool = async (meaning: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      return await root.getDirectoryHandle(await PushQueueService.#poolSignature(meaning), { create })
    } catch { return null }
  }

  readonly #getQueueDir = (create: boolean): Promise<FileSystemDirectoryHandle | null> =>
    this.#getPool(PushQueueService.#PUSH_MEANING, create)

  readonly #getReceiptsDir = (create: boolean): Promise<FileSystemDirectoryHandle | null> =>
    this.#getPool(PushQueueService.#RECEIPTS_MEANING, create)

  /** Legacy `__push__/queue/` — drain source, opened without create. */
  readonly #getLegacyQueueDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      const push = await root.getDirectoryHandle(PushQueueService.#LEGACY_PUSH_DIR, { create: false })
      return await push.getDirectoryHandle(PushQueueService.#LEGACY_QUEUE_SUBDIR, { create: false })
    } catch { return null }
  }

  /** Legacy `__receipts__/` — drain source, opened without create. */
  readonly #getLegacyReceiptsDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      return await root.getDirectoryHandle(PushQueueService.#LEGACY_RECEIPTS_DIR, { create: false })
    } catch { return null }
  }

  readonly #getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = get<{ opfsRoot?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store?.opfsRoot ?? null
  }

  // -------------------------------------------------
  // internal — self-cleaning legacy absorb
  // -------------------------------------------------

  /** Drain the legacy `__push__/queue/` and `__receipts__/` dirs into
   *  their sign(meaning) pools, then remove the emptied dirs. Runs
   *  under drain()'s single-flight guard. Per-entry copy→remove; the
   *  final removeEntry calls are non-recursive ON PURPOSE — they only
   *  succeed once a dir is truly empty, so a straggler (or an
   *  unexpected entry) is never destroyed. Nothing is removed before
   *  its copy is confirmed in the pool; an interrupted absorb simply
   *  resumes on a later drain, with dual-reads correct meanwhile. */
  readonly #absorbLegacy = async (): Promise<void> => {
    if (this.#legacyDrained) return
    const root = await this.#getOpfsRoot()
    if (!root) return
    let clean = true

    const legacyQueue = await this.#getLegacyQueueDir()
    if (legacyQueue) {
      const pool = await this.#getQueueDir(true)
      if (!pool) return
      let ok = await this.#absorbDir(legacyQueue, pool)
      if (ok) {
        try {
          const legacyPush = await root.getDirectoryHandle(PushQueueService.#LEGACY_PUSH_DIR, { create: false })
          await legacyPush.removeEntry(PushQueueService.#LEGACY_QUEUE_SUBDIR)
          await root.removeEntry(PushQueueService.#LEGACY_PUSH_DIR)
        } catch { ok = false }
      }
      clean = ok && clean
    }

    const legacyReceipts = await this.#getLegacyReceiptsDir()
    if (legacyReceipts) {
      const pool = await this.#getReceiptsDir(true)
      if (!pool) return
      let ok = await this.#absorbDir(legacyReceipts, pool)
      if (ok) {
        try { await root.removeEntry(PushQueueService.#LEGACY_RECEIPTS_DIR) } catch { ok = false }
      }
      clean = ok && clean
    }

    this.#legacyDrained = clean
  }

  /** Copy every plain file from `legacy` into `pool` (an existing pool
   *  entry wins — same-name means same record here: queue bytes are
   *  sig-addressed, receipts are presence-only), removing each source
   *  entry only after its copy is confirmed present. Returns true iff
   *  the source dir ended fully drained. */
  readonly #absorbDir = async (
    legacy: FileSystemDirectoryHandle,
    pool: FileSystemDirectoryHandle,
  ): Promise<boolean> => {
    let drained = true
    try {
      for await (const [name, handle] of (legacy as any).entries()) {
        if (handle.kind !== 'file') { drained = false; continue }
        try {
          let present = true
          try { await pool.getFileHandle(name, { create: false }) } catch { present = false }
          if (!present) {
            const file = await (handle as FileSystemFileHandle).getFile()
            const dest = await pool.getFileHandle(name, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(await file.arrayBuffer()) } finally { await writable.close() }
          }
          await legacy.removeEntry(name)
        } catch { drained = false /* straggler — absorbed on a later drain */ }
      }
    } catch { drained = false }
    return drained
  }

  // -------------------------------------------------
  // internal — queue ops
  // -------------------------------------------------

  /** List queued entries: the sign('push') pool UNIONED with the
   *  legacy queue while that drain source still exists (an entry must
   *  never vanish from view mid-migration). Each entry carries the dir
   *  it lives in so removal/read target the right source; on a
   *  same-name collision the pool copy wins. */
  readonly #listQueue = async (): Promise<QueueEntry[]> => {
    const byName = new Map<string, QueueEntry>()
    const collect = async (dir: FileSystemDirectoryHandle | null): Promise<void> => {
      if (!dir) return
      try {
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind !== 'file') continue
          const m = name.match(PushQueueService.#ENTRY_RE)
          if (!m || byName.has(name)) continue
          try {
            const file = await (handle as FileSystemFileHandle).getFile()
            byName.set(name, { sig: m[1], kind: m[2] as IntakeKind, fileName: name, mtime: file.lastModified, dir })
          } catch { /* skip unreadable */ }
        }
      } catch { /* dir vanished mid-walk (absorb finished) — pool has it */ }
    }
    await collect(await this.#getQueueDir(false))
    await collect(await this.#getLegacyQueueDir())
    const items = [...byName.values()]
    items.sort((a, b) => a.mtime - b.mtime)
    return items
  }

  readonly #removeQueueEntry = async (entry: QueueEntry): Promise<void> => {
    try {
      await entry.dir.removeEntry(entry.fileName)
    } catch { /* already gone */ }
  }

  /**
   * Read the queued bytes, post to the DCP sentinel intake. On ack
   * write the receipt (into the sign('receipts') pool — never the
   * legacy dir) and return true so the queue entry can be dropped. On
   * nack/timeout/missing-bridge return false — drain leaves the queue
   * entry in place for the next run.
   */
  readonly #pushAndReceipt = async (entry: QueueEntry): Promise<boolean> => {
    const bridge = (globalThis as any).__sentinelBridge as SentinelBridgeLike | undefined
    if (!bridge?.intake) return false   // sentinel not up yet; retry later

    let bytes: ArrayBuffer
    try {
      const handle = await entry.dir.getFileHandle(entry.fileName, { create: false })
      const file = await handle.getFile()
      bytes = await file.arrayBuffer()
    } catch { return false }

    const ok = await bridge.intake(entry.sig, entry.kind, bytes)
    if (!ok) return false

    try {
      const receiptsDir = await this.#getReceiptsDir(true)
      if (!receiptsDir) return false
      const handle = await receiptsDir.getFileHandle(entry.sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      return true
    } catch { return false }
  }
}

const _pushQueueService = new PushQueueService()
window.ioc.register('@diamondcoreprocessor.com/PushQueueService', _pushQueueService)

// On boot, drain any queue entries left from a prior session. Safe
// because drain() is single-flight and idempotent under crash recovery.
void _pushQueueService.drain()

// Delayed self-clean kick: the boot drain above usually fires before
// Store has resolved its OPFS root (module-load order), silently
// no-oping. Re-run once the shell has settled so the legacy
// `__push__`/`__receipts__` absorb happens even in a session that
// never writes new content. Mirrors Store's detached+delayed content
// self-clean (clear of first paint and the warmup walk).
setTimeout(() => { void _pushQueueService.drain() }, 20_000)
