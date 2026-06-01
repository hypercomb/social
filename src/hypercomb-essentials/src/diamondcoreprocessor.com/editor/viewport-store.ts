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

// ── Public API ─────────────────────────────────────────────────────

/**
 * Read the viewport snapshot for the layer at `segments` (empty = root).
 * Returns `{}` when nothing is saved yet.
 */
export const readViewportAt = async (
  segments: readonly string[],
): Promise<ViewportSnapshot> => {
  const dir = await viewportDir()
  const sig = await locationSig(segments)
  if (!dir || !sig) return {}
  return serialize(async () => {
    try {
      const fh = await dir.getFileHandle(sig)
      const text = await (await fh.getFile()).text()
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' ? (parsed as ViewportSnapshot) : {}
    } catch {
      return {}
    }
  })
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

  const merged = await serialize(async (): Promise<ViewportSnapshot | null> => {
    if (snapshot === null) {
      try { await dir.removeEntry(sig) } catch { /* already absent */ }
      return null
    }
    // Merge over existing so partial writes (just pan, just zoom) don't
    // wipe the untouched fields.
    let existing: ViewportSnapshot = {}
    try {
      const fh = await dir.getFileHandle(sig)
      const parsed = JSON.parse(await (await fh.getFile()).text())
      if (parsed && typeof parsed === 'object') existing = parsed as ViewportSnapshot
    } catch { /* none yet */ }
    const next: ViewportSnapshot = { ...existing, ...snapshot }
    const fh = await dir.getFileHandle(sig, { create: true })
    const writable = await fh.createWritable()
    try { await writable.write(JSON.stringify(next)) }
    finally { await writable.close() }
    return next
  })

  EffectBus.emit('viewport:persisted', { segments: [...segments], snapshot: merged })
}
