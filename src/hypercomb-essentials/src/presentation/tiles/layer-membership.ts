// layer-membership.ts — WHICH TILES A LAYER HOLDS. A branch of the tile
// renderer (documentation/tile-renderer-tree.md): a parent layer's `children`
// are signatures; this resolves them to the names the renderer paints, and
// learns on the way which of them are branches. It holds no renderer state —
// the history service is its only source.

import type { HistoryService, LayerContent } from '../../history/history.service.js'
import { adoptPackedVisual, type PackedVisualEntry } from './packed-visuals.js'

// Render-path diagnostics are opt-in (localStorage 'hc:diag' = '1').
const DIAG = (() => { try { return localStorage.getItem('hc:diag') === '1' } catch { return false } })()

/**
 * Resolve a parent layer's `children` (sigs) into a Set of child
 * display names.
 *
 * Each child layer lives in the CHILD's lineage sigbag `<childLocSig>/`
 * (at the flat OPFS root; legacy `__history__/<childLocSig>` is a
 * read-fallback), not the parent's. We don't have a sig→name index, so the only way
 * to map a sig back to a name is to enumerate the parent's on-disk
 * children, compute each child's lineage sig, list that bag's markers,
 * and check if any marker sig matches the parent's `children` entry.
 *
 * Names whose sig matches → "allowed" in this historical layer.
 * Children that have been deleted from disk can't be resolved (no
 * lineage to query) and silently drop out — known limitation of the
 * current design (no global sig→name lookup).
 */
/**
 * Resolve a parent layer's `children` (sigs) to display names.
 *
 * Mechanical: each sig in `content.children` is a content-addressed
 * pointer to a child layer's bytes. The preloader (HistoryService.
 * getLayerBySig) returns the layer for that sig; its `name` field
 * is the child's display name. No bag scanning, no schema variants,
 * no name-based fallbacks — just sig→content lookup.
 *
 * Sigs that don't resolve are dropped silently (the layer was never
 * registered in the cache and isn't on disk anywhere).
 */
// Memo: child head sig → does that head have children. A child's head sig
// only changes when the child (or its own children) change, so a stable
// subtree costs one head-index lookup per render, never a layer reparse.
const branchByHeadSig = new Map<string, boolean>()

export async function resolveChildNames(
  history: HistoryService,
  parentSegments: readonly string[],
  _parentDir: FileSystemDirectoryHandle | null,
  content: { children?: string[] } | null,
  parentLayerSig?: string,
  // Optional out-param. The caller reads `expected` (child-sig count) vs
  // `resolved` (sigs that produced a name) to decide whether this pass
  // saw the COMPLETE child set. A resolution where resolved < expected is
  // partial — the renderer must NOT paint it (the two-stage load). Counts
  // resolved SIGS, not unique names, so duplicate child names never read
  // as "incomplete". `unresolvedSigs` lists the FULL child sigs that did
  // not produce a name this pass — the completeness gate paints these as
  // explicit unavailable-placeholders once its retry budget is spent,
  // instead of silently dropping the tiles.
  stats?: {
    expected: number
    resolved: number
    unresolvedSigs?: string[]
  },
  // Optional out-param: child NAMES that are branches (have their own
  // children). Derived from each child's `children` array LENGTH — one level
  // down, never loading grandchildren — from the SAME manifest / per-child
  // resolution that produces names. Lets the render get name + branch-status
  // from a single read and DELETE the separate per-child branchSet walk that
  // re-loaded every child on every frame.
  branchesOut?: Set<string>,
  // Optional out-param: set `cold=true` when a child's branch-STATUS could not
  // be read this pass because its head-layer bytes weren't pooled yet (a
  // TRANSIENT cold miss, NOT a leaf). The caller uses this to avoid memoizing
  // an incomplete branch set and to schedule a re-render — never to conclude
  // "not a branch", which would poison the tile's navigability.
  branchStats?: { cold: boolean },
  // Only the pass that is PAINTING may heal this layer's pack. Healing means
  // decoding and re-encoding the source images, and prepareView runs over the
  // whole warmed neighbourhood (up to 512 layers, 12-wide) — letting it heal
  // turned a background warm into a whole-hive re-encode that raced first
  // paint. The layer you are looking at heals; the ones you might visit wait
  // for the optimize phase.
  options?: {
    mayUpgradePack?: boolean
    onBranchesFreshened?: (branches: Set<string>) => void
  },
): Promise<Set<string>> {
  const out = new Set<string>()
  if (stats) {
    stats.expected = content?.children?.length ?? 0
    stats.resolved = 0
  }
  if (!content?.children?.length) return out

  // Branch-status (does a child have its OWN children?) must come from the
  // child's CURRENT head, not the parent's stored child sig — per-page
  // history leaves that sig stale, so a child that gained grandchildren since
  // the parent last committed would otherwise show no branch dot. Path-address
  // each child by name and read its head's children length. branchesOut only
  // gets fresh adds now; the stale parent-sig derivation is gone.
  const readFreshBranches = async (names: Iterable<string>): Promise<{ branches: Set<string>; cold: boolean }> => {
    const branches = new Set<string>()
    let cold = false
    await Promise.all([...names].map(async (name) => {
      try {
        const childLocSig = await history.sign({ explorerSegments: () => [...parentSegments, name] })
        const headSig = await history.latestMarkerSigFor(childLocSig, name)
        // No head marker = the child never committed a layer of its own = an
        // authoritative leaf. NOT a cold miss — don't flag the pass cold, or a
        // leaf-heavy layer would retry forever.
        if (!headSig) return
        let hasChildren = branchByHeadSig.get(headSig)
        if (hasChildren === undefined) {
          const head = await history.getLayerBySig(headSig)
          if (!head) {
            // TRANSIENT cold-pool miss: the head sig exists but its bytes
            // aren't pooled yet. getLayerBySig returns null here EXACTLY as it
            // does for a genuine absence (history.service.ts getLayerBySig), so
            // we must NOT conclude "no children" — and, critically, must NOT
            // cache that false into the module-global branchByHeadSig. Doing so
            // poisoned the branch dot for the whole session: the tile painted
            // as a non-branch, so #onPointerDown/#onClick routed its click to
            // the 'open' editor action instead of navigating in — locking the
            // user out of the child branch until a full reload. Leave it
            // unresolved and flag the pass cold so the caller re-renders once
            // the neighbourhood warms.
            cold = true
            return
          }
          const kids = (head as { children?: unknown } | null)?.children
          hasChildren = Array.isArray(kids) && kids.length > 0
          branchByHeadSig.set(headSig, hasChildren)
        }
        if (hasChildren) branches.add(name)
      } catch {
        // A read threw mid-resolution — transient. Leave the dot off for now
        // and flag cold so the caller retries; never cache a false.
        cold = true
      }
    }))
    return { branches, cold }
  }

  // A current-layer pack already contains each direct child's layer. Names and
  // branch flags therefore come from that ONE read. Per-child path/head checks
  // are only a repair for old packs whose ancestor sig was not propagated; they
  // must never sit between a navigation gesture and paint. Run the repair at
  // idle and ask the owner to repaint only when a complete fresh result differs.
  const freshenBranchesAfterPaint = (names: Iterable<string>): void => {
    if (!options?.onBranchesFreshened) return
    const snapshot = [...names]
    const run = () => {
      void readFreshBranches(snapshot).then(({ branches, cold }) => {
        if (branchStats) branchStats.cold = cold
        if (!cold) options.onBranchesFreshened?.(branches)
      }).catch(() => {
        if (branchStats) branchStats.cold = true
      })
    }
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
    if (typeof ric === 'function') ric(run, { timeout: 4_000 })
    else setTimeout(run, 0)
  }

  // Children manifest fast-path. When the parent's sig is known, try
  // the sign('manifests') pool keyed by <parentSig> (via
  // Store.readChildrenManifest; legacy __manifests__/ is a read-fallback)
  // — a single file read returns the resolved
  // child layer objects with names already inlined. Skips the per-child
  // getLayerBySig walk entirely on cold load. Falls through to the
  // signature-resolution path on miss; the optimize phase mints a fresh
  // manifest after every commit so subsequent reads stay hot. This is a
  // READER: the paint never writes the cache (see the enqueue below).
  const store = parentLayerSig
    ? (window as any).ioc?.get?.('@hypercomb.social/Store') as {
        readChildrenManifest?: (sig: string) => Promise<Array<{ sig: string; layer: { name?: string; children?: string[] } }> | null>
      } | undefined
    : undefined

  if (parentLayerSig && store?.readChildrenManifest) {
    const manifest = await store.readChildrenManifest(parentLayerSig)
    if (manifest && manifest.length !== content.children.length) {
      console.warn(`[diag:childres] MANIFEST STALE parent=${parentLayerSig.slice(0, 12)} manifestLen=${manifest.length} childrenLen=${content.children.length} -> falling to per-child`)
    }
    if (manifest && manifest.length === content.children.length) {
      if (DIAG) console.info(`[diag:childres] MANIFEST HIT parent=${parentLayerSig.slice(0, 12)} len=${manifest.length}`)
      // Manifest is current iff it covers every child sig in the parent.
      // Trust it: extract names directly, no bag walk. ALSO seed each
      // inlined child layer into HistoryService's parsed cache — the
      // render path immediately follows with per-child getLayerBySig
      // calls (branch detection), and without the seed every one of
      // them is a cold pool read on refresh; a single missing pool
      // entry would then join the multi-second preloadAllBags scan.
      const seed = (history as { seedParsedLayer?: (sig: string, layer: object) => void }).seedParsedLayer
      let resolvedCount = 0
      const manifestUnresolved: string[] = []
      for (const entry of manifest) {
        // Bind the visuals from the pack itself — this array IS the layer's
        // optimization, so every image it carries is decoded from here and
        // never re-read per tile. Keyed by the SOURCE image sig, so the atlas
        // identity is identical to the file-fed path.
        adoptPackedVisual(entry as PackedVisualEntry)
        if (entry?.layer?.name) {
          out.add(entry.layer.name)
          if (branchesOut && Array.isArray(entry.layer.children) && entry.layer.children.length > 0) {
            branchesOut.add(entry.layer.name)
          }
          resolvedCount++
          if (seed && entry.sig) seed.call(history, entry.sig, entry.layer)
        } else if (entry?.sig) {
          manifestUnresolved.push(entry.sig)
        }
      }
      // Manifest hit only reaches here when manifest.length === children
      // length, so a fully-named manifest IS the complete set.
      if (stats) {
        stats.resolved = resolvedCount
        stats.unresolvedSigs = manifestUnresolved
      }
      // UPGRADE A THIN PACK. Manifests written before the visuals moved in
      // carry names only, so this layer would keep paying per-tile reads on
      // every visit forever. Re-mint it once, off the render path — the next
      // visit paints from the pack. Once per parent sig per session; keyed by
      // an immutable content sig, so a successful upgrade is permanent.
      // Render pass only — see `options.mayUpgradePack`.
      if (options?.mayUpgradePack) upgradeThinPack(parentLayerSig, manifest, content.children)
      freshenBranchesAfterPaint(out)
      return out
    }
  }

  // Pure signature resolution. For each child sig in the parent's
  // layer, fetch that child's LayerContent — its `name` field is the
  // child's display name. NO folder-name lookups, NO seed-by-name
  // pre-warming. Names live inside the signed bytes, not on the
  // filesystem. getLayerBySig is content-addressed: hot from the
  // preloader cache after warmup, cold-walks bags by sig if missed.
  // Fired in parallel — every call is independent, and a single cold
  // miss serializing the whole list was the dominant per-frame cost.
  const children = await Promise.all(
    content.children.map(sig => history.getLayerBySig(sig)),
  )
  const __nullSigs: string[] = []
  let __resolvedCount = 0
  for (let __i = 0; __i < children.length; __i++) {
    const child = children[__i]
    if (child?.name) {
      out.add(child.name); __resolvedCount++
      if (branchesOut && Array.isArray(child.children) && child.children.length > 0) {
        branchesOut.add(child.name)
      }
    }
    else if (content.children[__i]) __nullSigs.push(content.children[__i])
  }
  if (stats) {
    stats.resolved = __resolvedCount
    stats.unresolvedSigs = [...__nullSigs]
  }
  if (__nullSigs.length > 0) {
    console.warn(`[diag:childres] PERCHILD parent=${(parentLayerSig || 'EMPTY').slice(0, 12)} children=${content.children.length} resolved=${out.size} NULL=${__nullSigs.length} nullSigs=[${__nullSigs.map(s => s.slice(0, 12)).join(', ')}]`)
  } else if (DIAG) {
    console.info(`[diag:childres] PERCHILD parent=${(parentLayerSig || 'EMPTY').slice(0, 12)} children=${content.children.length} all-resolved=${out.size}`)
  }

  // (see upgradeThinPack, declared below the resolver)

  // Backfill the manifest for pre-existing layers committed before the
  // decoration shipped (or after a manifest GC) — but ONLY when EVERY
  // child resolved this pass. A PARTIAL manifest (missing the children
  // that were cold) has manifest.length < content.children.length, so the
  // read-side guard (manifest.length === content.children.length) rejects
  // it on the next load and drops to the per-child path AGAIN — the
  // two-stage render perpetuates itself forever. Writing only COMPLETE
  // manifests lets the first fully-warm pass heal the layer so every
  // subsequent load is a single manifest read with all children present.
  // Idle-scheduled so the current render path doesn't pay the write.
  // THE PAINT DOES NOT WRITE THE CACHE. It says which parent needs one, and
  // the optimize phase mints it — enriched, budgeted, on the next idle pass
  // (optimize-phase.md rule 1; manifest-optimizer.drone.ts is the one door).
  // Until it lands, the render resolves per child exactly as it just did.
  const allResolved = children.length === content.children.length && children.every(c => !!c?.name)
  if (parentLayerSig && allResolved) manifestOptimizer()?.enqueue?.(parentLayerSig, content.children)

  freshenBranchesAfterPaint(out)
  return out
}

/** Parent sigs whose pack this session already tried to enrich — one attempt
 *  each, so a layer whose children have no local images doesn't re-mint on
 *  every visit. */
const _packUpgradeTried = new Set<string>()

/** Re-mint a names-only manifest as a full pack (props + optimized visual per
 *  child), off the render path. Silent no-op when the pack is already rich,
 *  when the optimizer isn't registered, or when the re-mint can't complete —
 *  the thin pack stays valid, it just keeps costing per-tile reads. */
/** The optimizer's one door, when it is registered. */
const manifestOptimizer = (): {
  enqueue?: (parentSig: string, childSigs: readonly string[]) => void
  constructor?: { packNeedsVisuals?: (p: ReadonlyArray<unknown>) => boolean }
} | undefined =>
  (window as any).ioc?.get?.('@diamondcoreprocessor.com/ManifestOptimizerDrone')

function upgradeThinPack(
  parentLayerSig: string,
  manifest: Array<{ sig: string; layer: { name?: string; [k: string]: unknown }; visual?: unknown }>,
  childSigs: readonly string[],
): void {
  if (!parentLayerSig || _packUpgradeTried.has(parentLayerSig)) return
  const optimizer = manifestOptimizer()
  if (!optimizer?.enqueue) return
  const needs = optimizer.constructor?.packNeedsVisuals
  if (needs && !needs(manifest)) return
  _packUpgradeTried.add(parentLayerSig)
  // The next idle pass re-mints the pack with visuals; the thin pack stays
  // valid until then, and the visit after that binds from one file.
  optimizer.enqueue(parentLayerSig, childSigs)
}
