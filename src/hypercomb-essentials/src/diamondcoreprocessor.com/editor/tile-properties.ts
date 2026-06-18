// diamondcoreprocessor.com/editor/tile-properties.ts
//
// Tile properties — canonical per-tile attributes
// ================================================
// Each tile carries a small bag of stable per-instance properties — the
// values that identify the tile's place and look. The bag holds things
// like:
//   - `index: number` — slot in the AxialService spiral (the pinned-
//     layout position). Required for placement.
//   - `imageSig` — bootstrap atlas image, content-addressed (resolves
//     through the resource store).
//   - tags, hideText, link, substrate, etc.
//
// What does NOT belong here:
//   - Authoritative cross-peer state — that's the layer's job. Canonical
//     primitives (notes, children, etc.) sit in layer slots, not in the
//     properties bag.
//   - Decorations, conversation state, Q&A, comms, per-render computed
//     values — those live in the optimization substrate. Keeping
//     properties free of decorations preserves layer purity and lets
//     sig-based sync addressing stay stable across domains.
//
// ── Storage ──────────────────────────────────────────────────────────
//
// Properties live in the tile's own layer via a `properties` slot —
// `[sig]` pointing at a content-addressed JSON blob in the resource
// store. One sig per tile; a write produces a new content-addressed
// blob, and the slot's single entry is replaced with the new sig. The
// cascade folds the resulting layer-sig into every ancestor's
// `children` slot, producing one undoable / time-travelable marker per
// ancestor. Accessed via `readTilePropertiesAt` / `writeTilePropertiesAt`.
//
// ── The legacy 0000 API (`readCellProperties` / `writeCellProperties`) ─
//
// These functions take a `FileSystemDirectoryHandle` and read/write a
// `0000` JSON file inside it. The directory they expect — a per-tile
// dir under a content domain — IS NOT a legitimate OPFS structure in
// this architecture. The only legitimate hierarchy under any domain
// is the fixed system-folder set (`__history__`, `__layers__`,
// `__resources__`, `__dependencies__`, `__bees__`, …); per-tile dirs
// are phantom artifacts left by old callers that called
// `getDirectoryHandle('<tile-name>', { create: true })`. Tile
// membership lives in `layer.children` (signature arrays in the
// merkle tree), not in a directory listing.
//
// The legacy API stays callable while existing callers (15+ readers,
// 10+ writers) flip caller-by-caller to `readTilePropertiesAt` /
// `writeTilePropertiesAt`. Each flip removes one source of phantom-dir
// creation; once every caller is on the layer-slot API, the legacy
// pair and the per-tile dirs they touched both go away.
//
// ── Cache coherence ──────────────────────────────────────────────────
//
// Writes broadcast `cell:0000-changed` via EffectBus with the cell's
// cache key (the lineage signature returned by `cellLocationSig`).
// NurseBee subscribers invalidate their per-attribute caches in
// response. Both APIs emit the same event with the same key shape, so
// nurses keyed on layer sigs stay coherent regardless of which API
// the writer chose during migration.

import { EffectBus } from '@hypercomb/core'

export const TILE_PROPERTIES_FILE = '0000'

/**
 * The layer slot that holds the tile's properties resource sig. At most
 * one sig per tile; the sig points at a JSON blob in `__resources__/`
 * whose shape matches the legacy 0000 file.
 *
 * Registered with LayerSlotRegistry as a passive slot (`triggers: []`)
 * because writes go through `LayerCommitter.commitSlotSet` directly —
 * there's no EffectBus event whose subscribers need to fire. The
 * registry registration claims the slot name so collisions surface
 * immediately, and makes the slot discoverable to introspection /
 * diff / debug tooling.
 */
export const TILE_PROPERTIES_SLOT = 'properties'

// Register the slot once the registry is ready. Module load order is
// non-deterministic, so we use `whenReady` rather than a direct `get` —
// the registration fires exactly when the registry exists on ioc.
type LayerSlotRegistryLike = {
  register: (slot: { slot: string; triggers: readonly string[] }) => void
}
;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc?.whenReady?.(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (registry) => {
    try {
      (registry as LayerSlotRegistryLike).register({
        slot: TILE_PROPERTIES_SLOT,
        triggers: [],
      })
    } catch (err) {
      // Idempotent re-registration with the same name + payload is
      // safe; only a collision throws. Surface anything else so we
      // notice if another subsystem claims `properties` first.
      console.warn('[tile-properties] slot register failed:', err)
    }
  },
)

export const isSignature = (value: unknown): boolean =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

// ── Participant-local props index (`hc:tile-props-index`) ────────────
//
// A localStorage cache of tile → props-resource sig used by the render
// and editor fast paths (the canonical home is the layer's `properties`
// slot). Entries are keyed by the tile's FULL-LINEAGE signature — the
// same sigbag key the history bags use (`cellLocationSig`) — so two
// tiles sharing a leaf name at different hive locations can never read
// or clobber each other's assignment. Legacy entries keyed by bare
// label still exist from before this keying; readers fall back to them
// (shared across same-named locations, as they always were) but writers
// and removers touch ONLY the lineage-keyed entry, so the legacy
// cross-location blast radius is gone.

export const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'

export const readTilePropsIndex = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch { return {} }
}

export const writeTilePropsIndex = (index: Record<string, string>): void =>
  localStorage.setItem(TILE_PROPS_INDEX_KEY, JSON.stringify(index))

/**
 * Resolve a tile's props sig from the index: lineage-keyed entry first
 * (location-scoped), bare-label legacy entry as fallback. `lineageKey`
 * may be '' (history not registered yet) — then only the label is tried.
 */
export const lookupTilePropsSig = (
  index: Record<string, string>,
  lineageKey: string,
  label: string,
): string | undefined =>
  (lineageKey ? index[lineageKey] : undefined) ?? index[label]

/**
 * Lineage-signature for a single cell location.
 *
 * Delegates to HistoryService.sign — there is exactly ONE source of
 * truth for the sigbag in this codebase, and that is it. Computing the
 * sigbag any other way (different normalization, different join order,
 * different hash inputs) produces a different sig for the same logical
 * lineage, which makes readers and writers disagree on which bag to
 * touch. Disagreement = leakage = bugs that look like "the bag is
 * here but its contents are over there."
 *
 * The lineage signature is unique per location and stable as long as
 * the cell stays put — the address the inflate primitive and the
 * navigation primitive (visiting __history__/<sig>/) both consume.
 * Memoised inside HistoryService.sign via SignatureStore.signText.
 */
export const cellLocationSig = async (
  parentSegments: readonly string[],
  cellName: string,
): Promise<string> => {
  const history = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
    '@diamondcoreprocessor.com/HistoryService',
  ) as { sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string> } | undefined
  if (!history?.sign) {
    // History not registered yet (cold boot path). Return empty so the
    // caller skips its cache-keyed work; the next render after history
    // registers will pass through the canonical path.
    return ''
  }
  return history.sign({ explorerSegments: () => [...parentSegments, cellName] })
}

/**
 * Read and parse the 0000 properties JSON from a cell directory.
 * Returns empty object if file doesn't exist or can't be parsed.
 *
 * Missing file is silent (legitimate state for a freshly-created cell).
 * Corrupt or unreadable file logs a warning so the failure surfaces
 * instead of being indistinguishable from "no properties yet."
 */
export const readCellProperties = async (
  cellDir: FileSystemDirectoryHandle
): Promise<Record<string, unknown>> => {
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE)
  } catch {
    // file doesn't exist yet — legitimate state
    return {}
  }
  try {
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text)
  } catch (err) {
    console.warn('[tile-properties] failed to read/parse 0000 in', cellDir.name, err)
    return {}
  }
}

/**
 * Write properties JSON to a cell's 0000 file.
 * Merges with existing properties — pass only the fields to update.
 *
 * Broadcasts `cell:0000-changed` with the cell's cache key and the
 * names of the keys it touched. NurseBee subclasses (IndexNurse, etc.)
 * subscribe and invalidate their caches when their attribute is in
 * the changed set. This is the canonical write path — there are no
 * other writers — so the nurse cache stays coherent without anyone
 * else having to remember to invalidate.
 *
 * `cacheKey` MUST be the cell's lineage signature (see
 * `cellLocationSig`) — the same key the nurses are read with. The
 * legacy default (cellDir.name) collides across folders that share a
 * leaf name; any writer relying on the default is opting in to a
 * silent corruption of cross-folder cache state. Defaulted only so
 * the function stays callable from contexts that don't touch any
 * nurse-tended key.
 */
export const writeCellProperties = async (
  cellDir: FileSystemDirectoryHandle,
  updates: Record<string, unknown>,
  cacheKey?: string,
): Promise<void> => {
  const existing = await readCellProperties(cellDir)
  const merged = { ...existing, ...updates }
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
  EffectBus.emit('cell:0000-changed', {
    cacheKey: cacheKey ?? cellDir.name,
    keys: Object.keys(updates),
  })
}

// ── Layer-slot tile properties (canonical) ───────────────────────────
//
// `readTilePropertiesAt` / `writeTilePropertiesAt` read and write tile
// properties via the tile's own layer in the history bag. The merged
// properties object is content-addressed in the resource store; the
// tile's layer carries `properties: [sig]` referencing that blob.
//
// No directory handle anywhere. No per-tile dir consulted, queried,
// or minted. The lineage signature locates the tile's history bag,
// and the bag's head layer holds the property sig. That's the entire
// data path.
//
// Read path:
//     history.sign({segments}) → bag's <SB>
//     history.currentLayerAt(<SB>) → head layer JSON
//     layer.properties[0] → resource sig
//     store.getResource(sig) → JSON blob
//
// Write path:
//     read current properties (above) → merge updates →
//     store.putResource(json blob) → new resource sig
//     committer.commitSlotSet(segments, 'properties', [sig]) →
//     LayerCommitter cascades up to root, one marker per ancestor
//
// Both paths are domain-agnostic. When a tile's bag is canonical on
// DCP (markers + shared `__layers__` pool) the reader hits the marker
// and dereferences into the pool. When a bag is materialized on a
// content domain (`hypercomb.io/__history__/<SB>/<sig>` with bytes
// in-place), the reader gets the same layer JSON, and the resource
// sig in `properties[0]` resolves through the content-addressed pool
// regardless of which domain root that pool sits under.

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

const HISTORY_KEY   = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY     = '@hypercomb.social/Store'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'

const iocGet = <T>(key: string): T | undefined => {
  const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
  return ioc?.get?.(key) as T | undefined
}

/**
 * Read tile properties from the tile's layer.
 *
 * Resolves the cell's lineage sig → fetches the current layer at that
 * sig → reads `layer.properties[0]` → fetches the JSON resource → parses.
 * Returns `{}` for any of the legitimate "no properties yet" states
 * (fresh tile with no layer, layer with no properties slot, store not
 * ready). Logs a warning if the resource exists but fails to parse —
 * that's a real corruption signal worth surfacing.
 */
export const readTilePropertiesAt = async (
  parentSegments: readonly string[],
  cellName: string,
): Promise<Record<string, unknown>> => {
  const history = iocGet<HistoryServiceLike>(HISTORY_KEY)
  const store   = iocGet<StoreLike>(STORE_KEY)
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {}

  // Pass segments raw — `history.sign` is the single canonicalization
  // site (it does trim + empty-filter + join + hash). Pre-normalizing
  // here would be a parallel implementation that drifts the moment
  // the canonical site changes.
  const cellSig = await history.sign({
    explorerSegments: () => [...parentSegments, cellName],
  })
  if (!cellSig) return {}

  const layer = await history.currentLayerAt(cellSig) as
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
    console.warn('[tile-properties] failed to read/parse properties resource', propSig, err)
    return {}
  }
}

/**
 * Read just the tile's CANONICAL props sig — the `properties[0]` value in the
 * tile's head layer — without fetching/parsing the resource blob.
 *
 * This is the sig the participant-local index (`hc:tile-props-index`) stores.
 * Canonical is the source of truth and travels with the layer (history/OPFS);
 * the index is a per-device localStorage cache that show-cell + substrate read.
 * When a tile's image arrives via the layer (adopted / synced / authored on
 * another device, or after an index entry was cleared) the canonical slot has
 * the sig but the local index does not. Callers use this to SEED the index
 * from canonical so it is never missing for an imaged tile.
 *
 * Returns the 64-hex sig or undefined (no layer, no properties slot, history
 * not ready). Mirrors `readTilePropertiesAt`'s resolution; signing is memoised.
 */
export const readTilePropsSigAt = async (
  parentSegments: readonly string[],
  cellName: string,
): Promise<string | undefined> => {
  const history = iocGet<HistoryServiceLike>(HISTORY_KEY)
  if (!history?.sign || !history?.currentLayerAt) return undefined
  const cellSig = await history.sign({
    explorerSegments: () => [...parentSegments, cellName],
  })
  if (!cellSig) return undefined
  const layer = await history.currentLayerAt(cellSig) as
    | { properties?: readonly unknown[] }
    | null
  const slot = Array.isArray(layer?.properties) ? layer!.properties : []
  const propSig = slot.length > 0 ? slot[0] : undefined
  return (typeof propSig === 'string' && /^[0-9a-f]{64}$/.test(propSig)) ? propSig : undefined
}

/**
 * Write tile properties to the tile's layer.
 *
 * Reads current properties, merges `updates` over them (pass only the
 * fields to change), serialises the merged object as a JSON blob,
 * stores it as a content-addressed resource, then commits the resulting
 * sig as the new value of the cell's `properties` slot via
 * `LayerCommitter.commitSlotSet`. The cascade folds the new tile-layer
 * sig into every ancestor's `children` slot, producing one new marker
 * at each affected depth — undoable / time-travelable.
 *
 * Replacement semantics: every write produces a NEW content-addressed
 * sig (because the merged object's bytes differ), and `commitSlotSet`
 * replaces the entire slot. Identical merged content → identical sig
 * → `commitLayer`'s byte dedup → no-op. So writes are idempotent and
 * cheap on repeats.
 *
 * Broadcasts `cell:0000-changed` on completion for cache-coherence
 * with the existing nurse infrastructure. The cache key matches what
 * `cellLocationSig` produces, so nurses keyed on layer sigs stay
 * coherent during the migration regardless of which storage shape the
 * writer chose.
 */
export const writeTilePropertiesAt = async (
  parentSegments: readonly string[],
  cellName: string,
  updates: Record<string, unknown>,
): Promise<void> => {
  const history   = iocGet<HistoryServiceLike>(HISTORY_KEY)
  const store     = iocGet<StoreLike>(STORE_KEY)
  const committer = iocGet<LayerCommitterLike>(COMMITTER_KEY)
  if (!history?.sign || !store?.putResource || !committer?.commitSlotSet) return

  // No pre-normalization. Segments + cellName go raw into the canonical
  // signing site (`history.sign`, reached via `readTilePropertiesAt`
  // → `cellLocationSig`, and via the cascade's own sigbag computation
  // in `LayerCommitter`/`HistoryService`). Anything we trim/filter
  // here would be a parallel canonicalization that drifts from the
  // single source of truth the moment `history.sign` changes.
  const existing = await readTilePropertiesAt(parentSegments, cellName)
  const merged: Record<string, unknown> = { ...existing, ...updates }

  // Drop keys whose value is `undefined` — JSON.stringify would skip
  // them anyway, but dropping here keeps the merged object iterable
  // for downstream consumers that may inspect it before serialisation.
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k]
  }

  // Serialise + content-address. Deterministic key order so the same
  // logical properties yield the same sig across callers — same
  // canonicalization rule, applied to the JSON-object form: sorted
  // keys, then `JSON.stringify`. This produces the bytes that
  // `Store.putResource` hashes via `SignatureService.sign`.
  const sortedKeys = Object.keys(merged).sort()
  const canonical: Record<string, unknown> = {}
  for (const k of sortedKeys) canonical[k] = merged[k]
  const blob = new Blob([JSON.stringify(canonical)], { type: 'application/json' })
  const propSig = await store.putResource(blob)

  // commitSlotSet → committer.update → history.commitLayer → history.sign
  // — the same canonical signing path the readers use, so this write
  // lands in the same bag the next read will find.
  const cellSegments = [...parentSegments, cellName]
  await committer.commitSlotSet(cellSegments, TILE_PROPERTIES_SLOT, [propSig])

  EffectBus.emit('cell:0000-changed', {
    cacheKey: await cellLocationSig(parentSegments, cellName),
    keys: Object.keys(updates),
  })
}

/**
 * Standard: any property value that is a signature (64 hex chars)
 * refers to a blob in __resources__/{signature}. This function
 * resolves all signature values in a properties object to Blobs.
 */
export const resolveResourceSignatures = async (
  properties: Record<string, unknown>,
  getResource: (sig: string) => Promise<Blob | null>
): Promise<Map<string, Blob>> => {
  const resolved = new Map<string, Blob>()

  const walk = async (obj: unknown): Promise<void> => {
    if (!obj || typeof obj !== 'object') return

    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (isSignature(value)) {
        const sig = value as string
        if (!resolved.has(sig)) {
          const blob = await getResource(sig)
          if (blob) resolved.set(sig, blob)
        }
      } else if (typeof value === 'object' && value !== null) {
        await walk(value)
      }
    }
  }

  await walk(properties)
  return resolved
}
