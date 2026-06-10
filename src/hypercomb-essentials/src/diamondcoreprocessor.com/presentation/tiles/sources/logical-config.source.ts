// hypercomb-essentials/.../presentation/tiles/sources/logical-config.source.ts
//
// The logical-config contributor — the missing CONSUME side of #62.
//
// The DCP installer owns the registry and posts a snapshot of it to the hive
// (RegistrySnapshotStore, persisted across reloads). Until now the hive
// CACHED that snapshot but never rendered from it, so adopting in the
// installer (or coming back to solo from a swarm) had no effect on what
// hypercomb.io showed.
//
// This source closes the loop by mounting the snapshot's ADOPTED BRANCHES:
// each branch is (domain, name, branchSig, at) — e.g. dolphin adopted into
// jwize.com at the root. At location `at` the branch's NAME appears as a
// tile; beneath it the branch's tree is walked layer-by-layer via the
// ContentBroker (local OPFS → host/relay → mesh). Branch roots are fetchable
// anywhere — they came from a host in the first place — unlike the DCP's
// internal `logicalRootSig` layer, which lives only in the installer's OPFS.
//
// Fail-open: no snapshot / no branches → []. show-cell unions by (kind,
// name) and dedupes against the locally-owned set, so this only ADDS config
// tiles the hive doesn't already have.
//
// Kind: 'peer' for now — it rides show-cell's existing non-local render +
// navigate path (the adopted set is "from elsewhere" until the participant
// makes it their own). A dedicated 'logical' kind with persisted treatment is
// the follow-up.

import type { LocationContext, TileEntry, TileSource } from '../tile-source.types.js'
import { TILE_SOURCE_REGISTRY_KEY } from '../tile-source-registry.js'

const SNAPSHOT_KEY = '@hypercomb.social/RegistrySnapshot'
const BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'

interface SnapshotBranch { domain: string; name: string; branchSig: string; at: string[]; enabled?: boolean }
interface SnapshotStoreLike { readonly snapshot: { readonly branches?: SnapshotBranch[] } | null }
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
  const branches = store?.snapshot?.branches
  if (!Array.isArray(branches) || branches.length === 0) return []
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

  const segs = loc.segments
  const out: TileEntry[] = []

  for (const b of branches) {
    // The participant's master switch: only ENABLED branches mount — solo
    // reflects "the features that are on". Absent field (older snapshot) =
    // enabled, so a stale persisted snapshot doesn't hide everything.
    if (b?.enabled === false) continue
    const sig = String(b?.branchSig ?? '').trim().toLowerCase()
    const name = String(b?.name ?? '').trim()
    if (!SIG_RE.test(sig) || !name) continue
    const at = Array.isArray(b.at) ? b.at.map(s => String(s ?? '').trim()).filter(Boolean) : []

    // Case 1 — we are AT the adopt location: the branch itself is a tile.
    if (segs.length === at.length && at.every((s, i) => s === segs[i])) {
      out.push({ name, kind: 'peer', source: {} })
      continue
    }

    // Case 2 — we are INSIDE the branch: [...at, name, ...rest]. Walk the
    // branch tree by the remaining segment names and contribute that node's
    // children.
    const mount = [...at, name]
    const inside = segs.length >= mount.length && mount.every((s, i) => s === segs[i])
    if (!inside) continue
    const rest = segs.slice(mount.length)

    let layer = await resolveLayer(sig)
    for (const seg of rest) {
      if (!layer) break
      let next: LayerLike | null = null
      for (const csig of childSigsOf(layer)) {
        const cl = await resolveLayer(csig)
        if (cl?.name === seg) { next = cl; break }
      }
      layer = next
    }
    if (!layer) continue

    for (const csig of childSigsOf(layer)) {
      const cl = await resolveLayer(csig)
      const childName = typeof cl?.name === 'string' ? cl.name.trim() : ''
      if (childName) out.push({ name: childName, kind: 'peer', source: {} })
    }
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
