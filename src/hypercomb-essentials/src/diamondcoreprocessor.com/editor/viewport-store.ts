// diamondcoreprocessor.com/editor/viewport-store.ts
//
// Viewport storage — per-location zoom / pan / meshOffset, keyed by the
// location SIGNATURE in a flat, non-history OPFS pool of meaning: one
// file per location sig inside the `sign('viewport')` pool at the OPFS
// root. The pool address is DERIVED — sha256 of the UTF-8 bytes of
// 'viewport' — never a typed folder name. The legacy `__viewport__`
// dir is a read-fallback/drain source only: opened WITHOUT create,
// union-read into the warm cache while it exists, absorbed into the
// pool by the self-cleaning drain below, never written again.
//
// Why NOT history
// ───────────────
// Viewport (zoom/pan) is participant-local *view* state, not content.
// Committing it into the content-addressed layer would skew the layer
// signature — the same tiles viewed at a different zoom would hash to a
// different signature, so two peers looking at identical content would
// diverge and dedup/sharing would break (the same reason clipboard,
// selection, and cursor are kept out of the layer). It would also
// pollute undo/redo with camera moves and cascade a fresh sig to the
// root on every pan frame. So viewport lives OUTSIDE history.
//
// Why keyed by location signature
// ────────────────────────────────
// `history.sign({ segments })` hashes the location PATH (root = '/',
// 'a' = 'a', 'a/b' = 'a/b'), not the content — so the key is stable
// across content edits and identical for root and dir-less sub-layers.
// No OPFS folder handle (`<dir>/0000`) is required, which is what made
// the old path silently no-op for sub-layers and racily for root.

import { EffectBus, SignatureService } from '@hypercomb/core'
import type { ViewportSnapshot } from '../navigation/zoom/zoom.drone.js'
import { ROOT_NAME } from '../history/history.service.js'
import { readTilePropertiesAt } from './tile-properties.js'

export type { ViewportSnapshot }

const VIEWPORT_MEANING = 'viewport'
/** Legacy drain source — read/union only until the absorb removes it. */
const LEGACY_VIEWPORT_DIRECTORY = '__viewport__'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

/** How long after module load the legacy drain waits — clear of first
 *  paint and the warmup walk (mirrors Store's self-clean delay). */
const SELF_CLEAN_DELAY_MS = 20_000

type HistoryServiceLike = {
  sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
}

const iocGet = <T>(key: string): T | undefined => {
  const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
  return ioc?.get?.(key) as T | undefined
}

/**
 * Root is named `/` so its key is `sign('/')`, addressed identically to
 * every other location. Without this, root would collapse to `sign('')`
 * because history.sign's canonicalization filters empty strings.
 */
function signingSegments(segments: readonly string[]): readonly string[] {
  return segments.length === 0 ? [ROOT_NAME] : segments
}

// ── flat OPFS pool ─────────────────────────────────────────────────
// One sign(meaning) pool dir at the OPFS root, one file per location
// signature. Direct handle access (no service-worker round-trip, no
// Store coupling — essentials must not import shared, so the pool sig
// is derived locally via SignatureService). Handles resolve lazily and
// are cached.

let _dir: Promise<FileSystemDirectoryHandle | null> | null = null
const viewportPool = (): Promise<FileSystemDirectoryHandle | null> =>
  (_dir ??= (async () => {
    try {
      const root = await navigator.storage.getDirectory()
      const poolSig = await SignatureService.sign(new TextEncoder().encode(VIEWPORT_MEANING).buffer as ArrayBuffer)
      return await root.getDirectoryHandle(poolSig, { create: true })
    } catch {
      return null
    }
  })())

// Legacy `__viewport__` — opened WITHOUT create (stays gone once
// drained), tolerated absent. Read/union + drain source only.
let _legacyDir: Promise<FileSystemDirectoryHandle | null> | null = null
const legacyViewportDir = (): Promise<FileSystemDirectoryHandle | null> =>
  (_legacyDir ??= (async () => {
    try {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(LEGACY_VIEWPORT_DIRECTORY)
    } catch {
      return null
    }
  })())

const locationSig = async (segments: readonly string[]): Promise<string | null> => {
  const history = iocGet<HistoryServiceLike>(HISTORY_KEY)
  if (!history?.sign) return null
  const segs = signingSegments(segments)
  try {
    return await history.sign({ explorerSegments: () => [...segs] })
  } catch {
    return null
  }
}

// Serialize all store ops so a read can't observe a half-written file
// and two writes to the same key can't interleave.
let _opQueue: Promise<unknown> = Promise.resolve()
const serialize = <T>(op: () => Promise<T>): Promise<T> => {
  const p = _opQueue.then(op, op)
  _opQueue = p.catch(() => undefined)
  return p
}

// ── warm cache ─────────────────────────────────────────────────────
// In-memory mirror of the whole viewport pool, hydrated ONCE at module
// load (boot). Doctrine: data is warmed at boot and navigation reads
// from cache — render must never wait on a per-location OPFS read.
// The pool is tiny (one small JSON per visited location), so one
// enumeration covers everything; `writeViewportAt` keeps the mirror
// coherent afterwards. UNION-enumerated with the legacy `__viewport__`
// dir while that drain source still exists (the absorb is detached, so
// a partially-drained boot must still see every saved framing — losing
// them would re-fire every first-visit fit). Pool entries win on a key
// collision. The only read that can ever wait is the very first one at
// boot (root), and it waits on this single enumeration — not a
// per-location fetch.

const _warmCache = new Map<string, ViewportSnapshot>()
let _warmed: Promise<void> | null = null
const warmAll = (): Promise<void> =>
  (_warmed ??= serialize(async () => {
    const hydrate = async (dir: FileSystemDirectoryHandle | null): Promise<void> => {
      if (!dir) return
      try {
        for await (const [name, handle] of (dir as unknown as {
          entries: () => AsyncIterable<[string, FileSystemHandle]>
        }).entries()) {
          if (handle.kind !== 'file' || !/^[a-f0-9]{64}$/.test(name)) continue
          try {
            const file = await (handle as FileSystemFileHandle).getFile()
            const parsed = JSON.parse(await file.text())
            if (parsed && typeof parsed === 'object') _warmCache.set(name, parsed as ViewportSnapshot)
          } catch { /* unreadable entry — treated as absent */ }
        }
      } catch { /* enumeration failed — reads fall back to empty */ }
    }
    // Legacy first, pool second — the pool overwrites, so canonical wins.
    await hydrate(await legacyViewportDir())
    await hydrate(await viewportPool())
  }))

// Hydrate at module load so the cache is warm before first navigation.
void warmAll()

// ── self-cleaning drain ────────────────────────────────────────────
// Absorb the legacy `__viewport__` dir into the sign('viewport') pool:
// per-record copy → remove (pool entry wins — the legacy copy is by
// definition older), then a NON-recursive final removeEntry that only
// succeeds once the dir is empty, so a straggler is never destroyed.
// Detached + delayed so it never competes with first paint; idempotent
// and resumable — an interrupted pass finishes on a later boot. Reads
// stay correct meanwhile via the union hydrate above.
setTimeout(() => {
  void serialize(async () => {
    const legacy = await legacyViewportDir()
    const pool = await viewportPool()
    if (!legacy || !pool) return
    try {
      for await (const [name, handle] of (legacy as unknown as {
        entries: () => AsyncIterable<[string, FileSystemHandle]>
      }).entries()) {
        if (handle.kind !== 'file') continue
        try {
          let present = true
          try { await pool.getFileHandle(name) } catch { present = false }
          if (!present) {
            const blob = await (handle as FileSystemFileHandle).getFile()
            const dest = await pool.getFileHandle(name, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(blob) } finally { await writable.close() }
          }
          await legacy.removeEntry(name)
        } catch { /* straggler — absorbed on a later boot */ }
      }
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(LEGACY_VIEWPORT_DIRECTORY)
      _legacyDir = Promise.resolve(null)  // drained — drop the stale handle
      console.log(`[viewport-store] ${LEGACY_VIEWPORT_DIRECTORY} absorbed into the sign('${VIEWPORT_MEANING}') pool`)
    } catch { /* dir not yet empty — union reads keep working; retry next boot */ }
  })
}, SELF_CLEAN_DELAY_MS)

// ── Public API ─────────────────────────────────────────────────────

/**
 * Read the viewport snapshot for the layer at `segments` (empty = root).
 * Returns `{}` when nothing is saved yet.
 */
export const readViewportAt = async (
  segments: readonly string[],
): Promise<ViewportSnapshot> => {
  const sig = await locationSig(segments)
  if (!sig) return {}
  // Warm-cache read. warmAll() resolved long ago for every navigation
  // after boot — only the very first read (root, during boot) can
  // actually wait here, and it waits on the one-time directory
  // enumeration, never a per-location OPFS fetch.
  await warmAll()
  const local = _warmCache.get(sig) ?? {}
  if (Object.keys(local).length > 0) return local

  // FIRST-VISIT SEED: no participant-local viewport at this location yet. If
  // the location's canonical props carry the publisher's viewport stamp
  // (their framing — e.g. an adopted site authored at scale 2), use it as
  // the default so the imported view opens at the HOST'S scale instead of an
  // arbitrary one. Read-only: nothing is written here, so the doctrine holds
  // (viewport stays participant-local — the local file appears on the
  // participant's first own zoom/pan and overrides this seed permanently).
  if (segments.length === 0) return {}
  try {
    const props = await readTilePropertiesAt(segments.slice(0, -1), segments[segments.length - 1])
    const vp = (props as { viewport?: unknown })?.viewport
    if (vp && typeof vp === 'object') return vp as ViewportSnapshot
  } catch { /* no canonical stamp — fall through */ }
  return {}
}

/**
 * True when a PARTICIPANT-LOCAL viewport entry already exists for this
 * location — i.e. the participant has framed/visited it before.
 *
 * Distinct from readViewportAt, which on a first visit also returns the
 * publisher's seed stamp: this looks ONLY at the local store, so callers can
 * detect a *genuine* first visit. Used to fire the adopt first-visit fit
 * exactly once (after which the persisted fit makes this return true).
 */
export const hasPersistedViewportAt = async (
  segments: readonly string[],
): Promise<boolean> => {
  const sig = await locationSig(segments)
  if (!sig) return false
  await warmAll()
  const local = _warmCache.get(sig)
  return !!local && Object.keys(local).length > 0
}

/**
 * Write the viewport snapshot for the layer at `segments` (empty = root).
 * Merge-by-field: pass only the parts you want to update. Pass `null`
 * to clear the whole viewport for that location.
 *
 * Writes land ONLY in the sign('viewport') pool. A clear also drops any
 * legacy `__viewport__` entry for the same sig — a user-intent clear
 * must not resurrect through the union hydrate on the next boot.
 *
 * Broadcasts `viewport:persisted` ({ segments, snapshot }) so caches can
 * refresh their mirror of this location's viewport.
 */
export const writeViewportAt = async (
  segments: readonly string[],
  snapshot: ViewportSnapshot | null,
): Promise<void> => {
  const dir = await viewportPool()
  const sig = await locationSig(segments)
  if (!dir || !sig) return

  // Ensure the warm mirror is hydrated before merging against it.
  await warmAll()
  const merged = await serialize(async (): Promise<ViewportSnapshot | null> => {
    if (snapshot === null) {
      _warmCache.delete(sig)
      try { await dir.removeEntry(sig) } catch { /* already absent */ }
      // Drop the legacy copy too (drain source) — cleared means cleared.
      try { await (await legacyViewportDir())?.removeEntry(sig) } catch { /* absent / drained */ }
      return null
    }
    // Merge over existing so partial writes (just pan, just zoom) don't
    // wipe the untouched fields. The warm mirror IS the existing state —
    // it was hydrated from disk at boot and every write lands here first.
    const existing: ViewportSnapshot = _warmCache.get(sig) ?? {}
    const next: ViewportSnapshot = { ...existing, ...snapshot }
    _warmCache.set(sig, next)
    const fh = await dir.getFileHandle(sig, { create: true })
    const writable = await fh.createWritable()
    try { await writable.write(JSON.stringify(next)) }
    finally { await writable.close() }
    return next
  })

  EffectBus.emit('viewport:persisted', { segments: [...segments], snapshot: merged })
}
