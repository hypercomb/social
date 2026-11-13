// hypercomb-runtime/src/packed-bridge.ts
//
// THE SECOND BRIDGE — the packed-store worker behind the NativeBridge seam.
//
// `native-filesystem.ts` was built so that its backend is nothing but
// `NativeBridge { invoke(cmd, payload, opts) }`. The native client plugs
// Tauri IPC into that seam; this file plugs in the packed-store worker via
// postMessage RPC. Every one of the 44 files that reach past Store with the
// raw File System API then runs unchanged over the packed store — the same
// architectural trick, second backend.
//
// The worker owns the OPFS SyncAccessHandle; this side is a thin async RPC
// with transferable buffers. `packedRoot()` is the boot entry: flag-gated,
// null when off or unsupported, and Store's #doInit treats null exactly like
// a missing native host — the flat OPFS path runs as before.

import { SignatureService, packedStoreEnabled, poolKindFacts, poolKinds, setBulkSigner } from '@hypercomb/core'
import { NativeRootDirectory, installSwBytesBridge, type NativeBridge } from './native-filesystem'
import { PACK_MAGIC, PACK_POINTER_FILENAME, packFilename } from './packed-store-engine'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cmd: string
}

/** How long the worker may stay silent while calls wait on it. A healthy
 *  worker answers each read in about a millisecond, even with a backlog of
 *  thousands, so silence this long means it will not answer at all. */
export const PACKED_SILENCE_MS = 10_000
/** The same, while a command that is SUPPOSED to take long is in flight: the
 *  open parses the whole pack, a drain or compaction rewrites it. */
export const PACKED_LONG_SILENCE_MS = 60_000
/** A compaction rewrites the whole pack in one synchronous call — on a
 *  ~1 GB hive that is legitimately minutes. Killing it part way leaves the
 *  garbage in place, so the next attempt would start over and be killed
 *  again: it gets far longer before the watchdog decides it is stuck. */
export const PACKED_COMPACT_SILENCE_MS = 300_000
const LONG_COMMANDS = new Set(['pack_open', 'pack_drain', 'pack_collect'])
const COMPACT_COMMANDS = new Set(['pack_compact', 'pack_maybe_compact'])
const WATCH_EVERY_MS = 1_000
const REOPEN_ATTEMPTS = 5

/** What the bridge needs to stand a stuck worker back up. */
export interface PackedRestart {
  spawn: () => Worker
  config: PackedStoreConfig
}

/** RPC over the dedicated worker. One instance per shell.
 *
 *  THE WATCHDOG (2026-11-12). The worker went silent in the middle of a boot
 *  warm-up of ~110k reads, and OPFS for the whole origin went with it; every
 *  read stayed pending for good, the renderer awaited one of them, and the
 *  hive never painted again until a reload. A reload recovers because it
 *  kills the worker. So does this: when calls are waiting and the worker has
 *  said nothing for PACKED_SILENCE_MS, the worker is terminated (its
 *  SyncAccessHandle goes with it, exactly as when a tab closes), every
 *  waiting call is rejected so its caller moves on, and a fresh worker
 *  reopens the pack. Appends are CRC-framed, so a record torn by the
 *  terminate is a torn tail the open already skips. */
export class PackedBridge implements NativeBridge {
  #worker: Worker
  #nextId = 1
  readonly #pending = new Map<number, PendingCall>()
  readonly #restart: PackedRestart | null
  /** When the worker last answered anything (or was last spawned). */
  #lastHeard = Date.now()
  #watch: ReturnType<typeof setInterval> | null = null
  #restarts = 0
  #terminated = false

  constructor(worker: Worker, restart: PackedRestart | null = null) {
    this.#worker = worker
    this.#restart = restart
    this.#attach(worker)
  }

  /** How many times the watchdog has stood the worker back up. */
  get restarts(): number { return this.#restarts }

  #attach(worker: Worker): void {
    worker.addEventListener('message', (event: MessageEvent) => {
      if (worker !== this.#worker) return   // a terminated worker's late word
      this.#lastHeard = Date.now()
      const { id, ok, result, error } = event.data as {
        id: number
        ok: boolean
        result?: unknown
        error?: { kind: string; message: string }
      }
      const pending = this.#pending.get(id)
      if (!pending) return
      this.#pending.delete(id)
      if (ok) pending.resolve(result)
      else pending.reject(Object.assign(new Error(error?.message ?? 'packed store error'), { kind: error?.kind }))
    })
  }

  #arm(): void {
    if (this.#watch !== null || this.#terminated) return
    this.#watch = setInterval(this.#check, WATCH_EVERY_MS)
  }

  /** One watchdog tick; the interval calls it. */
  readonly #check = (): void => {
    if (this.#pending.size === 0) {
      if (this.#watch !== null) { clearInterval(this.#watch); this.#watch = null }
      return
    }
    let allowance = PACKED_SILENCE_MS
    for (const call of this.#pending.values()) {
      if (COMPACT_COMMANDS.has(call.cmd)) { allowance = PACKED_COMPACT_SILENCE_MS; break }
      if (LONG_COMMANDS.has(call.cmd)) allowance = PACKED_LONG_SILENCE_MS
    }
    const silent = Date.now() - this.#lastHeard
    if (silent < allowance) return
    this.#recover(silent)
  }

  /** Run one watchdog tick now. */
  checkNow = (): void => { this.#check() }

  #recover(silentMs: number): void {
    const waiting = this.#pending.size
    console.warn(`[packed-store] the worker said nothing for ${Math.round(silentMs / 1000)}s with ${waiting} call(s) waiting — restarting it`)
    this.#worker.terminate()
    this.#failPending('packed store worker restarted — it stopped answering', 'Restarted')
    if (!this.#restart) {
      // Nothing to reopen with: callers are released, later calls fail fast.
      this.#terminated = true
      if (this.#watch !== null) { clearInterval(this.#watch); this.#watch = null }
      return
    }
    this.#restarts++
    this.#reopen(1)
  }

  /** Spawn a worker and open the pack in it. The open goes first; the worker
   *  handles messages in order and every later command awaits the open, so
   *  calls made meanwhile just queue behind it. The old worker's lock is not
   *  promised to be gone the instant it is terminated, so a refused open is
   *  tried again, a little later each time. */
  #reopen(attempt: number): void {
    const restart = this.#restart
    if (!restart || this.#terminated) return
    const worker = restart.spawn()
    this.#worker = worker
    this.#lastHeard = Date.now()
    this.#attach(worker)
    void this.invoke('pack_open', restart.config).catch(error => {
      if (this.#worker !== worker || this.#terminated) return
      if (attempt >= REOPEN_ATTEMPTS) {
        console.warn('[packed-store] the restarted worker could not open the pack — reload to recover', error)
        return
      }
      worker.terminate()
      this.#failPending('packed store worker reopening', 'Restarted')
      setTimeout(() => this.#reopen(attempt + 1), attempt * 500)
    })
  }

  #failPending(message: string, kind: string): void {
    const calls = [...this.#pending.values()]
    this.#pending.clear()
    for (const call of calls) call.reject(Object.assign(new Error(message), { kind }))
  }

  invoke = (
    command: string,
    payload?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<unknown> => {
    const id = this.#nextId++
    const transfer: Transferable[] = []
    // Byte payloads travel as transferred ArrayBuffers — zero-copy both ways.
    let body = payload
    if (payload instanceof Uint8Array) {
      const buffer = payload.byteOffset === 0 && payload.byteLength === payload.buffer.byteLength
        ? payload.buffer
        : payload.slice().buffer
      body = buffer
      transfer.push(buffer as ArrayBuffer)
    } else if (payload instanceof ArrayBuffer) {
      body = payload
      transfer.push(payload)
    }
    return new Promise((resolve, reject) => {
      if (this.#terminated) {
        reject(Object.assign(new Error('packed store bridge terminated'), { kind: 'Terminated' }))
        return
      }
      // Silence is measured from the moment something starts waiting, not
      // from an idle stretch before it.
      if (this.#pending.size === 0) this.#lastHeard = Date.now()
      this.#pending.set(id, { resolve, reject, cmd: command })
      this.#arm()
      this.#worker.postMessage({ id, cmd: command, payload: body, headers: options?.headers }, transfer)
    })
  }

  terminate(): void {
    this.#terminated = true
    if (this.#watch !== null) { clearInterval(this.#watch); this.#watch = null }
    this.#worker.terminate()
    this.#failPending('packed store bridge terminated', 'Terminated')
  }
}

let bootedBridge: PackedBridge | null = null

/** WHY the last `packedRoot()` call returned null.
 *
 *  The three null cases are not the same problem and must not produce the
 *  same advice. `busy` is the single-writer rule doing its job — another tab
 *  (or an abandoned worker from a failed open) holds the pack's exclusive
 *  SyncAccessHandle, and the flag is irrelevant. `disabled` is packed mode
 *  switched off or unsupported. `failed` is an open that got far enough to
 *  throw for some other reason. Callers that must refuse the boot read this
 *  so they can name the ACTUAL cause instead of listing every possibility
 *  and leading with the wrong one. */
export type PackedUnavailable = 'disabled' | 'busy' | 'failed'

let lastUnavailable: PackedUnavailable | null = null

/** Why packed mode did not engage on the last `packedRoot()` call, or null
 *  when it did engage (or has not been attempted). */
export const packedUnavailableReason = (): PackedUnavailable | null => lastUnavailable

/** The live bridge, once `packedRoot()` has opened it. Null before boot or
 *  when packed mode is off — callers (bulk signing, drain scheduling) treat
 *  null as "do it the old way". */
export const packedBridge = (): PackedBridge | null => bootedBridge

/** Is the packed store even possible here? Requires workers and OPFS. */
const packedSupported = (): boolean =>
  typeof Worker !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.storage?.getDirectory

/** What the worker needs to know about the OLD layout. Supplied by `Store`,
 *  which owns those constants — the worker holds no second copy to drift. */
export interface PackedStoreConfig {
  legacyContentDirs: string[]
  legacyBagParents: string[]
  emptyContentSig: string
}

/**
 * Does a populated pack exist for this origin?
 *
 * THE ONE-WAY DOOR. The drain moves records into the pack and removes them
 * from the flat layout, so once it has run the flat layout is no longer a
 * complete hive. Booting flat after that would not fail — it would SUCCEED,
 * quietly, showing a hive with bags and pools missing, and the user's next
 * commit would build on top of that hollow state. A silent partial hive is
 * far worse than a stopped boot, so `Store` checks this before taking the
 * flat path and refuses rather than serving it.
 *
 * Cheap: resolve the pool dir, read a one-byte pointer, stat one file. No
 * worker, no sync handle — this runs on the path where packed mode is OFF.
 *
 * An EMPTY pack (created, never drained) does not count. Nothing has moved,
 * the flat layout is still whole, and flipping the flag off is genuinely
 * safe there.
 */
export const packedStoreHasRecords = async (packPoolSig: string): Promise<boolean> => {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(packPoolSig)
    let generation = 0
    try {
      const pointer = await (await dir.getFileHandle(PACK_POINTER_FILENAME)).getFile()
      const parsed = Number.parseInt(await pointer.text(), 10)
      if (Number.isFinite(parsed) && parsed >= 0) generation = parsed
    } catch { /* no pointer — generation 0 */ }
    const pack = await (await dir.getFileHandle(packFilename(generation))).getFile()
    return pack.size > PACK_MAGIC.length
  } catch {
    // No pool dir, no pack, no pointer — nothing was ever drained.
    return false
  }
}

export interface PackedBoot {
  root: NativeRootDirectory
  bridge: PackedBridge
  /** Stats + cold-open timing straight from the worker's pack_open. */
  info: { packPoolSig: string; stats: unknown; coldOpenMs: number }
}

/**
 * Boot the packed store: spawn the worker, open the pack, hand back the
 * facade root. Null when the flag is off, the platform can't, or the pack is
 * held by another tab (single-writer) — in every null case Store continues
 * on flat OPFS unchanged, which is always safe because the pack absorbs the
 * flat layout by DRAIN, and until a record is drained the flat layout still
 * holds it.
 */
/** The addresses of every pool the registry declares WIPE-SAFE (the `index`
 *  kind), derived here on the main thread where the registry lives, so the
 *  worker's collector can skip their members whole (packed-collect.ts). */
export const wipeSafePoolAddresses = async (): Promise<string[]> => {
  const out: string[] = []
  for (const [meaning, kind] of poolKinds()) {
    if (poolKindFacts(kind)?.wipeSafe !== true) continue
    out.push(await SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer))
  }
  return out
}

export const packedRoot = async (config: PackedStoreConfig): Promise<PackedBoot | null> => {
  if (!packedStoreEnabled() || !packedSupported()) {
    lastUnavailable = 'disabled'
    return null
  }
  let bridge: PackedBridge | null = null
  try {
    const spawn = (): Worker => new Worker(new URL('./packed-store.worker', import.meta.url), { type: 'module' })
    const openedBridge = new PackedBridge(spawn(), { spawn, config })
    bridge = openedBridge
    const info = (await openedBridge.invoke('pack_open', config)) as PackedBoot['info']
    bootedBridge = openedBridge
    // Bulk SHA-256 now happens in the worker, so install verification and
    // folder-sync sweeps stop competing with rendering. Callers reach it
    // through `SignatureService.signMany` and never learn a worker exists.
    setBulkSigner(signBulk)
    // The service worker reads OPFS directly to serve `/opfs/**` modules and
    // `/@resource/` site composition. Once records are drained into the pack
    // those reads miss, so it falls back to asking a window client for the
    // bytes — and this is the listener that answers. Without it, packed mode
    // would 404 every module the SW serves.
    installSwBytesBridge(bridge)
    // Diagnostic handle. The pack is opaque from the page — the worker owns
    // the only handle — so without this there is no way to ask the live
    // store what it holds, force a compaction, or watch a drain. Read-only
    // commands plus two explicit maintenance ones; nothing here can write a
    // record.
    ;(globalThis as unknown as Record<string, unknown>)['hypercombPackedStore'] = {
      stats: () => openedBridge.invoke('pack_stats'),
      drain: (limit = 200) => openedBridge.invoke('pack_drain', { limit }),
      compact: () => openedBridge.invoke('pack_compact'),
      collect: async () => openedBridge.invoke('pack_collect', { wipeSafePools: await wipeSafePoolAddresses() }),
    }
    lastUnavailable = null
    return { root: new NativeRootDirectory(openedBridge), bridge: openedBridge, info }
  } catch (error) {
    // `pack_open` acquires the exclusive SyncAccessHandle before it parses the
    // file. If parsing or any later open step fails, leaving this worker alive
    // leaves that handle locked even though no usable store was returned.
    // Reload then sees its own abandoned worker as "another tab" and only a
    // full Chromium restart releases it. Terminating the failed bridge closes
    // the worker global and its SyncAccessHandle immediately.
    bridge?.terminate()
    // The worker tags single-writer contention as `kind: 'Busy'` and the
    // bridge rehydrates that onto the rejection, so this is an exact
    // classification, not a message sniff.
    lastUnavailable = (error as { kind?: string } | null)?.kind === 'Busy' ? 'busy' : 'failed'
    console.warn(`[packed-store] unavailable (${lastUnavailable}) — continuing on flat OPFS`, error)
    return null
  }
}

/**
 * SHA-256 for BULK operations (install verify, commit cascades) — routed
 * through the packed worker so hashing stops competing with rendering on the
 * main thread. Falls back to main-thread crypto.subtle when packed mode is
 * off, so callers never branch.
 */
export const signBulk = async (buffers: ArrayBuffer[]): Promise<string[]> => {
  const bridge = bootedBridge
  if (bridge) {
    try {
      return (await bridge.invoke('sign_bulk', buffers)) as string[]
    } catch { /* worker mid-restart — fall through to inline */ }
  }
  const out: string[] = []
  for (const buffer of buffers) {
    const hash = await crypto.subtle.digest('SHA-256', buffer)
    out.push(Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join(''))
  }
  return out
}

/**
 * Route `navigator.storage.getDirectory()` itself to the packed root — the
 * same override the native client installs, for the same reason: nine files
 * acquire the OPFS root directly, and every acquisition must land on the ONE
 * hive. The REAL root stays reachable for the worker (its own global is
 * untouched) and for anything holding the captured original.
 *
 * Must run before any code that might capture the original function.
 */
export const installPackedStorageOverride = (root: NativeRootDirectory): boolean => {
  try {
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => root as unknown as FileSystemDirectoryHandle,
    })
    return true
  } catch {
    return false
  }
}
