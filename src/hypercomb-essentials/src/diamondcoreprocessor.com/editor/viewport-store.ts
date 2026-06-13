// diamondcoreprocessor.com/editor/viewport-store.ts
//
// Viewport storage — per-location zoom / pan / meshOffset, keyed by the
// location SIGNATURE in a flat, non-history OPFS store at
// `__viewport__/<sig>`.
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

import { EffectBus } from '@hypercomb/core'
import type { ViewportSnapshot } from '../navigation/zoom/zoom.drone.js'
import { ROOT_NAME } from '../history/history.service.js'
import { readTilePropertiesAt } from './tile-properties.js'

export type { ViewportSnapshot }

const VIEWPORT_DIR = '__viewport__'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

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

// ── flat OPFS store ────────────────────────────────────────────────
// One directory at the OPFS root, one file per location signature.
// Direct handle access (no service-worker round-trip, no Store
// coupling). The handle is resolved lazily and cached.

let _dir: Promise<FileSystemDirectoryHandle | null> | null = null
const viewportDir = (): Promise<FileSystemDirectoryHandle | null> =>
  (_dir ??= (async () => {
    try {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(VIEWPORT_DIR, { create: true })
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
// In-memory mirror of the whole `__viewport__/` directory, hydrated ONCE
// at module load (boot). Doctrine: data is warmed at boot and navigation
// reads from cache — render must never wait on a per-location OPFS read.
// The directory is tiny (one small JSON per visited location), so one
// enumeration covers everything; `writeViewportAt` keeps the mirror
// coherent afterwards. The only read that can ever wait is the very
// first one at boot (root), and it waits on this single enumeration —
// not a per-location fetch.

const _warmCache = new Map<string, ViewportSnapshot>()
let _warmed: Promise<void> | null = null
const warmAll = (): Promise<void> =>
  (_warmed ??= serialize(async () => {
    const dir = await viewportDir()
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
  }))

// Hydrate at module load so the cache is warm before first navigation.
void warmAll()

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
 * Write the viewport snapshot for the layer at `segments` (empty = root).
 * Merge-by-field: pass only the parts you want to update. Pass `null`
 * to clear the whole viewport for that location.
 *
 * Broadcasts `viewport:persisted` ({ segments, snapshot }) so caches can
 * refresh their mirror of this location's viewport.
 */
export const writeViewportAt = async (
  segments: readonly string[],
  snapshot: ViewportSnapshot | null,
): Promise<void> => {
  const dir = await viewportDir()
  const sig = await locationSig(segments)
  if (!dir || !sig) return

  // Ensure the warm mirror is hydrated before merging against it.
  await warmAll()
  const merged = await serialize(async (): Promise<ViewportSnapshot | null> => {
    if (snapshot === null) {
      _warmCache.delete(sig)
      try { await dir.removeEntry(sig) } catch { /* already absent */ }
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
