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
//   __push__/queue/{sig}.{kind}  ← queued bytes. Filename encodes both
//                                  the sig and the kind (layer | bee |
//                                  dependency | resource), matching the
//                                  canonical bag convention. Content is
//                                  the actual bytes — drain reads the
//                                  file, posts to sentinel, no separate
//                                  byte lookup needed. mtime is enqueue
//                                  time, so the queue is naturally FIFO.
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
//   - BranchService / Save. That layer reads hasReceipt(); building
//     it next is straightforward now that the transport exists.

import { EffectBus } from '@hypercomb/core'

export type IntakeKind = 'layer' | 'bee' | 'dependency' | 'resource'

type SentinelBridgeLike = {
  intake?: (sig: string, kind: IntakeKind, bytes: ArrayBuffer) => Promise<boolean>
}

export class PushQueueService extends EventTarget {

  static readonly #PUSH_DIR = '__push__'
  static readonly #QUEUE_SUBDIR = 'queue'
  static readonly #RECEIPTS_DIR = '__receipts__'
  static readonly #SIG_RE = /^[a-f0-9]{64}$/
  static readonly #ENTRY_RE = /^([a-f0-9]{64})\.(layer|bee|dependency|resource)$/

  #draining = false

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
    const queueDir = await this.#getQueueDir()
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
   * up without a separate drain() call.
   */
  public readonly drain = async (): Promise<void> => {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const entries = await this.#listQueue()
        if (entries.length === 0) break

        for (const entry of entries) {
          if (await this.hasReceipt(entry.sig)) {
            // Already pushed in a prior session — drop the stale
            // queue entry without re-pushing.
            await this.#removeQueueEntry(entry.fileName)
            continue
          }
          const ok = await this.#pushAndReceipt(entry)
          if (!ok) continue   // leave the entry; retry on next drain
          await this.#removeQueueEntry(entry.fileName)
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
   * gates on this for every leaf in the merkle root.
   */
  public readonly hasReceipt = async (sig: string): Promise<boolean> => {
    if (!PushQueueService.#SIG_RE.test(sig)) return false
    try {
      const dir = await this.#getReceiptsDir()
      if (!dir) return false
      await dir.getFileHandle(sig, { create: false })
      return true
    } catch { return false }
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

  readonly #getQueueDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    const push = await root.getDirectoryHandle(PushQueueService.#PUSH_DIR, { create: true })
    return await push.getDirectoryHandle(PushQueueService.#QUEUE_SUBDIR, { create: true })
  }

  readonly #getReceiptsDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    return await root.getDirectoryHandle(PushQueueService.#RECEIPTS_DIR, { create: true })
  }

  readonly #getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = get<{ opfsRoot?: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store?.opfsRoot ?? null
  }

  // -------------------------------------------------
  // internal — queue ops
  // -------------------------------------------------

  readonly #listQueue = async (): Promise<Array<{ sig: string; kind: IntakeKind; fileName: string; mtime: number }>> => {
    const dir = await this.#getQueueDir()
    if (!dir) return []
    const items: Array<{ sig: string; kind: IntakeKind; fileName: string; mtime: number }> = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'file') continue
      const m = name.match(PushQueueService.#ENTRY_RE)
      if (!m) continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        items.push({ sig: m[1], kind: m[2] as IntakeKind, fileName: name, mtime: file.lastModified })
      } catch { /* skip unreadable */ }
    }
    items.sort((a, b) => a.mtime - b.mtime)
    return items
  }

  readonly #removeQueueEntry = async (fileName: string): Promise<void> => {
    try {
      const dir = await this.#getQueueDir()
      if (!dir) return
      await dir.removeEntry(fileName)
    } catch { /* already gone */ }
  }

  /**
   * Read the queued bytes, post to the DCP sentinel intake. On ack
   * write the receipt and return true so the queue entry can be
   * dropped. On nack/timeout/missing-bridge return false — drain
   * leaves the queue entry in place for the next run.
   */
  readonly #pushAndReceipt = async (entry: { sig: string; kind: IntakeKind; fileName: string }): Promise<boolean> => {
    const bridge = (globalThis as any).__sentinelBridge as SentinelBridgeLike | undefined
    if (!bridge?.intake) return false   // sentinel not up yet; retry later

    let bytes: ArrayBuffer
    try {
      const dir = await this.#getQueueDir()
      if (!dir) return false
      const handle = await dir.getFileHandle(entry.fileName, { create: false })
      const file = await handle.getFile()
      bytes = await file.arrayBuffer()
    } catch { return false }

    const ok = await bridge.intake(entry.sig, entry.kind, bytes)
    if (!ok) return false

    try {
      const receiptsDir = await this.#getReceiptsDir()
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
