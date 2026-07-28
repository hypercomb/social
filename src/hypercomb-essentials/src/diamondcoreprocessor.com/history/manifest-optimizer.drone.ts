// diamondcoreprocessor.com/history/manifest-optimizer.drone.ts
//
// First implementation of the processor's optimize phase (derived-cache
// contract — see Bee.optimize in @hypercomb/core). Children manifests
// were historically written inline by commitLayer on a microtask,
// coupling a pure derived cache to the commit path. Now commitLayer
// just emits 'content:wrote' (kind 'layer') as it always has; this bee
// queues the sig and, when the processor reaches the idle optimize
// phase, derives the manifest — every child sig resolved to its layer,
// the array written into the sign('manifests') pool keyed by the
// PARENT LAYER SIG.
//
// The key choice is the addressing direction: the manifest is keyed BY
// the layer sig it derives from, so invalidation is automatic — a
// changed children set is a NEW layer sig with no manifest yet, and the
// stale record is simply never consulted again. Old manifests keyed by
// old layer sigs stay valid for rewind/time-travel and are GC-safe.
//
// Complete-or-absent: a partial manifest fails the reader's length
// check on every future load, forcing the slow per-child path that
// drops not-yet-cached children — the two-stage render bug. A missing
// manifest is fine: resolveChildNames backfills a complete one once all
// children are warm. Nothing here is ever load-bearing.

import { Drone } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

// ONE FILE PER LAYER, AND IT CARRIES THE VISUALS. The manifest was already
// the layer's full child array (name, branch-status, every slot) — but it
// stopped at the child LAYERS, so painting the layer still meant resolving
// each child's properties blob and then each blob's image: N more reads per
// layer, every visit (measured: 213 resource reads to repaint a 10-tile page
// the participant had just left). The optimization is per LAYER, not per
// image: an entry now carries the child's resolved `props` and its `visual`
// (the ≤512px webp the atlas actually decodes, inlined), so a location paints
// from exactly TWO reads — the layer, and this array — and the preloader warms
// a layer with the same two.
//
// Entries stay backward-compatible: `props`/`visual` are optional, and a
// manifest written before this (or one whose child had no image) simply falls
// back to the per-child resolution it always used.
type ManifestVisual = {
  /** Source image sig — the atlas key, unchanged, so a pack-fed decode and a
   *  file-fed decode are the same pixels under the same identity. */
  sig: string
  /** Optimized bytes, base64. Absent when the source is already small enough
   *  that optimizing buys nothing — the reader falls back to the raw sig. */
  webp?: string
  type?: string
}
type ManifestEntry = {
  sig: string
  layer: { name?: string; [k: string]: unknown }
  props?: Record<string, unknown>
  visual?: ManifestVisual
}
type ManifestStore = {
  writeChildrenManifest?: (parentSig: string, manifest: ManifestEntry[]) => Promise<void>
  getResourceLocal?: (sig: string) => Promise<Blob | null>
  getOptimizedVisual?: (sourceSig: string) => Promise<Blob | null>
  optimizeVisual?: (sourceSig: string, raw: Blob) => Promise<void>
}

const SIG_RE = /^[0-9a-f]{64}$/

/** Base64 of a blob's bytes — the inlining step. Chunked so a large image
 *  can't blow the argument limit of String.fromCharCode. */
const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** The image a tile paints: `properties[0]` → `props.small.image` (or the
 *  flattened shape). The same chain the render path walks per child — walked
 *  ONCE here so the render never has to. */
const imageSigOf = (props: Record<string, unknown> | undefined): string | null => {
  const p = props as { small?: { image?: unknown }; flat?: { small?: { image?: unknown } } } | undefined
  const img = p?.flat?.small?.image ?? p?.small?.image
  return typeof img === 'string' && SIG_RE.test(img) ? img : null
}

export class ManifestOptimizerDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'derives children manifests for committed layers during the optimize phase'

  protected override listens = ['content:wrote']

  // parent layer sig → child sigs, queued at commit, drained on optimize
  #pending = new Map<string, string[]>()

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string; bytes: ArrayBuffer }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig || !e.bytes) return
      try {
        const layer = JSON.parse(new TextDecoder().decode(e.bytes)) as { children?: unknown }
        const children = Array.isArray(layer.children)
          ? layer.children.filter((c): c is string => typeof c === 'string')
          : []
        if (children.length > 0) this.#pending.set(e.sig, children)
      } catch { /* non-JSON layer bytes — nothing to derive */ }
    })
  }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = get('@hypercomb.social/Store') as ManifestStore | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!store?.writeChildrenManifest || !history) return

    const batch = [...this.#pending.entries()]
    this.#pending.clear()

    for (const [parentSig, childSigs] of batch) {
      const manifest: ManifestEntry[] = []
      for (const sig of childSigs) {
        const child = await history.getLayerBySig(sig)
        if (!child) break
        manifest.push({ sig, layer: child, ...await this.#visualFor(child, store) })
      }
      if (manifest.length === childSigs.length) {
        await store.writeChildrenManifest(parentSig, manifest)
      }
    }
  }

  /**
   * Build the full array for a parent whose children are already resolved —
   * the same entries `optimize()` writes, exposed so the render-path backfill
   * mints ENRICHED packs too. Without this, every layer that predates the
   * visuals-in-the-pack change would keep re-writing a thin manifest and pay
   * per-tile reads forever.
   *
   * Returns null unless EVERY child produced an entry: complete-or-absent.
   */
  public readonly buildEntries = async (
    childSigs: readonly string[],
    childLayers: ReadonlyArray<{ name?: string; [k: string]: unknown }>,
  ): Promise<ManifestEntry[] | null> => {
    const store = get('@hypercomb.social/Store') as ManifestStore | undefined
    if (!store || childSigs.length !== childLayers.length) return null
    const out: ManifestEntry[] = []
    // MINTING IS BUDGETED. Building a rendition is a decode + re-encode, and a
    // layer of a dozen never-optimized images is a visible stall if it all
    // happens in one pass (measured: a first visit paying 229 mints held the
    // paint for 4.5s). Mint a few per pass; the rest keep a sig-only visual
    // and the next pass — idle, or the background warm — takes the next few.
    // Partial visual coverage is legal: every entry falls back per tile.
    const budget = { mints: ManifestOptimizerDrone.#MINTS_PER_PASS }
    for (let i = 0; i < childSigs.length; i++) {
      const layer = childLayers[i]
      if (!layer?.name) return null
      out.push({ sig: childSigs[i], layer, ...await this.#visualFor(layer, store, budget) })
    }
    return out
  }

  /** Renditions minted per enrich pass — see buildEntries. */
  static readonly #MINTS_PER_PASS = 6

  /**
   * Heal ONE layer's pack: build the full array and write it. Called by the
   * preloader when its warm finds a names-only manifest, so the whole hive
   * heals in the background instead of only the layers someone happens to
   * visit. The write lives HERE (this drone owns manifest writing) and is
   * complete-or-absent like every other mint. Returns the entries it wrote so
   * the caller can adopt their visuals immediately.
   */
  public readonly enrichPack = async (
    parentSig: string,
    childSigs: readonly string[],
    childLayers: ReadonlyArray<{ name?: string; [k: string]: unknown }>,
  ): Promise<ManifestEntry[] | null> => {
    // A budgeted pass leaves some entries sig-only, so one attempt per layer
    // would strand them. Allow a few passes — each takes the next few
    // renditions — and stop there so a layer whose images simply can't be
    // optimized doesn't re-mint forever.
    const attempts = (this.#enriched.get(parentSig) ?? 0) + 1
    if (attempts > ManifestOptimizerDrone.#MAX_ENRICH_PASSES) return null
    this.#enriched.set(parentSig, attempts)
    const store = get('@hypercomb.social/Store') as ManifestStore | undefined
    if (!store?.writeChildrenManifest) return null
    const entries = await this.buildEntries(childSigs, childLayers)
    if (!entries) return null
    await store.writeChildrenManifest(parentSig, entries)
    return entries
  }

  /** Parent sig → enrich passes spent on it this session. */
  readonly #enriched = new Map<string, number>()

  /** How many budgeted passes a layer's pack may take before we stop trying —
   *  enough to finish a normal layer's renditions, few enough that images
   *  which simply can't be optimized stop costing anything. */
  static readonly #MAX_ENRICH_PASSES = 4

  /** Does this pack still need enriching? True when an entry carries a child
   *  that HAS properties but no resolved visual — i.e. a manifest written
   *  before the visuals moved into it. */
  public static readonly packNeedsVisuals = (
    pack: ReadonlyArray<{ layer?: { [k: string]: unknown }; visual?: unknown }>,
  ): boolean => pack.some(e => !e?.visual && Array.isArray(e?.layer?.['properties']) && (e.layer['properties'] as unknown[]).length > 0)

  /** Everything needed to BIND the child's visual, resolved once and inlined:
   *  its properties blob and the optimized bytes of the image those properties
   *  point at. Best-effort in every direction — a child whose props or image
   *  aren't local yet contributes nothing extra and the reader falls back to
   *  the per-child path for that one entry. Never throws into the mint: an
   *  incomplete visual must not cost the layer its manifest. */
  readonly #visualFor = async (
    child: { name?: string; [k: string]: unknown },
    store: ManifestStore,
    budget?: { mints: number },
  ): Promise<{ props?: Record<string, unknown>; visual?: ManifestVisual }> => {
    try {
      const getLocal = store.getResourceLocal
      if (!getLocal) return {}
      const propsSigs = Array.isArray(child['properties']) ? child['properties'] as unknown[] : []
      const propsSig = propsSigs.find((s): s is string => typeof s === 'string' && SIG_RE.test(s))
      if (!propsSig) return {}
      const propsBlob = await getLocal(propsSig)
      if (!propsBlob) return {}
      let props: Record<string, unknown>
      try { props = JSON.parse(await propsBlob.text()) as Record<string, unknown> } catch { return {} }
      const imageSig = imageSigOf(props)
      if (!imageSig) return { props }
      // Prefer the optimized rendition; mint it here (optimize phase, the
      // sanctioned place) when it doesn't exist yet, so the FIRST visit after
      // a commit already has it. Falling back to the raw bytes would inline
      // megabytes — the pack carries a sig-only reference instead and the
      // atlas reads the source file for that one image.
      let optimized = await store.getOptimizedVisual?.(imageSig) ?? null
      if (!optimized && store.optimizeVisual && (!budget || budget.mints > 0)) {
        const raw = await getLocal(imageSig)
        if (raw) {
          if (budget) budget.mints--
          await store.optimizeVisual(imageSig, raw)
          optimized = await store.getOptimizedVisual?.(imageSig) ?? null
        }
      }
      if (!optimized || optimized.size > ManifestOptimizerDrone.#MAX_INLINE_BYTES) {
        return { props, visual: { sig: imageSig } }
      }
      return {
        props,
        visual: { sig: imageSig, webp: await blobToBase64(optimized), type: optimized.type || 'image/webp' },
      }
    } catch { return {} }
  }

  /** Per-image inlining ceiling. The optimized rendition is ~6KB; anything
   *  well past that is a sign the source resisted optimization, and a pack
   *  that swells to megabytes stops being one cheap read. Over the ceiling the
   *  entry keeps the sig and the atlas reads that one file itself. */
  static readonly #MAX_INLINE_BYTES = 64 * 1024
}

const _manifestOptimizer = new ManifestOptimizerDrone()
window.ioc.register('@diamondcoreprocessor.com/ManifestOptimizerDrone', _manifestOptimizer)
