// history/manifest-optimizer.drone.ts
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

import { Drone, isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'
import { ACTIVE_GENOME_KEY, ActiveGenomeService } from './active-genome.service.js'

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
  /** A layer's bytes ON THIS DEVICE, meta envelopes followed — never a host fetch. */
  getLayerBytes?: (sig: string) => Promise<Uint8Array | null>
  /** The bytes stored under exactly this sig on this device — an envelope is NOT followed. */
  getLayerLocalBytes?: (sig: string) => Promise<Uint8Array | null>
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

  protected override listens = ['content:wrote', 'content:arrived', 'broker:fetched', 'adopt:progress', 'adopt:done']

  // parent layer sig → child sigs, queued at commit, drained on optimize
  #pending = new Map<string, string[]>()

  // A COLD CHILD KEEPS ITS PARENT WAITING (incident 2026-10-11/12). The pass
  // clears #pending before it starts, and a parent whose child layer was not
  // local yet used to be dropped for good: that parent never got a children
  // manifest, so the search index read its children as leaves and `find betz /`
  // answered a confident "not found" for /dolphin/associates/betz. A cold child
  // is "couldn't see yet", never "isn't there", so the parent waits here with
  // the children it still lacks:
  //  - it goes back in the queue while passes keep finding MORE of its
  //    children (an adopted page lands a few layers at a time). Only a pass
  //    that finds none new counts, and #MAX_STALLED_PASSES of those in a row
  //    PARK it: out of the queue, said once at debug level, so a child that
  //    never arrives costs no pass;
  //  - an ANNOUNCED ARRIVAL wakes it: a layer it lacks announced by
  //    content:arrived (the Store's host heal, the broker's "host learned"),
  //    content:wrote (a commit), broker:fetched (a mesh fetch) or
  //    adopt:progress (the adopt walk, whose fetches persist without a
  //    content:arrived) puts it back in the queue with a fresh count, parked
  //    or not; adopt:done does that for every waiter (2026-10-12). A burst of
  //    acts can use up its passes before the bytes land; an announced arrival
  //    still reaches it. Bytes that land unannounced (a quiet walk) wake
  //    nothing — the next ask (enqueue) starts the count over.
  // `missing` holds what the parent waits ON: each cold child slot, and the
  // layer its local META ENVELOPE points at (2026-10-12) — the slot is cold
  // when that target is, and every arrival that heals it names the target.
  // Memory only, and bounded: past #MAX_WAITING the longest waiter is
  // forgotten, and the next paint that finds no manifest asks again.
  #waiting = new Map<string, { children: string[]; missing: Set<string>; found: number; stalls: number }>()
  static readonly #MAX_STALLED_PASSES = 5
  static readonly #MAX_WAITING = 256
  /** Envelope hops followed to a slot's target. An envelope never wraps an
   *  envelope, so anything past this is malformed and the walk stops. */
  static readonly #MAX_ENVELOPE_HOPS = 4

  // ONE PASS AT A TIME (2026-10-11/12). The processor clears its flag when a
  // run STARTS, so an act() landing mid-pass starts a second run while the
  // first is still minting. That run took the parents the first had just put
  // back and judged them again before anything could land. A pass that starts
  // while one runs now waits for it — and they COALESCE (2026-10-12): at most
  // one pass waits, and every call made while it waits joins it. Otherwise a
  // burst of acts during a long pass queued a pass each, and they ran
  // back-to-back once it ended, each one a stall, parking a parent in a tick.
  #pass: Promise<void> = Promise.resolve()
  #queued: Promise<void> | null = null

  constructor() {
    super()
    this.onEffect<{ sig: string; kind: string; bytes: ArrayBuffer }>('content:wrote', e => {
      if (e?.kind !== 'layer' || !e.sig || !e.bytes) return
      this.#wake(e.sig)
      try {
        const layer = JSON.parse(new TextDecoder().decode(e.bytes)) as { children?: unknown }
        const children = Array.isArray(layer.children)
          ? layer.children.filter((c): c is string => typeof c === 'string')
          : []
        if (children.length > 0) this.#pending.set(e.sig, children)
      } catch { /* non-JSON layer bytes — nothing to derive */ }
    })
    this.onEffect<{ sig: string; kind: string }>('content:arrived', e => {
      if (e?.kind === 'layer' && e.sig) this.#wake(e.sig)
    })
    // The broker's own landings (2026-10-12): persisted, never re-announced
    // as content:arrived. Both fire after the bytes are written.
    this.onEffect<{ sig: string; type: string }>('broker:fetched', e => {
      if (e?.type === 'layer' && e.sig) this.#wake(e.sig)
    })
    this.onEffect<{ sig: string }>('adopt:progress', e => {
      if (e?.sig) this.#wake(e.sig)
    })
    this.onEffect('adopt:done', () => this.#wake())
  }

  /**
   * THE ONE DOOR. Anything that learns a parent needs a manifest — a paint
   * that found none, a thin pack that could be enriched — says so HERE, and
   * the optimize phase mints it on the next idle pass. Nothing else writes a
   * children manifest (optimize-phase.md: a derived cache is minted in the
   * phase, never on the render path). Idempotent: the latest child list for
   * a parent wins, and a parent with no children is not queued.
   */
  public readonly enqueue = (parentSig: string, childSigs: readonly string[]): void => {
    const parent = String(parentSig ?? '').toLowerCase()
    if (!SIG_RE.test(parent)) return
    const children = childSigs.map(c => String(c ?? '').toLowerCase()).filter(c => SIG_RE.test(c))
    if (children.length === 0) return
    this.#pending.set(parent, children)
    this.#waiting.delete(parent) // asked again: a waiting parent's count starts over
  }

  /** How many parents are waiting for the next pass — for a test, or a status line. */
  public get pendingCount(): number { return this.#pending.size }

  public override optimize = (): Promise<void> => {
    if (this.#queued) return this.#queued // a pass already waits: join it
    const queued = this.#pass.then(this.#startPass, this.#startPass)
    this.#queued = queued
    this.#pass = queued.catch(() => { /* a failed pass never blocks the next */ })
    return queued
  }

  /** The waiting pass begins: a call from here on queues the next one. */
  readonly #startPass = (): Promise<void> => {
    this.#queued = null
    return this.#runPass()
  }

  readonly #runPass = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = get('@hypercomb.social/Store') as ManifestStore | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!store?.writeChildrenManifest || !history) return

    const batch = [...this.#pending.entries()]
    this.#pending.clear()

    // Budgeted here too. A batch is however many layers were committed since
    // the last idle pass, and an unbudgeted pass would re-encode every image
    // under all of them in one go — the same stall buildEntries budgets away.
    const budget = { mints: ManifestOptimizerDrone.#MINTS_PER_PASS }
    for (const [parentSig, childSigs] of batch) {
      // Every child layer must be HERE before any entry is built. Resolving
      // first keeps complete-or-absent, and a parent that cannot be written
      // this pass spends none of the shared mint budget on its warm children.
      // EVERY child is read, not just up to the first cold one (2026-10-11/12):
      // a waiting parent's progress, and the arrivals that wake it, are the
      // whole set.
      const layers: Array<ManifestEntry['layer'] | null> = []
      for (const sig of childSigs) layers.push(await this.#localLayer(sig, history, store))
      const missing = childSigs.filter((_, i) => !layers[i])
      if (missing.length > 0) {
        const awaited = new Set<string>()
        for (const sig of missing) for (const s of await this.#awaitedFor(sig, store)) awaited.add(s)
        this.#stall(parentSig, childSigs, missing.length, awaited)
        continue
      }
      this.#waiting.delete(parentSig)
      const manifest: ManifestEntry[] = []
      for (let i = 0; i < childSigs.length; i++) {
        const layer = layers[i]!
        manifest.push({ sig: childSigs[i], layer, ...await this.#visualFor(layer, store, budget) })
      }
      await store.writeChildrenManifest(parentSig, manifest)
    }
  }

  /** A child layer, read LOCAL ONLY (2026-10-11/12): the parsed cache, then the
   *  bytes on this device. getLayerBySig on a miss asks the host — a network
   *  fetch from a derived-cache pass, and a waiting parent would repeat it
   *  every pass it comes back for. It is called only once the bytes are known
   *  to be here, so the layer is hydrated as every reader sees it, from a local
   *  hit. A store without the local reader keeps the old read. */
  readonly #localLayer = async (
    sig: string,
    history: HistoryService,
    store: ManifestStore,
  ): Promise<ManifestEntry['layer'] | null> => {
    const warm = history.peekLayerBySig(sig)
    if (warm) return warm
    if (store.getLayerBytes) {
      const here = await store.getLayerBytes(sig).catch(() => null)
      if (!here?.byteLength) return null
    }
    return history.getLayerBySig(sig).catch(() => null)
  }

  /** What a cold child slot waits ON (2026-10-12): the slot, and — since the
   *  Life write boundary put META ENVELOPES in child slots — every layer its
   *  local envelope points through. getLayerBytes follows the envelope, so the
   *  slot is cold when its TARGET is, and the heal that brings it names the
   *  target (getLayerBySig fetches through the envelope), never the slot.
   *  Local reads only, bounded by #MAX_ENVELOPE_HOPS. */
  readonly #awaitedFor = async (sig: string, store: ManifestStore): Promise<string[]> => {
    const awaited = [sig]
    for (let hop = 0; hop < ManifestOptimizerDrone.#MAX_ENVELOPE_HOPS && store.getLayerLocalBytes; hop++) {
      const bytes = await store.getLayerLocalBytes(awaited[awaited.length - 1]).catch(() => null)
      if (!bytes?.byteLength) break
      let target: string | null = null
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes))
        const payload = isMetaEnvelope(parsed) ? metaPayloadOf(parsed) : null
        if (payload?.kind === 'layer') target = payload.sig
      } catch { /* not JSON — not an envelope */ }
      if (!target || awaited.includes(target)) break
      awaited.push(target)
    }
    return awaited
  }

  /** A parent this pass could not write. A newer list queued DURING the pass
   *  (enqueue, content:wrote) is left to be judged on its own pass. Otherwise
   *  the parent waits: back in the queue, or, after #MAX_STALLED_PASSES passes
   *  in a row that found none of its children new, parked until one arrives.
   *  A parent sig names its children, so its list never changes while it waits. */
  readonly #stall = (parentSig: string, childSigs: string[], missingCount: number, awaited: Set<string>): void => {
    if (this.#pending.has(parentSig)) return
    const found = childSigs.length - missingCount
    const prior = this.#waiting.get(parentSig)
    const stalls = prior && found <= prior.found ? prior.stalls + 1 : 1
    this.#waiting.delete(parentSig) // set again so the map runs longest-waiting first
    this.#waiting.set(parentSig, { children: childSigs, missing: awaited, found, stalls })
    for (const longest of this.#waiting.keys()) {
      if (this.#waiting.size <= ManifestOptimizerDrone.#MAX_WAITING) break
      this.#waiting.delete(longest)
      this.#pending.delete(longest)
    }
    if (stalls >= ManifestOptimizerDrone.#MAX_STALLED_PASSES) {
      console.debug(`[manifest-optimizer] ${parentSig.slice(0, 12)}: ${missingCount} of ${childSigs.length} children not here after ${stalls} passes — parked until one arrives`)
      return
    }
    this.#pending.set(parentSig, childSigs)
  }

  /** A layer landed. Every waiting parent that lacks it goes back in the queue
   *  with a fresh count, parked or not, and the next pass reads what is here.
   *  No sig (an adopt walk ended, 2026-10-12) wakes every waiter — at most
   *  #MAX_WAITING. Waking only queues: a pass still runs only when an act()
   *  schedules one. */
  readonly #wake = (sig?: string): void => {
    for (const [parentSig, waiter] of this.#waiting) {
      if (sig !== undefined && !waiter.missing.has(sig)) continue
      waiter.stalls = 0
      if (!this.#pending.has(parentSig)) this.#pending.set(parentSig, waiter.children)
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

  /** ONE MINT AT A TIME, PROCESS-WIDE. Every mint is a full-size decode plus a
   *  webp encode; several in flight together (the neighbourhood warm runs
   *  12-wide, and a fast navigation stacks passes) peg the main thread and the
   *  GPU while the participant is waiting for tiles. The budget bounds how
   *  many a pass may take; this bounds how many happen at once. */
  static #mintChain: Promise<void> = Promise.resolve()
  static readonly #mintSerially = (work: () => Promise<void>): Promise<void> => {
    const next = ManifestOptimizerDrone.#mintChain.then(work, work)
    ManifestOptimizerDrone.#mintChain = next.catch(() => { /* never break the chain */ })
    return next
  }

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
          await ManifestOptimizerDrone.#mintSerially(() => store.optimizeVisual!(imageSig, raw))
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

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register(ACTIVE_GENOME_KEY, new ActiveGenomeService())

const _manifestOptimizer = new ManifestOptimizerDrone()
window.ioc.register('@diamondcoreprocessor.com/ManifestOptimizerDrone', _manifestOptimizer)
