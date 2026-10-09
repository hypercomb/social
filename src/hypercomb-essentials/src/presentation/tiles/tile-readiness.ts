// tile-readiness.ts — IS THE INSIDE OF THIS TILE READY? A branch of the tile
// renderer (documentation/tile-renderer-tree.md). A branch tile stays shaded
// until its click target is prepared: its direct children's bytes local, the
// destination's first paint prepared, their names and images baked into the
// atlases. Bright is a promise that the click is instant; dim means "you may
// go in, you will wait a moment" — a shaded tile stays clickable.
//
// This module owns that verdict and the work that earns it: the per-location
// memo (so a return paints bright on its first frame), the address the
// render pass stamped, the navigation generation that fences stale runs, the
// usage-ordered warm queue for missing bytes and the idle-sliced bake queue
// for the atlases, and the repair of a proof an atlas eviction broke. It
// paints nothing: the renderer writes the shade (the host).

import { cellLocationSig, isSignature, readTilePropsIndex, recoverableTileImageSig } from '../../editor/tile-properties.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'

// Render-path diagnostics are opt-in (localStorage 'hc:diag' = '1').
const DIAG = (() => { try { return localStorage.getItem('hc:diag') === '1' } catch { return false } })()

// Children-readiness shade — ON. A branch tile stays shaded (never inert —
// clicking it enters and redirects the preloader) until the exact view inside
// it is resident, releasing individually (most-used first). Bright means "the
// destination's first paint is already prepared"; dim means "you may go in,
// you will wait a moment."
//
// Its earlier bolt-on integration regressed because readiness derived from
// lineage reads that STRADDLE navigations (currentSig vs explorerSegments vs
// cursor) — wiped memos, stuck tiles. It is now driven from the render pass's
// OWN stamped address (stamp()). Escape hatch for debugging the plain
// own-image shade: localStorage 'hc:child-shade' = '0'.
export const CHILD_SHADE = (() => { try { return localStorage.getItem('hc:child-shade') !== '0' } catch { return true } })()

const CHILD_WARM_CONCURRENCY = 4

/** What the compute reads of a painted cell. */
export type ReadinessCell = { label: string; plain?: boolean; hasBranch?: boolean }

type ImageAtlasLike = {
  hasImage(sig: string): boolean
  hasFailed(sig: string): boolean
  loadImage(sig: string, blob: Blob): Promise<unknown>
  readonly capacity?: number
}
type LabelAtlasLike = {
  hasLabel(label: string): boolean
  seed(labels: string[]): void
  readonly capacity?: number
}

export interface ReadinessHost {
  imageAtlas(): ImageAtlasLike | null
  labelAtlas(): LabelAtlasLike | null
  /** The renderer's flat-image mode (which props field names a tile's image). */
  flat(): boolean
  /** Sigs concluded missing — shared with the image loader: never waited on again. */
  readonly fillMissed: Set<string>
  /** Sigs being fetched right now — shared with the image loader. */
  readonly hostFillInFlight: Set<string>
  /** A prepared destination's child names, by its head sig (the membership memo). */
  preparedNames(headSig: string): string[] | undefined
  /** A prepared destination's cells, by location key. */
  preparedCells(locationKey: string): readonly { imageSig?: string }[] | undefined
  /** Build a destination's first paint ahead of the click. */
  prepareView(headSig: string, segments: readonly string[]): Promise<boolean>
  /** The cheapest local bytes for an image sig. */
  decode(sig: string): Promise<Blob | null>
  /** The cells on screen. */
  renderedCells(): Iterable<{ imageSig?: string }>
  /** Repaint one tile's shade. */
  paintShade(label: string): void
  /** A tile was proven: paint it bright and say so. */
  released(label: string): void
  /** A tile lost its proof: stop any fade, paint it shaded, and say so. */
  revoked(label: string): void
  /** Publish which tiles are still preloading. */
  emitReadiness(): void
  /** Coalesce a readiness repaint. */
  scheduleRepaint(): void
}

export class TileReadiness {
  // Children-readiness state. `#childrenReadyByLabel`: label → all direct
  // children's images present-or-concluded. `#childImageSigsByParent`:
  // parent layer sig → child label → that child's grandchild image sigs
  // (structure is stable per parent sig, so it is resolved once and only
  // byte-PRESENCE is re-checked each pass).
  readonly #childrenReadyByLabel = new Map<string, boolean>()
  // Branch label → the HEAD sig its view was prepared under (this location).
  // Lets the label-atlas eviction handler find which released branch a
  // displaced child name belongs to, so its rasterisation can be repaired
  // during idle instead of at click time.
  readonly #preparedHeadByLabel = new Map<string, string>()
  readonly #childImageSigsByParent = new Map<string, Map<string, string[]>>()
  #childReadinessInFlight = false
  // Click targets that are BAKED — children's images in the image atlas, their
  // names in the label atlas. Bytes are not pixels: measured, a first entry
  // with every byte local still cost ~147ms, of which ~106ms was rasterising 8
  // labels and ~22ms decoding 8 images. Baked ahead, the same entry takes 12ms.
  //
  // KEYED BY THE TARGET'S HEAD SIG AND NEVER CLEARED. Content-addressed means
  // baked once is baked everywhere, permanently — the atlases are global, so
  // re-proving on the way back is pure loss. Keying this by LABEL and clearing
  // it per visit is exactly what made a back-navigation re-shade tiles that
  // were already resident.
  readonly #bakeQueue: { headSig: string; sigs: string[]; names: string[] }[] = []
  readonly #bakeQueued = new Set<string>()
  #bakePumping = false
  #readinessLocationKey = ''
  // THE PASS'S OWN ADDRESS, stamped by the render pass that produced the cells
  // and consumed verbatim by the readiness compute. Readiness must never
  // re-read lineage: currentSig, explorerSegments and the cursor update at
  // different moments, so a compute that reads them itself can straddle two
  // locations — which wiped the revisit memo and stranded tiles shaded. One
  // source, captured once, carried through.
  #passLocSig = ''
  #passParentSig = ''
  #passSegments: readonly string[] = []
  // Addresses of places already visited: path → location sig, location sig →
  // the head it was painted under. Lets a back-navigation seed its readiness
  // SYNCHRONOUSLY, before the first frame — resolving it asynchronously showed
  // as a flash of shade on a page that was already proven.
  readonly #locSigBySegments = new Map<string, string>()
  readonly #parentSigByLocSig = new Map<string, string>()
  // Readiness memo across visits, keyed by LOCATION (segments join — known
  // SYNCHRONOUSLY in the render pass, unlike the async parent sig): a
  // revisited page seeds ready on its FIRST frame when the exact target assets
  // are still resident. Each entry records the parentLayerSig it was proven
  // under — the compute drops it when the head moved, and seeding rejects only
  // targets whose own label/image slots were evicted.
  readonly #readyByLocation = new Map<string, {
    parentSig: string
    labels: Set<string>
    /** Branch label -> the exact prepared view and images whose residency
     *  earned readiness. This makes invalidation content-specific: an atlas
     *  eviction elsewhere cannot make Dolphin cold, while eviction of one of
     *  Dolphin's own names/images does. */
    targets: Map<string, { headSig: string; imageSigs: string[] }>
  }>()
  // Stable brightness per location visit. Ordinary props/branch churn cannot
  // dim a proven tile; only losing part of its exact prepared click target
  // revokes the proof until the repair bake restores it.
  readonly #brightLabels = new Set<string>()
  // Usage-ordered, bounded child-image warm queue. Missing child images are
  // fetched a few at a time IN PRIORITY ORDER — never a simultaneous blast —
  // so tiles complete (and un-shade) incrementally, most-used first.
  readonly #childWarmQueue: string[] = []
  readonly #childWarmQueued = new Set<string>()
  #childWarmActive = 0
  // Bumped on every `navigate`: an in-flight compute for the location the
  // user just LEFT is stale — it must stop (it holds the in-flight guard)
  // and above all must never SEED (seeding from a stale run wipes the
  // CURRENT location's released state — the "stuck shaded forever" bug).
  #readinessGen = 0
  #readinessNavHooked = false
  #computeRetryQueued = false
  /** Location keys already warned about a futile readiness working set. */
  #repairFutileWarned = new Set<string>()

  constructor(private readonly host: ReadinessHost) {}

  // ── what the renderer asks ──────────────────────────────────────────────────

  /** This branch's click target is proven ready. */
  isReady(label: string): boolean { return this.#childrenReadyByLabel.get(label) === true }
  /** Proven bright this visit (monotonic until its target is lost). */
  isBright(label: string): boolean { return this.#brightLabels.has(label) }
  markBright(label: string): void { this.#brightLabels.add(label) }
  /** A tile being added is not proven: it starts dim. */
  dim(label: string): void { this.#brightLabels.delete(label) }
  /** The segments the last pass stamped. */
  get passSegments(): readonly string[] { return this.#passSegments }

  /** The render pass's own address: the location sig that picked its
   *  content, the head whose children it will prove, the segments naming
   *  it. The compute reads THESE — never lineage. Remembered for a return,
   *  and the location's memo is seeded before the shade bits bake. */
  stamp(locSig: string, parentSig: string, segments: readonly string[]): void {
    this.#passLocSig = locSig
    this.#passParentSig = parentSig
    this.#passSegments = segments
    this.#rememberAddress(segments, locSig, parentSig)
    this.#seedChildReadinessForLocation(locSig)
  }

  /** PROMISE REPAIR, images. A branch that brightened made a promise — "the
   *  inside is decoded, the click is instant" — and an eviction can quietly
   *  break it. When the victim sig belongs to a PROVEN click target of the
   *  current location, withdraw the promise and re-queue it for an idle
   *  re-bake. Bytes remain local; the click is no longer instant until the
   *  pixels are resident again. */
  imageEvicted(victim: string | undefined): void {
    if (!victim || this.#childrenReadyByLabel.size === 0) return
    const entry = this.#readyByLocation.get(this.#readinessLocationKey)
    for (const [label, target] of entry?.targets ?? []) {
      if (this.#childrenReadyByLabel.get(label) !== true) continue
      if (!target.imageSigs.includes(victim)) continue
      this.#revokeReadinessForRepair(label)
      if (this.#readinessRepairFutile('image')) continue
      const names = this.host.preparedNames(target.headSig) ?? []
      this.#enqueueBake(target.headSig, target.imageSigs, names)
    }
  }

  /** PROMISE REPAIR, labels: a proven branch's child NAME displaced from the
   *  label atlas would make the next click rasterise it again (~13ms each —
   *  the single biggest click cost measured). Re-seed it during idle. */
  labelEvicted(victim: string | undefined): void {
    if (DIAG && victim?.startsWith('calf-')) {
      console.info(
        `[diag:readiness] label eviction victim=${victim} prepared=${this.#preparedHeadByLabel.size} key=${this.#readinessLocationKey.slice(0, 8)}`,
      )
    }
    if (!victim || this.#childrenReadyByLabel.size === 0) return
    for (const [branch, headSig] of this.#preparedHeadByLabel) {
      if (this.#childrenReadyByLabel.get(branch) !== true) continue
      const names = this.host.preparedNames(headSig) ?? []
      if (!names.includes(victim)) continue
      if (DIAG) console.info(`[diag:readiness] label eviction repair branch=${branch} victim=${victim}`)
      const target = this.#readyByLocation.get(this.#readinessLocationKey)?.targets.get(branch)
      this.#revokeReadinessForRepair(branch)
      if (this.#readinessRepairFutile('label')) return
      this.#enqueueBake(headSig, target?.imageSigs ?? [], names)
      return
    }
  }

  /** The renderer is going away: stop listening for navigation. */
  dispose(): void {
    window.removeEventListener('navigate', this.#onReadinessNavigate)
    this.#readinessNavHooked = false
  }

  // ── the verdict and the work that earns it ─────────────────────────────────

  /** Swap children-readiness state to this LOCATION (segments key — known
   *  synchronously in the render pass, unlike the async parent sig). A
   *  revisit seeds from the per-location memo so its FIRST bake paints
   *  bright when its exact target is still resident; a new or evicted target
   *  starts dim until proven, then releases incrementally, most-used first.
   *  Parent-sig validation (content changed ⇒ drop + re-verify) lives in the
   *  compute, which resolves the real head. */
  #seedChildReadinessForLocation(key: string): void {
    if (key === this.#readinessLocationKey) return
    this.#readinessLocationKey = key
    this.#childrenReadyByLabel.clear()
    this.#preparedHeadByLabel.clear()
    this.#brightLabels.clear()
    // The queue belongs to the location being left. What it actually BAKED
    // lives in the atlases, which are global and untouched — coming back asks
    // them again (#clickTargetResident) rather than re-doing the work.
    this.#bakeQueue.length = 0
    this.#bakeQueued.clear()
    const memo = this.#readyByLocation.get(key)
    // Validate each memo against its own click target. An unrelated atlas
    // eviction leaves this branch ready; losing one of this target's labels or
    // images revokes only this branch and queues its repair.
    if (memo) {
      const sigsByLabel = this.#childImageSigsByParent.get(memo.parentSig)
      for (const label of memo.labels) {
        const target = memo.targets.get(label)
        // Readiness without an exact click target is not proof. Older code
        // could mint such entries while a same-location head was changing;
        // ignoring them forces a clean recompute instead of releasing a branch
        // that has nothing recorded to validate or repair.
        if (!target) continue
        const names = this.host.preparedNames(target.headSig)
        const imageSigs = sigsByLabel?.get(label) ?? target.imageSigs
        // The proof was BYTES, and bytes don't leave. An atlas eviction between
        // visits costs a decode, not the promise — so a return releases from
        // the memo and merely re-warms what moved.
        this.#childrenReadyByLabel.set(label, true)
        this.#preparedHeadByLabel.set(label, target.headSig)
        if (names && !this.#clickTargetResident(names, imageSigs)) {
          this.#enqueueBake(target.headSig, [...imageSigs], [...names])
        }
      }
    }
    if (DIAG) console.info(
      `[diag:readiness] seed key=${key.slice(0, 8)} ` +
      `resident=${this.#childrenReadyByLabel.size}/${memo?.labels.size ?? 0}`,
    )
  }

  /** One deferred compute retry. A skipped or aborted readiness run must
   *  ALWAYS leave a trigger behind — without it, churny navigation (Lineage
   *  re-emits `navigate`) aborted every run and the location's tiles stayed
   *  shaded until some unrelated pass happened by (the "stuck shaded" bug). */
  #queueComputeRetry(): void {
    if (this.#computeRetryQueued) return
    this.#computeRetryQueued = true
    if (DIAG) console.info('[diag:readiness] retry queued')
    setTimeout(() => { this.#computeRetryQueued = false; this.host.scheduleRepaint() }, 250)
  }

  /** RE-SEED ON EVERY NAVIGATION, not only on cold render passes. The
   *  pass-stamp lives on the path that resolves a layer from scratch; a
   *  back-navigation takes the WARM path, which skipped it — so the readiness
   *  state stayed pointed at the location just left, its memo was never
   *  restored, and every tile re-shaded on the way back (the exact bug: "I
   *  navigate somewhere and then back and they're shaded out again").
   *  Content-addressed state means returning is free; it just has to be
   *  asked for. */
  #onReadinessNavigate = (): void => {
    this.#readinessGen++
    void this.#reseedReadinessFromNavigation()
  }

  /** Resolve a parent's direct-children image sigs (memoised per parent layer
   *  sig) and release each branch tile INCREMENTALLY — most-used first — the
   *  moment ALL its children's images are present locally or concluded
   *  (absent/failed — a permanently-missing child image can never strand its
   *  parent inert). Missing bytes go through a bounded, usage-ordered warm
   *  queue (never a simultaneous blast); each completion re-renders, so tiles
   *  brighten ONE BY ONE as their insides finish loading.
   *
   *  ONE LEVEL DOWN IS THE WHOLE PROOF. A click paints the direct children and
   *  nothing else, so that is all brightness claims — not the subtree, not the
   *  atlases' current contents. View preparation and atlas baking still run
   *  from here, in the background, to make that click faster. */
  compute = async (cells: readonly ReadinessCell[], parentSegments: readonly string[]): Promise<void> => {
    if (!CHILD_SHADE) return
    if (!this.#readinessNavHooked) {
      this.#readinessNavHooked = true
      try {
        window.addEventListener('navigate', this.#onReadinessNavigate)
      } catch { /* non-DOM */ }
    }
    if (!this.host.imageAtlas()) return
    // Same location, new content head: invalidate BEFORE filtering out labels
    // already marked ready. The previous ordering built branchCells first, so
    // every ready label was skipped and the later parent-sig check was
    // unreachable—the stale proof survived the edit and could not be repaired
    // after eviction.
    const stampedMemo = this.#passLocSig
      ? this.#readyByLocation.get(this.#passLocSig)
      : undefined
    if (
      stampedMemo
      && this.#passParentSig
      && stampedMemo.parentSig !== this.#passParentSig
    ) {
      this.#readyByLocation.delete(this.#passLocSig)
      this.#childrenReadyByLabel.clear()
      this.#preparedHeadByLabel.clear()
      this.#brightLabels.clear()
    }
    if (this.#childReadinessInFlight) {
      // A previous location's compute still holds the guard. Retry once it
      // frees — without this, the skip was permanent and the new location's
      // tiles stayed shaded forever (nothing else re-triggers the compute).
      this.#queueComputeRetry()
      return
    }
    const gen = this.#readinessGen
    // Do NOT filter on c.hasBranch here: the cells array at loadCellImages
    // time predates branch stamping, so every branch read as false and the
    // compute exited silently while the final bake (which DOES see hasBranch)
    // shaded them — tiles stayed shaded forever. Process every pending cell;
    // the grandkid map below decides: childless → trivially released.
    const branchCells = cells.filter(c =>
      !c.plain && this.#childrenReadyByLabel.get(c.label) !== true)
    if (branchCells.length === 0) return
    this.#childReadinessInFlight = true
    try {
      const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as {
        getResourceLocal: (sig: string) => Promise<Blob | null>
        getResource: (sig: string) => Promise<Blob | null>
        readChildrenManifest?: (sig: string) => Promise<Array<{ sig: string; layer: { name?: string; children?: string[] } }> | null>
      } | undefined
      const history = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as {
        getLayerBySig: (sig: string) => Promise<{ name?: string; children?: string[] } | null>
        latestMarkerSigFor?: (locSig: string, label: string) => Promise<string | undefined>
      } | undefined
      if (!store || !history?.latestMarkerSigFor || !history.getLayerBySig) return
      // THE PASS'S OWN ADDRESS — stamped with the cells, never re-read here.
      // Re-reading lineage was the whole disease: currentSig, explorerSegments
      // and the cursor settle at different moments, so a compute that read
      // them itself could describe a location the participant had already
      // left — wiping the revisit memo and stranding tiles shaded. If the pass
      // has not stamped yet (first frames), leave a retry behind.
      const locSig = this.#passLocSig
      const parentLayerSig = this.#passParentSig
      if (!locSig || !parentLayerSig) { this.#queueComputeRetry(); return }
      // COHERENCE GATE, now a same-source check: the cells handed to us must
      // belong to the stamped address. Compare SIGNATURES, not labels
      // (explorerLabel is a display label, not the segment slug — a label
      // comparison dead-locked every non-root location). Root has no segments
      // to derive from — skip.
      if (parentSegments.join('/') !== this.#passSegments.join('/')) { this.#queueComputeRetry(); return }
      if (parentSegments.length) {
        const locFromSegments = await cellLocationSig(
          parentSegments.slice(0, -1),
          parentSegments[parentSegments.length - 1],
        )
        if (locFromSegments !== locSig) { this.#queueComputeRetry(); return }
      }
      if (DIAG) console.info(`[diag:readiness] enter parent=${parentLayerSig.slice(0, 8)} pending=${branchCells.map(c => c.label).join(',')}`)

      // STALE-RUN GATE, before touching any shared state: if the user
      // navigated while we resolved the parent, this compute belongs to a
      // location they LEFT — seeding now would wipe the current location's
      // released state. Queue a retry so the live location's pass re-runs us.
      if (gen !== this.#readinessGen) { this.#queueComputeRetry(); return }
      // Label-keyed state must never leak across locations. Seed by the
      // LOCATION SIG (same source the render pass seeds with), then validate
      // the memo against the REAL parent sig: head moved ⇒ children may
      // differ ⇒ drop the memo and re-verify from scratch.
      const locKey = locSig
      this.#seedChildReadinessForLocation(locKey)
      const memoEntry = this.#readyByLocation.get(locKey)
      if (memoEntry && memoEntry.parentSig !== parentLayerSig) {
        this.#readyByLocation.delete(locKey)
        this.#childrenReadyByLabel.clear()
        this.#brightLabels.clear()
      }

      // ONE cheap read up front: the children manifest inlines each child's
      // own children (the grandchild sigs). Everything ELSE resolves PER
      // TILE, most-used first, below — so the first (most-used) tile's
      // release never waits on the whole level's resolution. A failure here
      const grandkidsByLabel = new Map<string, string[]>()
      // Child label → that child's own LAYER sig: the key its prepared view is
      // memoised under (see prepareView). Content-addressed, so the preparation
      // is valid globally and forever.
      const childLayerSigByLabel = new Map<string, string>()
      try {
        const manifest = store.readChildrenManifest ? await store.readChildrenManifest(parentLayerSig).catch(() => null) : null
        if (manifest) {
          for (const e of manifest) {
            const n = String(e.layer?.name ?? '')
            if (n) {
              grandkidsByLabel.set(n, Array.isArray(e.layer?.children) ? e.layer.children.map(String) : [])
              if (isSignature(String(e.sig ?? ''))) childLayerSigByLabel.set(n, String(e.sig))
            }
          }
        } else {
          const parent = await history.getLayerBySig(parentLayerSig)
          for (const cs of (Array.isArray(parent?.children) ? parent!.children : [])) {
            const cl = await history.getLayerBySig(String(cs))
            const n = String(cl?.name ?? '')
            if (cl && n) {
              grandkidsByLabel.set(n, Array.isArray(cl.children) ? cl.children.map(String) : [])
              if (isSignature(String(cs))) childLayerSigByLabel.set(n, String(cs))
            }
          }
        }
      } catch { /* unknown structure → fail-open below */ }
      const livePropsIndex: Record<string, string> = readTilePropsIndex()
      // Per-label sig cache under this parent (content-addressed → stable).
      let cachedSigs = this.#childImageSigsByParent.get(parentLayerSig)
      if (!cachedSigs) {
        cachedSigs = new Map<string, string[]>()
        this.#childImageSigsByParent.set(parentLayerSig, cachedSigs)
        if (this.#childImageSigsByParent.size > 64) {
          const oldest = this.#childImageSigsByParent.keys().next().value
          if (oldest !== undefined) this.#childImageSigsByParent.delete(oldest)
        }
      }

      // IN DISPLAY ORDER: check the pending branch tiles SERIALLY. A tile
      // whose children are all present/concluded is released IMMEDIATELY —
      // its own repaint, not one batch flip at the end — so tiles brighten
      // one by one. Misses enqueue in this same order. Nothing about which
      // tiles the participant opens is recorded or consulted (no tracking).
      for (const c of branchCells) {
        // Superseded by navigation — abort but ALWAYS leave a retry behind.
        if (gen !== this.#readinessGen) { this.#queueComputeRetry(); return }
        if (this.#childrenReadyByLabel.get(c.label) === true) continue
        // PER-TILE structure + presence in ONE bounded-parallel pass (8-way).
        // Strictly serial, a 145-child branch was ~435 sequential reads —
        // seconds before the tile could release. Cache the sig list only when
        // fully known (no cold props); a blocked build re-resolves next pass.
        let allReady = true
        let exactTargetImages: string[] | null = null
        const isBranchTarget =
          c.hasBranch === true || (grandkidsByLabel.get(c.label)?.length ?? 0) > 0
        const cached = cachedSigs.get(c.label)
        if (cached) {
          let i = 0
          await Promise.all(Array.from({ length: Math.min(8, cached.length) }, async () => {
            while (i < cached.length) {
              if (gen !== this.#readinessGen) return
              const sig = cached[i++]
              if (this.host.fillMissed.has(sig) || this.host.imageAtlas()?.hasFailed(sig)) continue // concluded → doesn't block
              const blob = await resolveLocalResourceReference(store, sig)
              if (!blob) { allReady = false; this.#enqueueChildWarm(sig) }
            }
          }))
        } else {
          const grandkids = grandkidsByLabel.get(c.label) ?? []
          const sigs: string[] = []
          let blocked = false
          const childSegments = [...parentSegments, c.label]
          let i = 0
          await Promise.all(Array.from({ length: Math.min(8, grandkids.length) }, async () => {
            while (i < grandkids.length) {
              if (gen !== this.#readinessGen) return
              const gSig = grandkids[i++]
              // ORPHAN GUARD: a layer we already CONCLUDED is absent can never
              // block anything again. Without this the tile below holds the
              // parent shaded forever on bytes that are never coming — the
              // same terminal-state rule every other miss here obeys.
              if (this.host.fillMissed.has(gSig)) continue
              const gl = await history.getLayerBySig(gSig)
              const gName = String(gl?.name ?? '')
              if (!gName) {
                // The child's LAYER itself is not here. Its bytes are what
                // makes the tile EXIST — without them the click opens onto a
                // view missing that tile entirely, which is exactly what the
                // shade promises can't happen. Hold the parent — but QUEUE the
                // layer, the way every other miss in this loop does. This used
                // to hold with nothing pending: no fetch, no retry, no arrival
                // to react to, so a branch missing one grandchild layer stayed
                // shaded for the rest of the session (an ORPHAN — the tile the
                // participant watches "never comes in"). The warm queue either
                // lands the bytes or CONCLUDES the sig, and both outcomes force
                // a readiness repaint that re-runs this pass.
                allReady = false
                blocked = true
                this.#enqueueChildWarm(gSig)
                continue
              }
              const key = await cellLocationSig(childSegments, gName)
              const propsSig = livePropsIndex[key] ?? livePropsIndex[gName]
              if (!propsSig || !isSignature(propsSig)) continue
              if (this.host.fillMissed.has(propsSig)) continue   // concluded-missing props → fail-open
              const pblob = await resolveLocalResourceReference(store, propsSig)
              if (!pblob) {
                // Props not local → the image sig is UNKNOWN. Hold the parent
                // and queue the props blob; re-resolve once it lands (or a
                // concluded miss releases it). Don't cache a blocked build.
                allReady = false
                blocked = true
                this.#enqueueChildWarm(propsSig)
                continue
              }
              try {
                const props = JSON.parse(await pblob.text())
                const img = recoverableTileImageSig(props, this.host.flat())
                if (typeof img === 'string' && isSignature(img)) {
                  sigs.push(img)
                  if (this.host.fillMissed.has(img) || this.host.imageAtlas()?.hasFailed(img)) continue
                  const blob2 = await resolveLocalResourceReference(store, img)
                  if (!blob2) { allReady = false; this.#enqueueChildWarm(img) }
                }
              } catch { /* skip malformed props */ }
            }
          }))
          if (!blocked) cachedSigs.set(c.label, sigs)
        }
        // Readiness is exactly the NEXT level, never the whole hierarchy. But
        // it includes that level's completed first-paint snapshot: bytes alone
        // still leave membership/order/atlas work at click time. A bright tile
        // proves its direct children are local, its view cache is optimized,
        // and the names/images needed immediately are resident. A shaded tile
        // remains clickable and navigation diverts the preloader to it.
        if (allReady && isBranchTarget) {
          // Prepare under the child's OWN HEAD sig — the key the render pass
          // will look the memo up by when the click lands. NOT the child sig
          // recorded in the parent's children[]: per-page history leaves that
          // one behind the moment the child commits anything of its own, so a
          // memo keyed by it silently never hits (measured: prepared, and the
          // click still cost 140ms).
          const childLocSig = await cellLocationSig(parentSegments, c.label)
          const childHeadSig = childLocSig
            ? (await history.latestMarkerSigFor(childLocSig, c.label)) ?? childLayerSigByLabel.get(c.label) ?? ''
            : childLayerSigByLabel.get(c.label) ?? ''
          if (!childHeadSig) {
            allReady = false
            this.#queueComputeRetry()
          } else {
            this.#preparedHeadByLabel.set(c.label, childHeadSig)
            const prepared = await this.host.prepareView(childHeadSig, [...parentSegments, c.label])
            if (!prepared) {
              allReady = false
              this.#queueComputeRetry()
            }
          }
          // BYTES ARE NOT PIXELS. Even with the view prepared and the bytes
          // local, the click still pays the atlases: rasterising the children's
          // NAMES (~106ms for 8, measured — the biggest single cost) and
          // decoding their images (~22ms for 8). Baked ahead, the same entry
          // took 12ms. So a branch is only bright once its click target is
          // baked; the bake runs sliced, in usage order, and both atlases are
          // keyed by name/sig — global and reusable, like everything else here.
          if (childHeadSig && allReady) {
            const names = this.host.preparedNames(childHeadSig) ?? []
            // Use the image signatures on the prepared destination cells—the
            // exact objects the click fast path will paint. The earlier
            // properties walk can legitimately differ (fallback substrate,
            // reference face, or a property that settled while preparing);
            // storing that approximation made a currently painted view appear
            // non-resident immediately after Back.
            const targetKey = [...parentSegments, c.label].length
              ? `/${[...parentSegments, c.label].join('/')}`
              : '/'
            const preparedCells = this.host.preparedCells(targetKey) ?? []
            // Null (not an empty array) when the view has not been prepared
            // yet: the memo below then falls back to the sigs this walk proved,
            // rather than recording "this target has no images".
            exactTargetImages = preparedCells.length
              ? [...new Set(
                  preparedCells
                    .map(cell => cell.imageSig)
                    .filter((sig): sig is string => typeof sig === 'string' && isSignature(sig)),
                )]
              : null
            const imgs = exactTargetImages ?? cachedSigs.get(c.label) ?? []
            if (!this.#clickTargetResident(names, imgs)) {
              allReady = false
              this.#enqueueBake(childHeadSig, imgs, names)
            }
          }
        }
        if (DIAG) console.info(`[diag:readiness] ${c.label} allReady=${allReady} cached=${!!cached} queue=${this.#childWarmQueue.length}`)
        if (allReady && isBranchTarget) {
          this.#childrenReadyByLabel.set(c.label, true)
          // Remember per LOCATION, proven under this parent sig: the next
          // visit seeds bright on its FIRST frame — a page shades at most
          // once per session, until its content (head sig) changes.
          let entry = this.#readyByLocation.get(locKey)
          if (!entry || entry.parentSig !== parentLayerSig) {
            entry = { parentSig: parentLayerSig, labels: new Set<string>(), targets: new Map() }
            this.#readyByLocation.set(locKey, entry)
            if (this.#readyByLocation.size > 64) {
              const oldest = this.#readyByLocation.keys().next().value
              if (oldest !== undefined) this.#readyByLocation.delete(oldest)
            }
          }
          entry.labels.add(c.label)
          // The head this tile was prepared under. Read from the per-label map
          // rather than the `childHeadSig` local — that one lives in the
          // preparation block above and is out of scope here.
          const preparedHead = this.#preparedHeadByLabel.get(c.label)
          if (preparedHead) {
              entry.targets.set(c.label, {
                headSig: preparedHead,
                imageSigs: [...(exactTargetImages ?? cachedSigs.get(c.label) ?? [])],
              })
          }
          // The exact target is resident now. Update the visible shade and
          // navigation gate immediately; a coalesced/full render can be
          // swallowed by unrelated render churn, which previously left the
          // overlay holding a stale "preloading" set after repair completed.
          this.host.released(c.label)
          // Release this tile via the short-window coalesced repaint: tiles
          // brighten INDIVIDUALLY as each completes (different child counts ⇒
          // different completion times), batching only near-simultaneous
          // completions — never one full render pass per tile.
          this.host.scheduleRepaint()
        }
      }
    } catch (e) {
      // best-effort readiness — a cold branch just stays shaded. NEVER let
      // this swallow silently under diagnostics: a throw here is exactly the
      // "tiles never release" failure.
      if (DIAG) console.warn('[diag:readiness] THREW', e)
    }
    finally { this.#childReadinessInFlight = false }
  }

  /** Bounded, usage-ordered child-image warm queue. A few fetches run at a
   *  time, in the order enqueued (the most-used tile's children first) —
   *  never a simultaneous blast that floods the host and makes everything
   *  arrive "all at once". Each completion — bytes landed OR a concluded
   *  miss — forces a repaint, so the owning tile's readiness re-checks and
   *  it un-shades the moment its inside finishes loading. */
  #enqueueChildWarm = (sig: string): void => {
    if (this.#childWarmQueued.has(sig) || this.host.hostFillInFlight.has(sig)) return
    this.#childWarmQueued.add(sig)
    this.#childWarmQueue.push(sig)
    this.#pumpChildWarms()
  }

  #pumpChildWarms = (): void => {
    while (this.#childWarmActive < CHILD_WARM_CONCURRENCY && this.#childWarmQueue.length > 0) {
      const sig = this.#childWarmQueue.shift()!
      this.#childWarmQueued.delete(sig)
      if (this.host.hostFillInFlight.has(sig)) continue
      this.host.hostFillInFlight.add(sig)
      this.#childWarmActive++
      void (async () => {
        let landed = false
        try {
          const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as { getResource: (s: string) => Promise<Blob | null> } | undefined
          const blob = await store?.getResource(sig)
          landed = !!blob
        } catch { /* treated as a concluded miss below */ }
        finally {
          // ANY failure — null, throw, missing store — CONCLUDES the sig so
          // the parent releases and the presence loop can never re-enqueue it
          // into an infinite warm→fail→re-render loop.
          if (landed) this.host.fillMissed.delete(sig)
          else this.host.fillMissed.add(sig)
          this.host.hostFillInFlight.delete(sig)
          this.#childWarmActive--
          this.host.scheduleRepaint()
          this.#pumpChildWarms()
        }
      })()
    }
  }

  /** Stamp the address of the location just navigated to and seed its
   *  readiness from the memo, so a revisit paints bright on its FIRST frame
   *  whichever render path serves it. Generation-gated: a navigation that
   *  happens while this resolves wins, and this result is dropped. */
  #reseedReadinessFromNavigation = async (): Promise<void> => {
    const gen = this.#readinessGen
    try {
      const lineage = (window as any).ioc?.get?.('@hypercomb.social/Lineage') as {
        currentSig?: () => Promise<string>; explorerLabel?: () => string; explorerSegments?: () => readonly string[]
      } | undefined
      const history = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as {
        latestMarkerSigFor?: (locSig: string, label: string) => Promise<string | undefined>
      } | undefined
      // SYNCHRONOUS FIRST. Resolving the address costs two awaits, and the
      // first frame of the new location paints before they land — which showed
      // as a flash of shade on every back-navigation even though the page was
      // already proven. A place we have stood before is remembered by its
      // segments, so the seed can happen in this very tick.
      const segsNow = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      const knownLoc = this.#locSigBySegments.get(segsNow.join('/'))
      if (knownLoc) {
        // SEED ONLY. The address stamp (parent head + segments the compute
        // keys on) stays untouched until it is resolved for real, just below:
        // a remembered head goes stale the moment anything commits, and
        // stamping a stale one made the compute read the memo as "content
        // changed" and wipe the very state this seed just restored.
        this.#seedChildReadinessForLocation(knownLoc)
      }
      const locSig = (await lineage?.currentSig?.()) ?? ''
      if (!locSig || gen !== this.#readinessGen) return
      // LEAF name, never explorerLabel(): the label is a PATH, and passing
      // it minted path-named husk layers at never-held locations.
      const head = (await history?.latestMarkerSigFor?.(locSig, segsNow.length ? segsNow[segsNow.length - 1] : '/')) ?? ''
      if (gen !== this.#readinessGen) return
      this.#passLocSig = locSig
      this.#passParentSig = head
      this.#passSegments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      this.#rememberAddress(this.#passSegments, locSig, head)
      this.#seedChildReadinessForLocation(locSig)
      this.host.scheduleRepaint()
    } catch { /* best-effort — the cold path still stamps */ }
  }

  /** Remember a location's address so a RETURN can seed synchronously — path →
   *  location sig → the head it was last painted under. Bounded; entries are
   *  cheap strings and only for places actually visited. */
  #rememberAddress(segments: readonly string[], locSig: string, parentSig: string): void {
    if (!locSig) return
    const key = segments.join('/')
    this.#locSigBySegments.set(key, locSig)
    if (parentSig) this.#parentSigByLocSig.set(locSig, parentSig)
    if (this.#locSigBySegments.size > 256) {
      const oldest = this.#locSigBySegments.keys().next().value
      if (oldest !== undefined) this.#locSigBySegments.delete(oldest)
    }
  }

  /** Is this click target's paint work actually RESIDENT — every child name in
   *  the label atlas, every child image decoded (or concluded absent)? Asked
   *  live: brightness is a promise that this exact first paint is warm. */
  #clickTargetResident(names: readonly string[], sigs: readonly string[]): boolean {
    const labelAtlas = this.host.labelAtlas()
    const imageAtlas = this.host.imageAtlas()
    if (!labelAtlas || !imageAtlas) return false
    for (const n of names) {
      if (!n || labelAtlas.hasLabel(n)) continue
      if (DIAG) console.info(`[diag:readiness] target not resident: label=${n}`)
      return false
    }
    for (const s of sigs) {
      if (imageAtlas.hasImage(s)) continue
      if (imageAtlas.hasFailed(s) || this.host.fillMissed.has(s)) continue  // concluded — never arriving
      if (DIAG) console.info(`[diag:readiness] target not resident: image=${s.slice(0, 8)}`)
      return false
    }
    return true
  }

  /** Queue a branch's click target for baking: its children's images into the
   *  image atlas, their names into the label atlas. Enqueued in the order the
   *  readiness compute proves branches — most-used first. */
  #enqueueBake = (headSig: string, sigs: string[], names: string[]): void => {
    if (this.#bakeQueued.has(headSig)) return
    this.#bakeQueued.add(headSig)
    this.#bakeQueue.push({ headSig, sigs: [...sigs], names: [...names] })
    this.#pumpBakes()
  }

  /** An exact click-target asset was displaced. Shading is informational, not
   *  a navigation lock, so the tile remains clickable while its repair is
   *  prioritized; it simply stops promising a delay-free click. */
  #revokeReadinessForRepair = (label: string): void => {
    if (this.#childrenReadyByLabel.get(label) !== true) return
    this.#childrenReadyByLabel.delete(label)
    this.#brightLabels.delete(label)
    this.host.revoked(label)
  }

  /** A repair bake can re-earn readiness directly. Waiting for an unrelated
   *  full render to rediscover the proof left branches shaded indefinitely
   *  under repeated atlas churn. The memo ties this exact target to the
   *  current location and parent head; if either moved, a later location seed
   *  validates the now-resident assets instead. */
  #releaseRepairedTarget = (headSig: string): void => {
    const entry = this.#readyByLocation.get(this.#readinessLocationKey)
    if (!entry || entry.parentSig !== this.#passParentSig) return
    let changed = false
    for (const [label, target] of entry.targets) {
      if (target.headSig !== headSig) continue
      const names = this.host.preparedNames(headSig)
      if (!names || !this.#clickTargetResident(names, target.imageSigs)) continue
      this.#childrenReadyByLabel.set(label, true)
      this.#preparedHeadByLabel.set(label, headSig)
      this.host.paintShade(label)
      changed = true
    }
    if (changed) {
      this.host.emitReadiness()
    }
  }

  /** Bake at most ONE expensive asset per idle slice. Rasterising one label is
   *  ~13ms and image decode/upload can be longer; the previous implementation
   *  did up to 24 images plus 32 labels in one callback, blocking clicks even
   *  into destinations that were already fully prepared. */
  #pumpBakes = (): void => {
    if (this.#bakePumping || this.#bakeQueue.length === 0) return
    this.#bakePumping = true
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
    // A bounded timeout ensures progress in busy tabs, while isInputPending
    // below always gives an actual pointer/keyboard event priority.
    const schedule = typeof ric === 'function'
      ? (cb: () => void) => ric(cb, { timeout: 500 })
      : (cb: () => void) => setTimeout(cb, 16)
    schedule(() => {
      void (async () => {
        const job = this.#bakeQueue.shift()
        try {
          if (!job) return
          const inputPending = (() => {
            try {
              return Boolean((navigator as any).scheduling?.isInputPending?.({ includeContinuous: true }))
            } catch { return false }
          })()
          if (inputPending) {
            this.#bakeQueue.unshift(job)
            return
          }

          let worked = false
          const imageAtlas = this.host.imageAtlas()
          if (imageAtlas) {
            while (job.sigs.length > 0) {
              const sig = job.sigs.shift()!
              if (imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) continue
              const blob = await this.host.decode(sig)
              if (blob) await imageAtlas.loadImage(sig, blob)
              // ORPHAN GUARD: the decode is LOCAL-only, so a sig whose bytes
              // aren't here yet silently produced nothing — and this job had
              // already shifted it off the list. Residency never arrived, so
              // the tile stayed shaded while every pass re-queued the same
              // futile bake. Hand it to the warm queue instead: it lands the
              // bytes or concludes the sig, and #clickTargetResident accepts
              // a concluded sig. Reachable for target images the presence
              // walk never checked (fallback substrate, reference faces) and
              // for bytes evicted between the check and the bake.
              else this.#enqueueChildWarm(sig)
              worked = true
              break
            }
          }

          // Do not combine a label raster with an image decode in one slice.
          if (!worked) {
            while (job.names.length > 0) {
              const name = job.names.shift()!
              if (!name || this.host.labelAtlas()?.hasLabel(name)) continue
              try { this.host.labelAtlas()?.seed([name]) } catch { /* rasterisation is best-effort */ }
              worked = true
              break
            }
          }

          if (job.sigs.length > 0 || job.names.length > 0) {
            this.#bakeQueue.push(job)
          } else {
            this.#bakeQueued.delete(job.headSig)
            this.#releaseRepairedTarget(job.headSig)
            this.host.scheduleRepaint()
          }
        } catch {
          // Do not poison the head's dedupe key permanently. A later
          // readiness pass can enqueue a clean retry.
          if (job) this.#bakeQueued.delete(job.headSig)
          this.host.scheduleRepaint()
        }
        finally {
          this.#bakePumping = false
          this.#pumpBakes()
        }
      })()
    })
  }

  /** True when the readiness working set at the current location cannot fit
   *  its atlas, making eviction REPAIR self-defeating: every repair bake
   *  evicts another prepared entry, whose own eviction re-arms the next
   *  repair — an endless idle churn (and, before on-screen pinning, the
   *  every-tile-text-blinking bug witnessed on hub layers whose branches'
   *  child names total past the label atlas). Repair stands down; clicks on
   *  affected branches simply re-bake on demand (~13ms per label). */
  #readinessRepairFutile(kind: 'image' | 'label'): boolean {
    let capacity: number
    let demand = 0
    if (kind === 'image') {
      capacity = this.host.imageAtlas()?.capacity ?? Number.POSITIVE_INFINITY
      for (const c of this.host.renderedCells()) if (c.imageSig) demand++
      const perLabel = this.#childImageSigsByParent.get(this.#passParentSig)
      if (perLabel) {
        for (const [label, sigs] of perLabel) {
          if (this.#childrenReadyByLabel.get(label) === true) demand += sigs.length
        }
      }
    } else {
      capacity = this.host.labelAtlas()?.capacity ?? Number.POSITIVE_INFINITY
      demand = [...this.host.renderedCells()].length
      for (const [, headSig] of this.#preparedHeadByLabel) {
        demand += this.host.preparedNames(headSig)?.length ?? 0
      }
    }
    if (demand <= capacity) return false
    const key = `${kind}:${this.#readinessLocationKey}`
    if (!this.#repairFutileWarned.has(key)) {
      this.#repairFutileWarned.add(key)
      console.warn(`[show-cell] readiness ${kind} working set (${demand}) exceeds atlas capacity (${capacity}) — standing down eviction repair at this location; affected branches re-bake on click`)
    }
    return true
  }
}
