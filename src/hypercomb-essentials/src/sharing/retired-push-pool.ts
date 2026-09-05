// sharing/retired-push-pool.ts
//
// THE COLLECTOR FOR A RETIRED CHANNEL.
//
// `PushQueueService` was the DCP installer's push channel: it subscribed to
// `content:wrote` with no gate at all and wrote a FULL BYTE COPY of every
// committed sig into `sign('push')/{sig}.{kind}`, to be drained up to the
// installer's sentinel iframe. That transport was deleted with the installer
// on 2026-08-30 (`fc3696c3b`) — `globalThis.__sentinelBridge` has had no
// assigner since — so the drain half never ran again and the write half never
// stopped. Every commit duplicated its own bytes on disk, permanently, and
// nothing anywhere read, pruned or collected the result.
//
// The service is gone (see `documentation/write-conformance.md` check 10).
// What it left behind is not: a participant who has been committing since
// that date is carrying a second copy of their content. This module is the
// one-time collector for it, and nothing else — it never writes content, it
// never touches the network, and it can only ever REMOVE a duplicate whose
// canonical copy it has confirmed first.
//
// WHY NOT JUST DELETE THE DIRECTORY. The queue file is a byte copy of content
// that lives at its canonical address, so removing it is a no-op for the
// participant — but only where the canonical copy is actually there. A sig
// whose root entry has since been collected has its ONLY surviving bytes in
// this pool. So the shape is the same per-entry copy->verify->remove contract
// every other self-clean in the tree uses (`Store.migrateContentPoolToRoot`,
// `HostSyncService`'s legacy absorb), minus the copy: confirm the canonical
// entry holds the same number of bytes, then remove the duplicate. A miss is
// KEPT and counted, never destroyed. Doctrine: user data is never wiped
// (`documentation/write-conformance.md`, and the OPFS zone rules in
// `CLAUDE.md`) — an unverifiable entry is user data.
//
// WHY THE PROBE IS DIRECT AND NOT A Store READ. Every content read on Store
// (`getLayerLocalBytes`, `getResourceLocal`, `getLayerPoolBytes`) calls
// `#stageToHost` on the way out — reading a sig ENQUEUES it for the host-push
// channel. A collector built on those calls would publish every sig it swept
// while cleaning up a bug about publishing without a gesture. It probes the
// directory handles itself. In packed mode `opfsRoot` is the pack's virtual
// root, so the same probe answers there.
//
// The receipts pool is collected on the same pass. A receipt is an EMPTY file
// named by a target sig, meaning "DCP has confirmed this" — a claim about a
// service that no longer exists, carrying no bytes of its own. Empty markers
// are removed; anything with content in it is left alone and counted, because
// a non-empty receipt is not the file this collector knows about.
//
// The four sources — both pools and both pre-pool legacy dirs — are removed
// with a NON-RECURSIVE `removeEntry` once, and only once, they are actually
// empty. A straggler keeps its directory. An interrupted pass resumes on the
// next boot; the pass is idempotent, and once the sources are gone it costs
// two failed `getDirectoryHandle` probes and stops scheduling itself.
//
// `push` and `receipts` STAY registered in `BARE_WORD_POOL_MEANINGS`
// (hypercomb-core/src/core/pool-registry.ts). The registry is what stops a
// root walker mistaking a sig-named pool dir for a lineage sigbag and pruning
// its members, and these dirs are still on disk everywhere the collector has
// not yet run. They may only be dropped from that list once no participant
// can still be carrying one.

import { registerPoolMeaning } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'

/** Meanings of the two retired pools. Addresses are DERIVED through the core
 *  pool registry, never hardcoded — and deriving one registers it. */
export const RETIRED_PUSH_MEANING = 'push'
export const RETIRED_RECEIPTS_MEANING = 'receipts'

/** Pre-pool locations. Drain sources only: opened WITHOUT create. */
const LEGACY_PUSH_DIR = '__push__'
const LEGACY_QUEUE_SUBDIR = 'queue'
const LEGACY_RECEIPTS_DIR = '__receipts__'

const SIG_RE = /^[a-f0-9]{64}$/
/** `{sig}.{kind}` — the queue entry name shape. Character class, not an
 *  escape, so the pattern reads the same in every quoting context. */
const ENTRY_RE = /^([a-f0-9]{64})[.](layer|bee|dependency|resource)$/

type RetiredKind = 'layer' | 'bee' | 'dependency' | 'resource'

export type RetiredPushReport = {
  /** Duplicate queue entries removed after their canonical copy was confirmed. */
  reclaimed: number
  /** Bytes those entries occupied. */
  reclaimedBytes: number
  /** Queue entries KEPT — canonical copy absent or a different size. These
   *  may hold the only surviving bytes for their sig, so they are never
   *  removed; they simply keep their directory alive. */
  kept: number
  /** Empty receipt markers removed. */
  receipts: number
  /** True once all four sources are confirmed gone — the collector has
   *  nothing left to do in this hive. */
  drained: boolean
}

const EMPTY_REPORT: RetiredPushReport = {
  reclaimed: 0, reclaimedBytes: 0, kept: 0, receipts: 0, drained: false,
}

const ioc = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const storeRoot = (): FileSystemDirectoryHandle | null =>
  ioc<{ opfsRoot?: FileSystemDirectoryHandle }>(STORE_KEY)?.opfsRoot ?? null

const poolDir = async (
  root: FileSystemDirectoryHandle,
  meaning: string,
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return await root.getDirectoryHandle(await registerPoolMeaning(meaning), { create: false })
  } catch { return null }
}

const legacyQueueDir = async (
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const push = await root.getDirectoryHandle(LEGACY_PUSH_DIR, { create: false })
    return await push.getDirectoryHandle(LEGACY_QUEUE_SUBDIR, { create: false })
  } catch { return null }
}

const legacyReceiptsDir = async (
  root: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return await root.getDirectoryHandle(LEGACY_RECEIPTS_DIR, { create: false })
  } catch { return null }
}

/** True iff `dir` holds one of `names` at exactly `size` bytes. Size equality
 *  is the verification: the canonical entry is content-addressed and its
 *  writers refuse a name/bytes mismatch, so a same-named entry of the same
 *  length IS the same bytes. A mismatch answers false — and false only ever
 *  means "keep the duplicate". */
const holdsAt = async (
  dir: FileSystemDirectoryHandle | null,
  names: readonly string[],
  size: number,
): Promise<boolean> => {
  if (!dir) return false
  for (const name of names) {
    try {
      const file = await (await dir.getFileHandle(name, { create: false })).getFile()
      if (file.size === size) return true
    } catch { /* not under this name */ }
  }
  return false
}

/** Where the canonical copy of a sig of this kind lives. Layers and resources
 *  are sig-named files at the content root; bees and dependencies live in
 *  their own meaning pools, under either `<sig>` or `<sig>.js`. */
const canonicalHolds = async (
  root: FileSystemDirectoryHandle,
  sig: string,
  kind: RetiredKind,
  size: number,
): Promise<boolean> => {
  if (kind === 'layer' || kind === 'resource') return holdsAt(root, [sig], size)
  const pool = await poolDir(root, kind === 'bee' ? 'bees' : 'dependencies')
  return holdsAt(pool, [sig, `${sig}.js`], size)
}

/** Snapshot a directory listing before touching it. Removing entries from a
 *  handle while async-iterating that same handle is not defined to be safe,
 *  and a skipped entry here means a duplicate that never gets collected. The
 *  listing is names only, so it costs nothing to take it first. Returns null
 *  if the directory could not be read at all. */
const listing = async (
  dir: FileSystemDirectoryHandle,
): Promise<{ names: string[]; onlyFiles: boolean } | null> => {
  const names: string[] = []
  let onlyFiles = true
  try {
    for await (const [name, handle] of (dir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind !== 'file') { onlyFiles = false; continue }
      names.push(name)
    }
  } catch { return null }
  return { names, onlyFiles }
}

/** Sweep one queue source. Returns whether it ended fully empty. */
const collectQueueDir = async (
  root: FileSystemDirectoryHandle,
  dir: FileSystemDirectoryHandle,
  report: RetiredPushReport,
): Promise<boolean> => {
  const found = await listing(dir)
  if (!found) return false
  let emptied = found.onlyFiles
  for (const name of found.names) {
    const match = name.match(ENTRY_RE)
    if (!match) { emptied = false; continue }   // not ours — leave it
    try {
      const file = await (await dir.getFileHandle(name, { create: false })).getFile()
      if (!(await canonicalHolds(root, match[1], match[2] as RetiredKind, file.size))) {
        // The only copy of these bytes, or a copy we cannot vouch for.
        report.kept++
        emptied = false
        continue
      }
      await dir.removeEntry(name)
      report.reclaimed++
      report.reclaimedBytes += file.size
    } catch { emptied = false /* unreadable — a later pass retries */ }
  }
  return emptied
}

/** Sweep one receipts source: empty markers go, anything else stays. */
const collectReceiptsDir = async (
  dir: FileSystemDirectoryHandle,
  report: RetiredPushReport,
): Promise<boolean> => {
  const found = await listing(dir)
  if (!found) return false
  let emptied = found.onlyFiles
  for (const name of found.names) {
    if (!SIG_RE.test(name)) { emptied = false; continue }
    try {
      const file = await (await dir.getFileHandle(name, { create: false })).getFile()
      if (file.size !== 0) { emptied = false; continue }   // not the marker we know
      await dir.removeEntry(name)
      report.receipts++
    } catch { emptied = false }
  }
  return emptied
}

/**
 * Collect the retired `sign('push')` / `sign('receipts')` pools and their
 * pre-pool legacy dirs. Idempotent, resumable, and destructive ONLY of
 * duplicates whose canonical copy was confirmed in the same pass.
 *
 * `root` is injectable for tests; in the shell it comes from Store.
 */
export const collectRetiredPushPool = async (
  root: FileSystemDirectoryHandle | null = storeRoot(),
): Promise<RetiredPushReport> => {
  if (!root) return { ...EMPTY_REPORT }
  const report: RetiredPushReport = { ...EMPTY_REPORT }
  let drained = true

  const pushPool = await poolDir(root, RETIRED_PUSH_MEANING)
  if (pushPool) {
    let emptied = await collectQueueDir(root, pushPool, report)
    if (emptied) {
      try { await root.removeEntry(await registerPoolMeaning(RETIRED_PUSH_MEANING)) } catch { emptied = false }
    }
    drained = emptied && drained
  }

  const legacyQueue = await legacyQueueDir(root)
  if (legacyQueue) {
    let emptied = await collectQueueDir(root, legacyQueue, report)
    if (emptied) {
      try {
        const push = await root.getDirectoryHandle(LEGACY_PUSH_DIR, { create: false })
        await push.removeEntry(LEGACY_QUEUE_SUBDIR)
        await root.removeEntry(LEGACY_PUSH_DIR)
      } catch { emptied = false }
    }
    drained = emptied && drained
  }

  const receiptsPool = await poolDir(root, RETIRED_RECEIPTS_MEANING)
  if (receiptsPool) {
    let emptied = await collectReceiptsDir(receiptsPool, report)
    if (emptied) {
      try { await root.removeEntry(await registerPoolMeaning(RETIRED_RECEIPTS_MEANING)) } catch { emptied = false }
    }
    drained = emptied && drained
  }

  const legacyReceipts = await legacyReceiptsDir(root)
  if (legacyReceipts) {
    let emptied = await collectReceiptsDir(legacyReceipts, report)
    if (emptied) {
      try { await root.removeEntry(LEGACY_RECEIPTS_DIR) } catch { emptied = false }
    }
    drained = emptied && drained
  }

  report.drained = drained
  if (report.reclaimed || report.receipts || report.kept) {
    console.log(
      `[retired-push] collected ${report.reclaimed} duplicate` +
      `${report.reclaimed === 1 ? '' : 's'} (${(report.reclaimedBytes / 1048576).toFixed(1)} MB), ` +
      `${report.receipts} receipt marker${report.receipts === 1 ? '' : 's'}` +
      (report.kept ? `, kept ${report.kept} unverifiable` : ''),
    )
  }
  return report
}

/** How long after load the collector waits — clear of first paint and the
 *  warmup walk, matching `Store.#SELF_CLEAN_DELAY_MS`. Store's own root is
 *  not resolved at module load, so an inline run would silently no-op. */
const COLLECT_DELAY_MS = 20_000

setTimeout(() => { void collectRetiredPushPool() }, COLLECT_DELAY_MS)
