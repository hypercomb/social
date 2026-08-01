// hypercomb-shared/core/packed-store.worker.ts
//
// THE PACKED-STORE WORKER — the one owner of the hive's packed file.
//
// A dedicated worker because `createSyncAccessHandle` exists nowhere else:
// synchronous, broker-free reads and writes against ONE file are what turn
// the 13.6s flat cold scan into a single sequential read. OPFS enforces the
// single-writer model for us — a second handle on `hive.pack` is refused, so
// exactly one worker (one tab) serves the store at a time.
//
// The worker speaks the SAME command vocabulary as the native Tauri host
// (`hypercomb-client/app/src/main.rs` / `crates/host`): content_put_raw,
// dir_get_raw, raw_dir_entries, … so `native-filesystem.ts` — the
// FileSystemDirectoryHandle-shaped facade the 44 direct-File-System-API
// callers already run through unchanged in the native client — works
// identically over this bridge. Implement the commands, and the whole shell
// follows.
//
// ## The physical layout this worker owns
//
//   <real OPFS root>/<sign('store:packed')>/hive.pack   the packed log (generation 0;
//                                                       later generations are
//                                                       hive.<n>.pack, named by
//                                                       the  pointer)
//   <real OPFS root>/<sig>                              loose blobs >= 64KiB
//                                                       AND undrained flat
//                                                       content (read-fallback)
//   <real OPFS root>/<sigDir>/                          undrained flat bags /
//                                                       pools (read-fallback)
//
// ## Migration doctrine (non-negotiable)
//
// NEVER wipe user OPFS. The drain is per-record copy -> verify (byte-exact
// read-back from the pack) -> remove, chunked and resumable, off the boot
// path. Until a record is drained, reads fall through to the flat layout —
// same pattern as the legacy `__x__` drains in store.ts, one level down.
// Content >= 64KiB is already in its packed-layout home (a loose sig file)
// and is never moved at all.
//
// ## Bulk signing lives here too
//
// SHA-256 for bulk operations (install verify, commit cascades) runs in this
// worker (`sign_bulk`) so hashing stops competing with rendering on the main
// thread. The worker signs every content_put_raw anyway — content addressing
// IS verification.

import {
  BLOB_THRESHOLD,
  PACKED_STORE_MEANING,
  PACK_POINTER_FILENAME,
  packFilename,
  PackedStoreEngine,
  bytesToHex,
  isSigName,
  markerIndexOf,
  type PackedEntry,
  type SyncFile,
} from './packed-store-engine'

interface BridgeRequest {
  id: number
  cmd: string
  payload?: unknown
  headers?: Record<string, string>
}

/** Command payload shapes, mirroring the native host's argument names. */
interface CommandPayload {
  sig?: string
  name?: string
  limit?: number
  /** `pool_get` addresses a pool by its MEANING, not its signature — the
   *  service worker knows `bees`, not sign('bees'). */
  meaning?: string
  key?: string
}

/** OPFS synchronous access — worker-only, and not in the DOM lib TypeScript
 *  ships. Declared to what this file actually calls rather than pulling a
 *  whole extra lib in. */
interface FileSystemSyncAccessHandle {
  getSize(): number
  read(into: Uint8Array, options?: { at?: number }): number
  write(bytes: Uint8Array, options?: { at?: number }): number
  truncate(size: number): void
  flush(): void
  close(): void
}

type SyncCapableFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>
}

const sign = async (bytes: Uint8Array): Promise<string> => {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer as ArrayBuffer)))
}

/** OPFS sync-access-handle binding of the engine's SyncFile seam. */
class OpfsSyncFile implements SyncFile {
  constructor(private readonly handle: FileSystemSyncAccessHandle) {}

  getSize(): number {
    return this.handle.getSize()
  }

  read(offset: number, length: number): Uint8Array {
    const out = new Uint8Array(length)
    const got = this.handle.read(out, { at: offset })
    return got === length ? out : out.subarray(0, got)
  }

  write(offset: number, bytes: Uint8Array): void {
    this.handle.write(bytes, { at: offset })
  }

  truncate(size: number): void {
    this.handle.truncate(size)
  }

  flush(): void {
    this.handle.flush()
  }
}

/**
 * Drain sources and sentinels, CONFIGURED at `pack_open` rather than named
 * here. `Store` already owns the legacy directory constants and the
 * empty-content signature; duplicating either into this file would mint a
 * second copy that drifts — the exact failure the typed-folder and
 * hardcoded-signature doctrine ratchets exist to prevent. The worker
 * receives them and holds no opinion about what the old layout was called.
 */
interface PackConfig {
  /** Legacy dirs that may still hold undrained sig-named CONTENT files. */
  legacyContentDirs: string[]
  /** Legacy dirs whose CHILDREN are lineage bags (sig dirs of markers). */
  legacyBagParents: string[]
  /** The one signature whose valid content is zero bytes. Any OTHER sig
   *  stored as a 0-byte file is a torn write, not content. */
  emptyContentSig: string
}

const EMPTY_CONFIG: PackConfig = {
  legacyContentDirs: [],
  legacyBagParents: [],
  emptyContentSig: '',
}

class PackedHost {
  #engine!: PackedStoreEngine
  #root!: FileSystemDirectoryHandle
  #packDir!: FileSystemDirectoryHandle
  #packPoolSig!: string
  #generation = 0
  #handle!: FileSystemSyncAccessHandle

  #config: PackConfig = EMPTY_CONFIG

  async open(config: PackConfig): Promise<{ packPoolSig: string; stats: unknown; coldOpenMs: number }> {
    const started = performance.now()
    this.#config = config
    this.#root = await navigator.storage.getDirectory()
    this.#packPoolSig = await sign(new TextEncoder().encode(PACKED_STORE_MEANING))
    this.#packDir = await this.#root.getDirectoryHandle(this.#packPoolSig, { create: true })
    this.#generation = await this.#readGeneration()
    const file = await this.#packDir.getFileHandle(
      packFilename(this.#generation), { create: true },
    ) as SyncCapableFileHandle

    // OPFS refuses a second sync handle while one is open — that is the
    // single-writer guarantee. A second tab retries briefly (the first tab
    // may be mid-shutdown), then reports busy; Store falls back to the flat
    // layout read path for that tab rather than serving a partial store.
    let lastError: unknown
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        this.#handle = await file.createSyncAccessHandle()
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        await new Promise(resolve => setTimeout(resolve, 250 + attempt * 150))
      }
    }
    if (!this.#handle) {
      throw Object.assign(
        new Error(`packed store is held by another tab: ${String(lastError)}`),
        { kind: 'Busy' },
      )
    }

    this.#engine = PackedStoreEngine.open(new OpfsSyncFile(this.#handle))
    // Any generation that is not the authoritative one is either a
    // compaction that never completed or one already superseded. Either way
    // it is not data — the pointer flip is what makes a generation real.
    await this.#dropOtherGenerations()
    return {
      packPoolSig: this.#packPoolSig,
      stats: this.#engine.stats(),
      coldOpenMs: performance.now() - started,
    }
  }

  async #readGeneration(): Promise<number> {
    try {
      const file = await (await this.#packDir.getFileHandle(PACK_POINTER_FILENAME)).getFile()
      const parsed = Number.parseInt(await file.text(), 10)
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    } catch {
      return 0 // no pointer yet — generation 0 keeps the bare filename
    }
  }

  async #dropOtherGenerations(): Promise<void> {
    const keep = packFilename(this.#generation)
    for (const [name, handle] of await snapshot(this.#packDir)) {
      if (handle.kind !== 'file' || name === keep || name === PACK_POINTER_FILENAME) continue
      if (!/^hive(\.\d+)?\.pack$/.test(name)) continue
      await this.#packDir.removeEntry(name).catch(() => undefined)
    }
  }

  /**
   * Rewrite the store without its garbage, if there is enough to be worth
   * it. Crash-safe by construction: the next generation is written and
   * flushed COMPLETE beside the current one, and only then does the pointer
   * flip. A crash before the flip leaves the old generation authoritative
   * and the partial one is swept at the next open; a crash after it leaves
   * the new one authoritative with the old one swept the same way. There is
   * no instant at which the authoritative file is incomplete.
   */
  async compact(force = false): Promise<{ compacted: boolean; before: number; after: number }> {
    const before = this.#engine.stats().fileSize
    if (!force && !this.#engine.shouldCompact()) return { compacted: false, before, after: before }

    const next = this.#generation + 1
    const nextFile = await this.#packDir.getFileHandle(
      packFilename(next), { create: true },
    ) as SyncCapableFileHandle
    const nextHandle = await nextFile.createSyncAccessHandle()
    let after = before
    try {
      const compacted = this.#engine.compactInto(new OpfsSyncFile(nextHandle))
      after = compacted.stats().fileSize
      nextHandle.flush()
    } catch (error) {
      nextHandle.close()
      await this.#packDir.removeEntry(packFilename(next)).catch(() => undefined)
      throw error
    }

    // THE FLIP. Everything before this line is invisible; everything after
    // it is committed.
    const pointer = await this.#packDir.getFileHandle(PACK_POINTER_FILENAME, { create: true })
    const writable = await pointer.createWritable()
    await writable.write(String(next))
    await writable.close()

    const previous = packFilename(this.#generation)
    this.#handle.close()
    this.#handle = nextHandle
    this.#generation = next
    this.#engine = PackedStoreEngine.open(new OpfsSyncFile(this.#handle))
    await this.#packDir.removeEntry(previous).catch(() => undefined)
    return { compacted: true, before, after }
  }

  close(): void {
    try { this.#handle?.flush(); this.#handle?.close() } catch { /* already closed */ }
  }

  // -----------------------------------------------------------------
  // flat-layout fallback (read-only — writes NEVER target the old layout)
  // -----------------------------------------------------------------

  async #looseFile(sig: string): Promise<File | null> {
    try {
      const handle = await this.#root.getFileHandle(sig)
      return await handle.getFile()
    } catch { return null }
  }

  async #legacyContentFile(sig: string): Promise<File | null> {
    for (const dirName of this.#config.legacyContentDirs) {
      try {
        const dir = await this.#root.getDirectoryHandle(dirName)
        const handle = await dir.getFileHandle(sig)
        return await handle.getFile()
      } catch { /* next source */ }
    }
    return null
  }

  /** The undrained flat sig-dir for an address, if it still exists.
   *  A legacy bag-parent's `<sig>` child is the one source whose bags the virtual
   *  root can no longer surface by name (non-sig names report absent), so
   *  its bag joins the fallback chain here until the drain absorbs it. */
  async #flatDirs(sig: string): Promise<FileSystemDirectoryHandle[]> {
    if (sig === this.#packPoolSig) return []
    const out: FileSystemDirectoryHandle[] = []
    try { out.push(await this.#root.getDirectoryHandle(sig)) } catch { /* drained */ }
    for (const parentName of this.#config.legacyBagParents) {
      try {
        const parent = await this.#root.getDirectoryHandle(parentName)
        out.push(await parent.getDirectoryHandle(sig))
      } catch { /* drained */ }
    }
    return out
  }

  // -----------------------------------------------------------------
  // the bridge commands — same vocabulary as the native host
  // -----------------------------------------------------------------

  async contentHas(sig: string): Promise<boolean> {
    if (this.#engine.hasContent(sig)) return true
    if (await this.#looseFile(sig)) return true
    return (await this.#legacyContentFile(sig)) !== null
  }

  async contentGet(sig: string): Promise<Uint8Array> {
    const packed = this.#engine.getContent(sig)
    if (packed) return packed
    const loose = (await this.#looseFile(sig)) ?? (await this.#legacyContentFile(sig))
    // A 0-byte file under a non-empty-content sig is a torn flat-layout
    // write, not content — fall through to NotFound so a healthier source
    // (host fetch) can heal it, mirroring store.ts's incomplete-write guard.
    if (loose && (loose.size > 0 || sig === this.#config.emptyContentSig)) {
      return new Uint8Array(await loose.arrayBuffer())
    }
    throw notFound(`content ${sig.slice(0, 12)}…`)
  }

  async contentPut(bytes: Uint8Array): Promise<string> {
    // Content addressing IS verification: the returned sig is computed from
    // the bytes, and the facade refuses a mismatch against the requested
    // name. Small records land in the pack; blobs stay loose sig files.
    const sig = await sign(bytes)
    if (bytes.length < BLOB_THRESHOLD) {
      this.#engine.putContent(sig, bytes)
      return sig
    }
    const existing = await this.#looseFile(sig)
    if (existing && existing.size === bytes.length) return sig
    const handle = await this.#root.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes as unknown as BufferSource)
    await writable.close()
    return sig
  }

  async dirGet(sig: string, name: string): Promise<Uint8Array> {
    const index = markerIndexOf(name)
    const packed = index !== null
      ? this.#engine.getMarker(sig, index)
      : this.#engine.getPool(sig, name)
    if (packed) return packed
    for (const flat of await this.#flatDirs(sig)) {
      try {
        const file = await (await flat.getFileHandle(name)).getFile()
        return new Uint8Array(await file.arrayBuffer())
      } catch { /* next source */ }
    }
    throw notFound(`${name} in ${sig.slice(0, 12)}…`)
  }

  dirPut(sig: string, name: string, bytes: Uint8Array): void {
    const index = markerIndexOf(name)
    if (index !== null) {
      // The caller chose the filename — overwrite is allowed here, unlike
      // restore (opportunistic marker-shape migration rewrites in place).
      this.#engine.setMarker(sig, index, bytes)
    } else {
      this.#engine.putPool(sig, name, bytes)
    }
  }

  async dirRemove(sig: string, name: string): Promise<boolean> {
    // Markers and pool members are REAL deletes — they are not layers and
    // not in the history graph. Remove from the pack AND from an undrained
    // flat dir, or the fallback would resurrect the entry on next read.
    const index = markerIndexOf(name)
    const packedRemoved = index !== null
      ? this.#engine.removeMarker(sig, index)
      : this.#engine.removePool(sig, name)
    let flatRemoved = false
    for (const flat of await this.#flatDirs(sig)) {
      try { await flat.removeEntry(name); flatRemoved = true } catch { /* absent */ }
    }
    return packedRemoved || flatRemoved
  }

  /** A pool member by MEANING — the service worker's addressing. Falls back
   *  to the undrained flat pool dir like every other read, so the SW keeps
   *  getting bytes while migration is still in flight. */
  async poolGet(meaning: string, key: string): Promise<Uint8Array | null> {
    if (!meaning || !key) return null
    const poolSig = await sign(new TextEncoder().encode(meaning))
    const packed = this.#engine.getPool(poolSig, key)
    if (packed) return packed
    for (const flat of await this.#flatDirs(poolSig)) {
      try {
        const file = await (await flat.getFileHandle(key)).getFile()
        return new Uint8Array(await file.arrayBuffer())
      } catch { /* next source */ }
    }
    return null
  }

  async dirEntries(sig: string): Promise<PackedEntry[]> {
    // Union: the pack's view plus whatever the flat dir still holds — the
    // same de-duplication rule as lineage bag union-reads (a name present in
    // both is one entry; the pack, being the drain target, wins).
    const out = this.#engine.dirEntries(sig)
    const seen = new Set(out.map(e => e.name))
    for (const flat of await this.#flatDirs(sig)) {
      for await (const [name, handle] of flat as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (seen.has(name)) continue
        seen.add(name)
        out.push({ name, directory: handle.kind === 'directory' })
      }
    }
    return out
  }

  async rootEntries(): Promise<PackedEntry[]> {
    const out = this.#engine.rootEntries()
    const seen = new Set(out.map(e => e.name))
    for await (const [name, handle] of this.#root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      // Only sig-named entries are the hive; the pack pool dir is internal
      // representation and never surfaces in the virtual root.
      if (name === this.#packPoolSig || !isSigName(name) || seen.has(name)) continue
      out.push({ name, directory: handle.kind === 'directory' })
    }
    return out
  }

  // -----------------------------------------------------------------
  // the drain — flat layout -> pack, per-record copy -> verify -> remove
  // -----------------------------------------------------------------

  /**
   * One bounded chunk of migration. Idempotent and resumable by
   * construction (content addressing dedupes; occupied targets are
   * verified rather than rewritten), so there is no cursor to persist —
   * every run picks up whatever is left. Returns done=true when a full
   * sweep found nothing left to move.
   */
  async drain(limit = 200): Promise<{ moved: number; done: boolean; failed: number }> {
    let moved = 0
    let failed = 0
    const budget = () => moved + failed >= limit
    const tally = (outcome: 'moved' | 'skipped' | 'failed') => {
      if (outcome === 'moved') moved++
      else if (outcome === 'failed') failed++
    }

    // Listings are SNAPSHOTTED before any removal — mutating a directory
    // while async-iterating it is implementation-defined.
    for (const [name, handle] of await snapshot(this.#root)) {
      if (budget()) return { moved, done: false, failed }
      if (name === this.#packPoolSig || !isSigName(name)) continue

      if (handle.kind === 'file') {
        tally(await this.#drainContentFile(this.#root, name, true))
        continue
      }

      const dir = handle as FileSystemDirectoryHandle
      for (const [entryName, entry] of await snapshot(dir)) {
        if (budget()) return { moved, done: false, failed }
        if (entry.kind === 'file') {
          tally(await this.#drainDirEntry(dir, name, entryName))
          continue
        }
        // Document-pool sub-bucket (`<pool>/<sign(subKey)>/<member>`) — one
        // level, per the layout. Drained into prefixed member keys, the same
        // representation the native store uses.
        const sub = entry as FileSystemDirectoryHandle
        for (const [leafName, leaf] of await snapshot(sub)) {
          if (budget()) return { moved, done: false, failed }
          if (leaf.kind !== 'file') continue
          tally(await this.#drainDirEntry(sub, name, `${entryName}/${leafName}`, leafName))
        }
        await this.#removeIfEmpty(dir, entryName)
      }
      await this.#removeIfEmpty(this.#root, name)
    }

    // Legacy sources, CHAINED behind the flat root: content dirs first,
    // then the legacy bag parents. Reads already fall back to them, so
    // draining them here is the same copy->verify->remove, one level deeper.
    for (const dirName of this.#config.legacyContentDirs) {
      if (budget()) return { moved, done: false, failed }
      const dir = await this.#tryDir(this.#root, dirName)
      if (!dir) continue
      for (const [name, entry] of await snapshot(dir)) {
        if (budget()) return { moved, done: false, failed }
        if (entry.kind !== 'file' || !isSigName(name)) continue
        tally(await this.#drainContentFile(dir, name, false))
      }
      await this.#removeIfEmpty(this.#root, dirName)
    }
    for (const parentName of this.#config.legacyBagParents) {
      const parent = await this.#tryDir(this.#root, parentName)
      if (!parent) continue
      for (const [bagName, bagHandle] of await snapshot(parent)) {
        if (bagHandle.kind !== 'directory' || !isSigName(bagName)) continue
        const bag = bagHandle as FileSystemDirectoryHandle
        for (const [entryName, entry] of await snapshot(bag)) {
          if (budget()) return { moved, done: false, failed }
          if (entry.kind !== 'file') continue
          tally(await this.#drainDirEntry(bag, bagName, entryName))
        }
        await this.#removeIfEmpty(parent, bagName)
      }
      await this.#removeIfEmpty(this.#root, parentName)
    }

    // Done = a FULL sweep moved nothing. Failed records (bytes that do not
    // sign as their name, torn 0-byte writes) are left in place and
    // reported — they must not keep the drain alive forever.
    return { moved, done: moved === 0, failed }
  }

  async #tryDir(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
    try { return await parent.getDirectoryHandle(name) } catch { return null }
  }

  /** copy -> verify -> remove for one flat content file. Blobs (>= 64KiB)
   *  at the ROOT are already home and are skipped; blobs in a legacy dir
   *  move to the root. A file whose bytes do not sign as its name is left
   *  in place and reported — corruption is surfaced, never deleted. */
  async #drainContentFile(
    source: FileSystemDirectoryHandle,
    sig: string,
    atRoot: boolean,
  ): Promise<'moved' | 'skipped' | 'failed'> {
    const file = await (await source.getFileHandle(sig)).getFile()
    if (file.size === 0 && sig !== this.#config.emptyContentSig) return 'failed' // torn write — leave for the healing read path
    const bytes = new Uint8Array(await file.arrayBuffer())
    const actual = await sign(bytes)
    if (actual !== sig) return 'failed' // does not sign as its name — surface, never delete

    if (bytes.length >= BLOB_THRESHOLD) {
      if (atRoot) return 'skipped' // a root blob IS the packed layout
      await this.contentPut(bytes) // legacy blob -> loose root file
    } else {
      this.#engine.putContent(sig, bytes)
      const packed = this.#engine.getContent(sig)
      if (!packed || !bytesEqual(packed, bytes)) return 'failed'
    }
    await source.removeEntry(sig).catch(() => undefined)
    return 'moved'
  }

  /** copy -> verify -> remove for one marker or pool member. `key` is the
   *  stored member key (prefixed for sub-buckets); `fileName` the physical
   *  entry to remove, defaulting to the key. */
  async #drainDirEntry(
    dir: FileSystemDirectoryHandle,
    address: string,
    key: string,
    fileName = key,
  ): Promise<'moved' | 'skipped' | 'failed'> {
    const bytes = new Uint8Array(await (await (await dir.getFileHandle(fileName)).getFile()).arrayBuffer())
    const index = markerIndexOf(key)
    if (index !== null) {
      const existing = this.#engine.getMarker(address, index)
      if (existing && !bytesEqual(existing, bytes)) {
        // The pack already holds a DIFFERENT marker at this index — the pack
        // is the live store and wins (the flat copy is stale). Remove the
        // stale source; the record itself was not moved.
        await dir.removeEntry(fileName).catch(() => undefined)
        return 'skipped'
      }
      if (!existing) this.#engine.setMarker(address, index, bytes)
      if (!bytesEqual(this.#engine.getMarker(address, index)!, bytes) && !existing) return 'failed'
    } else {
      const existing = this.#engine.getPool(address, key)
      if (!existing) this.#engine.putPool(address, key, bytes)
      else if (!bytesEqual(existing, bytes)) {
        await dir.removeEntry(fileName).catch(() => undefined)
        return 'skipped'
      }
      const packed = this.#engine.getPool(address, key)
      if (!packed || !bytesEqual(packed, bytes)) return 'failed'
    }
    await dir.removeEntry(fileName).catch(() => undefined)
    return 'moved'
  }

  /** Gated final removal: only succeeds once the dir is genuinely empty —
   *  stragglers survive to a later pass, exactly like the `__x__` drains. */
  async #removeIfEmpty(parent: FileSystemDirectoryHandle, name: string): Promise<void> {
    try {
      const dir = await parent.getDirectoryHandle(name)
      for await (const _ of dir as unknown as AsyncIterable<unknown>) return // not empty
      await parent.removeEntry(name)
    } catch { /* already gone or still busy — fine either way */ }
  }

  stats(): unknown {
    return this.#engine.stats()
  }
}


/** Materialize a directory listing before mutating the directory. */
const snapshot = async (
  dir: FileSystemDirectoryHandle,
): Promise<Array<[string, FileSystemHandle]>> => {
  const out: Array<[string, FileSystemHandle]> = []
  for await (const pair of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) out.push(pair)
  return out
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const notFound = (what: string): Error & { kind: string } =>
  Object.assign(new Error(`${what} not found`), { kind: 'NotFound' })

// ---------------------------------------------------------------------------
// RPC surface
// ---------------------------------------------------------------------------

const host = new PackedHost()
let ready: Promise<unknown> | null = null

const toTransferable = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer as ArrayBuffer
}

const handle = async (request: BridgeRequest): Promise<{ result: unknown; transfer: Transferable[] }> => {
  const { cmd, payload, headers } = request
  const p = (payload ?? {}) as CommandPayload

  if (cmd === 'pack_open') {
    ready ??= host.open(payload as PackConfig)
    return { result: await ready, transfer: [] }
  }
  if (!ready) throw new Error('packed store not opened — send pack_open first')
  await ready

  switch (cmd) {
    case 'content_has':
      return { result: await host.contentHas(p.sig!), transfer: [] }
    case 'content_get_raw': {
      const bytes = await host.contentGet(p.sig!)
      const buffer = toTransferable(bytes)
      return { result: buffer, transfer: [buffer] }
    }
    case 'content_put_raw':
      return { result: await host.contentPut(new Uint8Array(payload as ArrayBuffer)), transfer: [] }
    case 'dir_get_raw': {
      const bytes = await host.dirGet(p.sig!, p.name!)
      const buffer = toTransferable(bytes)
      return { result: buffer, transfer: [buffer] }
    }
    case 'dir_put_raw': {
      const sig = headers?.['x-hc-sig'] as string
      const name = decodeURIComponent(headers?.['x-hc-name'] ?? '')
      host.dirPut(sig, name, new Uint8Array(payload as ArrayBuffer))
      return { result: null, transfer: [] }
    }
    case 'raw_dir_remove':
      return { result: await host.dirRemove(p.sig!, p.name!), transfer: [] }
    case 'pool_get': {
      // The service-worker bridge's command. Addressed by MEANING because
      // that is what the SW's URL shape carries (`__bees__`, `__dependencies__`);
      // sign() turns it into the pool address, exactly as Store.poolSignature
      // would. Same command name and payload as the native host, so ONE
      // listener serves both backends.
      const bytes = await host.poolGet(p.meaning ?? '', p.key ?? '')
      if (!bytes) return { result: null, transfer: [] }
      const buffer = toTransferable(bytes)
      return { result: buffer, transfer: [buffer] }
    }
    case 'raw_dir_entries':
      return { result: await host.dirEntries(p.sig!), transfer: [] }
    case 'raw_root_entries':
      return { result: await host.rootEntries(), transfer: [] }
    case 'raw_remove':
      // Removing content is a no-op — the model, not a limitation. Layers
      // are atomic and complete; content is reclaimed only by collection.
      return { result: false, transfer: [] }
    case 'sign_bulk': {
      const buffers = payload as ArrayBuffer[]
      const sigs: string[] = []
      for (const buffer of buffers) sigs.push(await sign(new Uint8Array(buffer)))
      return { result: sigs, transfer: [] }
    }
    case 'pack_drain': {
      const drained = await host.drain(p.limit ?? 200)
      // Compaction is checked when the drain settles, not per chunk: the
      // drain is the one bulk writer, and rewriting mid-drain would be
      // wasted work.
      const compaction = drained.done ? await host.compact() : { compacted: false }
      return { result: { ...drained, compaction }, transfer: [] }
    }
    case 'pack_compact':
      return { result: await host.compact(true), transfer: [] }
    case 'pack_stats':
      return { result: host.stats(), transfer: [] }
    case 'pack_close':
      host.close()
      return { result: null, transfer: [] }
    default:
      throw new Error(`unknown packed-store command: ${cmd}`)
  }
}

self.addEventListener('message', (event: MessageEvent<BridgeRequest>) => {
  const request = event.data
  void handle(request).then(
    ({ result, transfer }) =>
      self.postMessage({ id: request.id, ok: true, result }, { transfer }),
    (error: Error & { kind?: string }) =>
      self.postMessage({
        id: request.id,
        ok: false,
        error: { kind: error?.kind ?? 'Error', message: error?.message ?? String(error) },
      }),
  )
})
