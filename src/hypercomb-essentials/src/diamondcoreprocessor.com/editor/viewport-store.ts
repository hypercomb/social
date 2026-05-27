// diamondcoreprocessor.com/editor/viewport-store.ts
//
// Viewport storage — uniform read/write of zoom/pan/meshOffset for any
// location in the merkle tree, including root.
//
// Design
// ──────
// A location is identified by its lineage segments. The location's
// sigbag (`history.sign({segments})`) addresses the layer that holds
// canonical state for that position. The same `properties` slot used
// by `readTilePropertiesAt` / `writeTilePropertiesAt` carries
// arbitrary per-tile data — index, imageSig, tags, link, substrate.
// We add `viewport` as another field on that same bag.
//
// For root (segments=[]), `commitSlotSet([], 'properties', [sig])`
// commits to root layer's properties — no cascade because root has no
// parent. For sub-locations, the same call cascades up normally.
// One uniform API, no sentinel names, no synthetic child tiles.
//
// Importer contract
// ─────────────────
// `viewport` is just a field in the properties JSON. Anything that
// reads/writes tile properties already passes through this bag; an
// importer can drop the `viewport` key on import, or carry it through
// — caller's choice. No special filtering anywhere else.

import { EffectBus } from '@hypercomb/core'
import type { ViewportSnapshot } from '../navigation/zoom/zoom.drone.js'
import { ROOT_NAME } from '../history/history.service.js'

export type { ViewportSnapshot }

const VIEWPORT_FIELD = 'viewport'
const PROPERTIES_SLOT = 'properties'

const HISTORY_KEY   = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY     = '@hypercomb.social/Store'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

type HistoryServiceLike = {
  sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
  currentLayerAt?: (sig: string) => Promise<unknown>
}

type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
}

type LayerCommitterLike = {
  commitSlotSet?: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
}

const iocGet = <T>(key: string): T | undefined => {
  const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
  return ioc?.get?.(key) as T | undefined
}

/**
 * Resolve the signing-segments for a location. Root is named `/` so its
 * bag is `__history__/<sign('/')>/...`, addressed identically to every
 * other location ('a' is at `sign('a')`, 'a/b' is at `sign('a/b')`,
 * root is at `sign('/')`). Without this, root would collapse to
 * `sign('')` because history.sign's canonicalization filters empty
 * strings — a parallel sig-bag that nothing else uses.
 *
 * `ROOT_NAME` is imported from history.service so there's a single
 * source of truth for "what root's lineage name is" instead of every
 * subsystem hard-coding `'/'`.
 */
function signingSegments(segments: readonly string[]): readonly string[] {
  return segments.length === 0 ? [ROOT_NAME] : segments
}

/**
 * Read the full properties bag at a location. Returns `{}` for any of
 * the legitimate "no properties yet" states. Works for root (segments=[])
 * by signing as `['/']`.
 */
async function readPropertiesAtSegments(
  segments: readonly string[],
): Promise<Record<string, unknown>> {
  const history = iocGet<HistoryServiceLike>(HISTORY_KEY)
  const store   = iocGet<StoreLike>(STORE_KEY)
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {}

  const signSegs = signingSegments(segments)
  const sig = await history.sign({ explorerSegments: () => [...signSegs] })
  if (!sig) return {}

  const layer = await history.currentLayerAt(sig) as
    | { properties?: readonly unknown[] }
    | null
  const slot = Array.isArray(layer?.properties) ? layer!.properties : []
  const propSig = slot.length > 0 ? slot[0] : undefined
  if (typeof propSig !== 'string' || propSig.length === 0) return {}

  try {
    const blob = await store.getResource(propSig)
    if (!blob) return {}
    const text = await blob.text()
    const parsed = JSON.parse(text)
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {}
  } catch (err) {
    console.warn('[viewport-store] failed to parse properties resource', propSig, err)
    return {}
  }
}

/**
 * Write merged properties at a location. Reads existing properties,
 * merges `updates`, content-addresses, commits the new sig to the
 * `properties` slot at the given segments. For root (segments=[])
 * commitSlotSet is a single-layer commit with no cascade.
 */
async function writePropertiesAtSegments(
  segments: readonly string[],
  updates: Record<string, unknown>,
): Promise<void> {
  const history   = iocGet<HistoryServiceLike>(HISTORY_KEY)
  const store     = iocGet<StoreLike>(STORE_KEY)
  const committer = iocGet<LayerCommitterLike>(COMMITTER_KEY)
  if (!history?.sign || !store?.putResource || !committer?.commitSlotSet) return

  const existing = await readPropertiesAtSegments(segments)
  const merged: Record<string, unknown> = { ...existing, ...updates }
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k]
  }

  // Canonical key order so identical logical state produces identical
  // bytes and the resource store dedups.
  const sortedKeys = Object.keys(merged).sort()
  const canonical: Record<string, unknown> = {}
  for (const k of sortedKeys) canonical[k] = merged[k]
  const blob = new Blob([JSON.stringify(canonical)], { type: 'application/json' })
  const propSig = await store.putResource(blob)

  // Same segment policy as the reader: root commits to the `/` bag so
  // a future read at the same location resolves to the same sig.
  const commitSegs = signingSegments(segments)
  await committer.commitSlotSet(commitSegs, PROPERTIES_SLOT, [propSig])
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Read viewport snapshot for the layer at `segments`. Empty array =
 * root. Returns `{}` if the layer has no properties or no viewport
 * field yet.
 */
export const readViewportAt = async (
  segments: readonly string[],
): Promise<ViewportSnapshot> => {
  const props = await readPropertiesAtSegments(segments)
  const vp = props[VIEWPORT_FIELD]
  return (vp && typeof vp === 'object') ? vp as ViewportSnapshot : {}
}

/**
 * Write viewport snapshot for the layer at `segments`. Empty array =
 * root. Merge-by-field: pass only the parts you want to update.
 * Pass `undefined` for a sub-field to clear it; pass `null` or omit
 * the whole snapshot to clear the entire viewport.
 *
 * Broadcasts `viewport:persisted` for any cache that wants to drop
 * its mirror of this location's viewport.
 */
export const writeViewportAt = async (
  segments: readonly string[],
  snapshot: ViewportSnapshot | null,
): Promise<void> => {
  // Merge the new snapshot over any existing viewport so partial
  // writes (just pan, just zoom) don't wipe the unspecified fields.
  const existing = (await readViewportAt(segments)) ?? {}
  const merged: ViewportSnapshot | null = snapshot === null
    ? null
    : { ...existing, ...snapshot }
  await writePropertiesAtSegments(segments, { [VIEWPORT_FIELD]: merged })
  EffectBus.emit('viewport:persisted', { segments: [...segments], snapshot: merged })
}
