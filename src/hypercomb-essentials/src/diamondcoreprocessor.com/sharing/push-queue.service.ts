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
// On-disk shape (top-level OPFS):
//
//   __push__/queue/{sig}    ← intent file. Empty content; sig is the
//                             filename. mtime is enqueue time, so the
//                             queue is naturally FIFO without an index.
//
//   __receipts__/{sig}      ← receipt. File existence = "DCP has
//                             confirmed this sig." Empty for the
//                             scaffolding pass; a future revision can
//                             store DCP-signed acknowledgement bytes
//                             here for cryptographic audit without
//                             changing the gate semantics (existence
//                             stays the boolean).
//
// Lifecycle of a sig:
//
//   enqueue(sig)
//     → write __push__/queue/{sig}
//     → kick drain() in background
//
//   drain()  (no-reentry guarded; loops until queue is empty so
//            entries enqueued mid-drain are picked up in the same run)
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
//   - Real DCP intake transport. The stub writes the receipt locally
//     so the gate logic is end-to-end exercisable; swapping it for
//     a real POST + signed receipt is a single private method change.
//   - BranchService / Save. That layer reads hasReceipt(); building
//     it next is straightforward once a transport exists.

import { EffectBus } from '@hypercomb/core'

export class PushQueueService extends EventTarget {

  static readonly #PUSH_DIR = '__push__'
  static readonly #QUEUE_SUBDIR = 'queue'
  static readonly #RECEIPTS_DIR = '__receipts__'
  static readonly #SIG_RE = /^[a-f0-9]{64}$/

  #draining = false

  // -------------------------------------------------
  // public API
  // -------------------------------------------------

  /**
   * Mark a sig as needing to land in DCP. Idempotent — the queue is
   * keyed by sig, so repeat calls collapse into one entry. Skips the
   * enqueue entirely if a receipt already exists (nothing to push).
   * Fires drain() in the background; callers don't await the network.
   */
  public readonly enqueue = async (sig: string): Promise<void> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return
    if (await this.hasReceipt(sig)) return
    const queueDir = await this.#getQueueDir()
    try {
      const handle = await queueDir.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
    } catch { /* best-effort — next enqueue or drain will retry */ }
    void this.drain()
  }

  /**
   * Process the queue. Single-flight via #draining; a concurrent
   * drain() returns immediately. The in-flight drain re-lists the
   * queue every loop, so anything enqueued during the run is picked
   * up without a separate drain() call.
   */
  public readonly drain = async (): Promise<void> => {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const sigs = await this.#listQueue()
        if (sigs.length === 0) break

        for (const sig of sigs) {
          if (await this.hasReceipt(sig)) {
            // Already pushed in a prior session — drop the stale
            // queue entry without re-pushing.
            await this.#removeQueueEntry(sig)
            continue
          }
          const ok = await this.#stubPushAndReceipt(sig)
          if (!ok) continue   // leave the entry; retry on next drain
          await this.#removeQueueEntry(sig)
          this.dispatchEvent(new CustomEvent('receipt', { detail: { sig } }))
          EffectBus.emit('push:receipt', { sig })
        }
      }
    } finally {
      this.#draining = false
    }
  }

  /**
   * True iff a receipt file exists for this sig. Branch creation
   * gates on this for every leaf in the merkle root.
   */
  public readonly hasReceipt = async (sig: string): Promise<boolean> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return false
    try {
      const dir = await this.#getReceiptsDir()
      await dir.getFileHandle(sig, { create: false })
      return true
    } catch { return false }
  }

  /**
   * True iff the sig is queued and not yet receipted.
   */
  public readonly isPending = async (sig: string): Promise<boolean> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return false
    if (await this.hasReceipt(sig)) return false
    try {
      const dir = await this.#getQueueDir()
      await dir.getFileHandle(sig, { create: false })
      return true
    } catch { return false }
  }

  /**
   * All currently pending sigs (queued, no receipt yet), ordered by
   * enqueue time. /save can call this to wait until pending() is
   * empty before stamping the branch.
   */
  public readonly pending = async (): Promise<string[]> => {
    const queue = await this.#listQueue()
    const out: string[] = []
    for (const sig of queue) {
      if (!(await this.hasReceipt(sig))) out.push(sig)
    }
    return out
  }

  // -------------------------------------------------
  // internal — directory resolution
  // -------------------------------------------------

  readonly #getQueueDir = async (): Promise<FileSystemDirectoryHandle> => {
    const root = await this.#getOpfsRoot()
    const push = await root.getDirectoryHandle(PushQueueService.#PUSH_DIR, { create: true })
    return await push.getDirectoryHandle(PushQueueService.#QUEUE_SUBDIR, { create: true })
  }

  readonly #getReceiptsDir = async (): Promise<FileSystemDirectoryHandle> => {
    const root = await this.#getOpfsRoot()
    return await root.getDirectoryHandle(PushQueueService.#RECEIPTS_DIR, { create: true })
  }

  readonly #getOpfsRoot = async (): Promise<FileSystemDirectoryHandle> => {
    const store = get<{ opfsRoot: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    if (!store?.opfsRoot) throw new Error('PushQueueService: Store not initialized')
    return store.opfsRoot
  }

  // -------------------------------------------------
  // internal — queue ops
  // -------------------------------------------------

  readonly #listQueue = async (): Promise<string[]> => {
    const dir = await this.#getQueueDir()
    const items: Array<{ sig: string; mtime: number }> = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'file') continue
      if (!PushQueueService.#SIG_RE.test(name)) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        items.push({ sig: name, mtime: file.lastModified })
      } catch { /* skip unreadable */ }
    }
    items.sort((a, b) => a.mtime - b.mtime)
    return items.map(i => i.sig)
  }

  readonly #removeQueueEntry = async (sig: string): Promise<void> => {
    try {
      const dir = await this.#getQueueDir()
      await dir.removeEntry(sig)
    } catch { /* already gone */ }
  }

  /**
   * Scaffolding stub. Real implementation:
   *   - Resolve sig bytes (Store.getResource — bag file or __layers__/)
   *   - POST to DCP intake endpoint
   *   - Await DCP-signed receipt blob
   *   - Write receipt bytes to __receipts__/{sig}
   *
   * Until the transport exists, write an empty receipt locally so the
   * gate logic (hasReceipt → branch readiness) is exercisable end to
   * end. Swapping the stub for a real push is a single-method change;
   * the public API and on-disk shape are stable.
   */
  readonly #stubPushAndReceipt = async (sig: string): Promise<boolean> => {
    try {
      const dir = await this.#getReceiptsDir()
      const handle = await dir.getFileHandle(sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      return true
    } catch { return false }
  }
}

const _pushQueueService = new PushQueueService()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/PushQueueService', _pushQueueService)

// On boot, drain any queue entries left from a prior session. Safe
// because drain() is single-flight and idempotent under crash recovery.
void _pushQueueService.drain()
