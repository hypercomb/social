// hypercomb-essentials/.../presentation/tiles/sources/logical-config.source.ts
//
// The logical-config contributor — the missing CONSUME side of #62.
//
// The DCP installer owns the registry and posts its MATERIALIZED logical
// install to the hive as a snapshot (RegistrySnapshotStore): the union of
// (default ⊕ enabled domain refs) = the participant's own always-on data +
// the adopted/enabled set, rooted at `logicalRootSig`. Until now the hive
// CACHED that snapshot but never rendered from it, so adopting/enabling in
// the installer (or coming back to solo from a swarm) had no effect on what
// hypercomb.io showed.
//
// This source closes that loop: it reads the snapshot's `logicalRootSig`,
// walks that materialized tree to the current location by child name, and
// contributes the location's children as tiles. So hypercomb.io REFLECTS the
// current configuration — the adopted tiles appear in solo.
//
// Bytes: the logical layers resolve through the ContentBroker (local OPFS →
// host → mesh) — the same path every sig uses. Fail-open: no snapshot yet
// (installer hasn't projected) → []. show-cell unions by (kind, name) and
// dedupes against the locally-owned set, so this only ADDS config tiles the
// hive doesn't already have.
//
// Kind: 'peer' for now — it rides show-cell's existing non-local render +
// navigate path (the adopted set is "from elsewhere" until the participant
// makes it their own). A dedicated 'logical' kind with persisted treatment is
// the follow-up.

import type { LocationContext, TileEntry, TileSource } from '../tile-source.types.js'
import { TILE_SOURCE_REGISTRY_KEY } from '../tile-source-registry.js'

const SNAPSHOT_KEY = '@hypercomb.social/RegistrySnapshot'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

interface SnapshotStoreLike { readonly snapshot: { readonly logicalRootSig: string | null } | null }
interface BrokerLike { fetchBySig: (sig: string, type: string) => Promise<Uint8Array | null> }
interface LayerLike { name?: string; cells?: unknown[]; layers?: unknown[]; children?: unknown[] }

const SIG_RE = /^[a-f0-9]{64}$/i

/** A layer's child sigs — `cells` is canonical, `layers`/`children` legacy
 *  (mirrors layer-graph-resolver's acceptance order). */
const childSigsOf = (layer: LayerLike | null): string[] => {
  if (!layer) return []
  const arr = Array.isArray(layer.cells) ? layer.cells
    : Array.isArray(layer.layers) ? layer.layers
    : Array.isArray(layer.children) ? layer.children
    : []
  return arr.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
}

export const logicalConfigSource: TileSource = async (
  loc: LocationContext,
): Promise<readonly TileEntry[]> => {
  const ioc = (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc
  const store = ioc?.get?.(SNAPSHOT_KEY) as SnapshotStoreLike | undefined
  const rootSig = store?.snapshot?.logicalRootSig
  if (!rootSig || !SIG_RE.test(rootSig)) return []
  const broker = ioc?.get?.(BROKER_KEY) as BrokerLike | undefined
  if (!broker?.fetchBySig) return []

  const resolveLayer = async (sig: string): Promise<LayerLike | null> => {
    try {
      const bytes = await broker.fetchBySig(sig, 'layer')
      if (!bytes) return null
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
      return parsed && typeof parsed === 'object' ? (parsed as LayerLike) : null
    } catch { return null }
  }

  // Walk the materialized logical tree down to the current location by name.
  let layer = await resolveLayer(rootSig)
  if (!layer) return []
  for (const seg of loc.segments) {
    let next: LayerLike | null = null
    for (const csig of childSigsOf(layer)) {
      const cl = await resolveLayer(csig)
      if (cl?.name === seg) { next = cl; break }
    }
    if (!next) return []   // this location isn't in the logical config
    layer = next
  }

  // Contribute the children at this location.
  const out: TileEntry[] = []
  for (const csig of childSigsOf(layer)) {
    const cl = await resolveLayer(csig)
    const name = typeof cl?.name === 'string' ? cl.name.trim() : ''
    if (name) out.push({ name, kind: 'peer', source: {} })
  }
  return out
}

// Self-register. The literal `window.ioc.register(` line is the side-effects
// barrel pickup (scripts/prepare.ts — see tile-source-registry.ts:100-111);
// whenReady defers wiring into the TileSourceRegistry until that singleton
// exists, so barrel import order doesn't matter.
window.ioc.register('@hypercomb.social/LogicalConfigSource', logicalConfigSource)
window.ioc.whenReady(TILE_SOURCE_REGISTRY_KEY, (reg) =>
  (reg as { register: (s: TileSource) => void }).register(logicalConfigSource),
)
