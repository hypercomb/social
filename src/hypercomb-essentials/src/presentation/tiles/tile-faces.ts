// tile-faces.ts — WHAT EACH TILE SHOWS. A branch of the tile renderer
// (documentation/tile-renderer-tree.md): per tile, its picture and the facts
// its properties carry — border colour, tags, link, substrate, hidden name —
// read from the tile's own properties (or, for a peer's tile, from what its
// publisher projected), decoded into the image atlas, and cached by label.
//
// The caches are one projection of one location: labels are only unique
// inside a lineage, so entering another location sets this one aside (to be
// restored on a return while its cells are still cached) and starts clean.
// A read never awaits the network: a local miss paints label-only now, and a
// detached host fill repaints when the bytes land (or concludes they never
// will, which the renderer shows as a settled, label-only tile).

import { cellLocationSig, isSignature, readCellProperties, readTilePropertiesAt, readTilePropsIndex, readTilePropsSigAt, recoverableTileImageSig, seedLayerKeyedEntries, writeTilePropsIndex } from '../../editor/tile-properties.js'
import { referenceFaceForLabel } from '../../commands/decoration-kind-index.js'
import { publishOwnedProjection } from './derived-projection-cache.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import { participantVariantVisual } from './participant-variant.js'
import { packedVisual } from './packed-visuals.js'

/** Warm projections kept for revisits — the renderer's prepared-view cap. */
const DERIVED_LOCATION_CAP = 4096
/** Below this, a raw source decodes in ~a millisecond anyway — deriving a
 *  cell-sized copy would spend the optimize phase on images with nothing to
 *  gain. Byte size is a heuristic for pixel count, deliberately loose. */
const VISUAL_DEMAND_MIN_BYTES = 24_576

/** What the loader reads and writes on a painted cell. */
export type FaceCell = {
  label: string
  external: boolean
  imageSig?: string
  pendingProps?: boolean
  borderColor?: [number, number, number]
  hasLink?: boolean
  hasSubstrate?: boolean
  hideText?: boolean
}

type LabelDerivedState = {
  images: Map<string, string | null>
  borders: Map<string, [number, number, number]>
  tags: Map<string, string[]>
  links: Map<string, boolean>
  substrates: Map<string, boolean>
  hiddenText: Map<string, boolean>
  external: Set<string>
}

type ImageAtlasLike = {
  hasImage(sig: string): boolean
  hasFailed(sig: string): boolean
  clearFailure(sig: string): void
  loadImage(sig: string, blob: Blob): Promise<unknown>
  setPinned(sigs: Set<string>): void
}

export interface FacesHost {
  imageAtlas(): ImageAtlasLike | null
  /** The renderer's flat-image mode (which props field names a tile's image). */
  flat(): boolean
  /** Sigs being fetched right now — shared with readiness's warm queue. */
  readonly hostFillInFlight: Set<string>
  /** Sigs concluded missing — shared with readiness: never waited on again. */
  readonly fillMissed: Set<string>
  /** A missed fill: arm the renderer's retry window for these sigs. */
  armMissWindow(sigs: string[]): void
  /** Bytes landed (or concluded missing): paint again, past the unchanged-page fast path. */
  repaint(): void
  /** A flattened tile's own lineage (narrowing); null for an ordinary page. */
  parentOf(label: string): readonly string[] | null
  /** Props pinned by the history cursor while rewound, by label. */
  cursorPropsOverride(): ReadonlyMap<string, string> | null
  /** What a peer's publisher projected for a tile it paints here. */
  registryProperties(label: string): Readonly<Record<string, unknown>> | undefined
  registryImage(label: string): string | undefined
  /** The cells on screen, whose pictures the atlas must keep. */
  renderedCells(): Iterable<{ imageSig?: string }>
  /** Pictures a tile preview is showing, kept too. */
  previewSigs(): Iterable<string>
  emit(effect: string, payload: unknown): void
  /** Every cache was dropped: the renderer's baked geometry is stale. */
  onCleared(): void
}

export class TileFaces {
  // label → small image signature (avoids re-reading properties on every render)
  readonly images = new Map<string, string | null>()
  // label → border colour RGB floats
  readonly borders = new Map<string, [number, number, number]>()
  // label → tag names
  readonly tags = new Map<string, string[]>()
  // label → has a link property
  readonly links = new Map<string, boolean>()
  // label → its image is substrate-assigned
  readonly substrates = new Map<string, boolean>()
  // label → hides its name when an image shows
  readonly hiddenText = new Map<string, boolean>()
  /** Labels whose derived caches were last filled from an external participant
   *  projection. If paste/adopt turns one local, every derived field must be
   *  dropped before the local read—otherwise a peer border/tag/title can
   *  survive even after image provenance was corrected. */
  readonly external = new Set<string>()
  /** For EXTERNAL (peer) labels: which publisher imageSig the cached value
   *  was derived from. The publisher's CURRENT sig is authoritative — a
   *  cache entry is only reusable while its source sig is unchanged, so a
   *  stale or cross-contaminated entry can never pin a peer tile to the
   *  wrong image. */
  readonly peerSources = new Map<string, string>()
  /** Head layer sigs whose canonical CONCLUDED "no properties" — the
   *  derive-on-miss pass skips these instead of re-asking every render.
   *  Keyed by HEAD SIG, so any edit (new head) re-derives automatically;
   *  session-only, bounded by distinct propless heads seen. */
  readonly #propslessHeads = new Set<string>()
  /** Owner of the label-keyed caches. Labels are only unique inside a
   *  lineage: `/friends/jaime` and `/team/jaime` may select different atomic
   *  variants from the same name pool. Crossing this boundary must drop every
   *  label derivation before either the slow or back-nav path can consult it. */
  #locationKey = ''
  /** Warm label projections by lineage. Location changes must isolate raw
   *  label keys without discarding the work already prepared for a revisit. */
  readonly #derivedStateByLocation = new Map<string, LabelDerivedState>()

  constructor(private readonly host: FacesHost) {}

  /** The location the caches currently describe. */
  get locationKey(): string { return this.#locationKey }

  /** Forget one label here and in every saved location's projection — a
   *  root default changed, and every same-named appearance composes from it. */
  invalidateEverywhere(label: string): void {
    this.invalidate(label)
    for (const state of this.#derivedStateByLocation.values()) {
      state.images.delete(label)
      state.borders.delete(label)
      state.tags.delete(label)
      state.links.delete(label)
      state.substrates.delete(label)
      state.hiddenText.delete(label)
      state.external.delete(label)
    }
  }

  /**
   * Drop every label-keyed derived-state cache in one call. These six
   * maps are views of the same identity (facts derived from a
   * propsSig), so invalidation always happens together. Centralising
   * the clear keeps the cursor-change and explorer-ready paths from
   * having to list each map individually.
   */
  clear = (): void => {
    // A REPLACED atlas restarts its eviction counter at 0, so a remembered
    // generation of 0 would read as "already applied" against a brand-new,
    // empty atlas and hold the early-return over an unbaked grid. -1 is never
    // a live generation, so the next pass always rebuilds.
    this.host.onCleared()
    this.images.clear()
    this.borders.clear()
    this.tags.clear()
    this.links.clear()
    this.substrates.clear()
    this.hiddenText.clear()
    this.external.clear()
  }

  /** Drop every presentation fact derived from one participant variant. These
   *  caches are one coherent projection: invalidating only its image creates a
   *  tile that combines a new head with an old participant's other fields. */
  invalidate = (label: string): void => {
    this.external.delete(label)
    this.images.delete(label)
    this.borders.delete(label)
    this.tags.delete(label)
    this.links.delete(label)
    this.substrates.delete(label)
    this.hiddenText.delete(label)
    this.peerSources.delete(label)
  }

  /** Move the label-keyed projection caches to one lineage. Per-location cell
   * snapshots remain warm; they already contain their own imageSig and must
   * never be overwritten by the page we just left. */
  enter = (locationKey: string, restorable: boolean): void => {
    if (locationKey === this.#locationKey) return
    if (this.#locationKey) {
      this.#derivedStateByLocation.set(this.#locationKey, {
        images: new Map(this.images),
        borders: new Map(this.borders),
        tags: new Map(this.tags),
        links: new Map(this.links),
        substrates: new Map(this.substrates),
        hiddenText: new Map(this.hiddenText),
        external: new Set(this.external),
      })
      if (this.#derivedStateByLocation.size > DERIVED_LOCATION_CAP) {
        const oldest = this.#derivedStateByLocation.keys().next().value
        if (oldest !== undefined) this.#derivedStateByLocation.delete(oldest)
      }
    }
    this.#locationKey = locationKey
    // The cell snapshot and its derived projection are one cache entry. If
    // the former was invalidated, never restore stale presentation facts.
    const state = restorable
      ? this.#derivedStateByLocation.get(locationKey)
      : undefined
    if (!state) this.#derivedStateByLocation.delete(locationKey)
    this.clear()
    if (!state) return
    for (const [label, value] of state.images) this.images.set(label, value)
    for (const [label, value] of state.borders) this.borders.set(label, value)
    for (const [label, value] of state.tags) this.tags.set(label, value)
    for (const [label, value] of state.links) this.links.set(label, value)
    for (const [label, value] of state.substrates) this.substrates.set(label, value)
    for (const [label, value] of state.hiddenText) this.hiddenText.set(label, value)
    for (const label of state.external) this.external.add(label)
  }

  /**
   * Load cell properties from the content-addressed tile-props index
   * and resolve the small.image signature from __resources__/ into the image atlas.
   * Standard: any property value matching a 64-char hex signature
   * refers to a blob in __resources__/{signature}.
   */
  load = async (
    cells: FaceCell[],
    _dir: FileSystemDirectoryHandle | null,
    forceReload?: Set<string>,
    segmentsOverride?: readonly string[],
    prepareOnly = false,
  ): Promise<readonly string[] | null> => {
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as
      {
        getResource: (sig: string) => Promise<Blob | null>
        getResourceLocal: (sig: string) => Promise<Blob | null>
        getOptimizedVisual?: (sig: string) => Promise<Blob | null>
        optimizeVisual?: (sig: string, raw: Blob) => Promise<void>
      } | undefined
    if (!store || !this.host.imageAtlas()) return null
    const imageAtlas = this.host.imageAtlas()!
    // Off-screen preparation must never write into the visible lineage's
    // label-keyed projection caches. Those writes race the foreground render:
    // a child view resolving the same label (or a temporary miss) could finish
    // last and erase the image currently on screen. Prepared cells carry their
    // resolved values themselves, so isolated maps are sufficient here.
    const cacheOwner = this.#locationKey
    const imageCache = prepareOnly ? new Map<string, string | null>() : new Map(this.images)
    const borderCache = prepareOnly ? new Map<string, [number, number, number]>() : new Map(this.borders)
    const tagsCache = prepareOnly ? new Map<string, string[]>() : new Map(this.tags)
    const linkCache = prepareOnly ? new Map<string, boolean>() : new Map(this.links)
    const substrateCache = prepareOnly ? new Map<string, boolean>() : new Map(this.substrates)
    const hideTextCache = prepareOnly ? new Map<string, boolean>() : new Map(this.hiddenText)

    // Detached host fill — the render path's bytes come from LOCAL reads
    // only (memory/OPFS); anything missing is fetched off-path through the
    // full cascade and re-rendered on arrival. The Store negative-caches
    // misses, so an unresolvable sig costs one bounded cascade per TTL
    // window instead of a network storm on every synchronize pass.
    const fillFromHost = (sig: string, label?: string): void => {
      if (this.host.hostFillInFlight.has(sig)) return
      this.host.hostFillInFlight.add(sig)
      void (async () => {
        try {
          const blob = await store.getResource(sig)
          if (!blob) {
            this.host.armMissWindow([sig])
            // Not yet delivered — egg; retried after the miss TTL. Record
            // the CONCLUDED miss so the readiness shade releases: the tile
            // reverts to bright label-only (clickable) instead of staying
            // dimmed/inert for bytes that may never come.
            if (!this.host.fillMissed.has(sig)) {
              this.host.fillMissed.add(sig)
              this.host.repaint()
            }
            return
          }
          this.host.fillMissed.delete(sig)
          // Fresh bytes for this sig — un-pin any decode-failure record so
          // the atlas retries with the healed blob instead of skipping it.
          imageAtlas.clearFailure(sig)
          // CHAIN THE POINTER IN ONE PASS. A peer's visual names a PROPS
          // resource whose small.image is the actual picture, so resolving a
          // tile took two detached fetches with a full render pass between
          // them — the second sig wasn't even known until the first landed and
          // a pass re-derived it. On a fresh join that doubled the wait for
          // every image. Follow the pointer here instead: the nested fetch
          // starts immediately and the pass that follows finds both bytes
          // local. Guarded by #hostFillInFlight, so this can't recurse or
          // double-fetch, and a props blob is small by construction.
          void this.#prefetchNestedImageSig(blob, fillFromHost)
          // Bytes landed (memory + OPFS write-through). Drop the label's
          // cached derivation so the next pass re-derives from fresh
          // bytes, then schedule that pass. The force is required — a
          // bare requestRender is a no-op at an unchanged location
          // (fast-path skip on renderedCellsKey), so the landed bytes
          // would never paint until an unrelated invalidation.
          if (label && cacheOwner === this.#locationKey) this.images.delete(label)
          this.host.repaint()
        } catch { /* bounded by the Store's miss cache */ }
        finally { this.host.hostFillInFlight.delete(sig) }
      })()
    }

    const livePropsIndex: Record<string, string> = readTilePropsIndex()

    // Index entries are keyed by the tile's FULL-LINEAGE sig (the sigbag
    // key — tile-properties.ts) so same-named tiles at different hive
    // locations never read each other's assignment; bare-label entries
    // remain readable as legacy fallback. The sigs are memoised inside
    // HistoryService.sign, so this map costs one hash per (location,
    // label) for the lifetime of the session. Cursor overrides (rewound
    // view) are label-keyed and take precedence over the live index.
    const renderLineage = (window as any).ioc?.get?.('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const renderSegments: readonly string[] = segmentsOverride ?? renderLineage?.explorerSegments?.() ?? []
    // A gathered/flattened tile (orchestrator audit, tag flatten) lives at
    // its OWN absolute path, not on the page the view was raised from.
    // Signing the render location for it mints a key no writer ever wrote,
    // so the props lookup missed and every gathered tile painted imageless.
    // The narrowing carries the absolute path (ending in the label) for
    // exactly those tiles; none for ordinary renders.
    const segmentsForLabel = (label: string): readonly string[] => this.host.parentOf(label) ?? renderSegments
    const indexKeyByLabel = new Map<string, string>()
    for (const c of cells) {
      if (!indexKeyByLabel.has(c.label)) {
        indexKeyByLabel.set(c.label, await cellLocationSig(segmentsForLabel(c.label), c.label))
      }
    }

    // Layer-first resolution (visuals-across-lineages.md, Phase A). The
    // head layer's sig keys an entry that can neither collide nor go
    // stale: new props = new head = miss; another lineage at this address
    // = another head = its own entry — so adopt-sync, restore, or a
    // rolled stack re-serves each lineage's OWN picture instead of the
    // last writer's. Heads are warm here (the stream that produced
    // `cells` resolved them); warmHeadSigFor is a map lookup, never an
    // OPFS read or a marker mint. Fallback stays location → bare label;
    // a fallback hit queues a re-mint so the NEXT pass hits layer-first.
    const historyForHeads = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as
      { warmHeadSigFor?: (l: string) => string | null } | undefined
    const headSigByLabel = new Map<string, string>()
    if (historyForHeads?.warmHeadSigFor) {
      for (const [label, key] of indexKeyByLabel) {
        const head = key ? historyForHeads.warmHeadSigFor(key) : null
        if (head) headSigByLabel.set(label, head)
      }
    }
    // Labels whose layer-keyed entry was ABSENT, with the sig the pass
    // served instead (a location/label fallback) or null (total miss).
    // Both resolve against CANONICAL after the batch — derive-on-miss
    // (Phase B, visuals-across-lineages.md): the entry seeds so the next
    // pass hits layer-first, and a serve that DISAGREES with canonical
    // repaints this pass, not the next one. No pre-seeded index is ever
    // required for a tile to show its picture.
    const unresolvedByLabel = new Map<string, string | null>()

    const propsSigForLabel = (label: string): string | undefined => {
      const override = this.host.cursorPropsOverride()?.get(label)
      if (override) return override
      const headSig = headSigByLabel.get(label)
      if (headSig) {
        const byLayer = livePropsIndex[headSig]
        if (byLayer) return byLayer
      }
      const key = indexKeyByLabel.get(label) ?? ''
      const sig = (key ? livePropsIndex[key] : undefined) ?? livePropsIndex[label]
      if (headSig) unresolvedByLabel.set(label, sig ?? null)
      return sig
    }

    // Peer-published image sigs for tiles the user hasn't adopted yet.
    // For each peer-only tile (kind:'peer', `cell.external === true`),
    // the SwarmDrone may have streamed an imageSig — the publisher's
    // substrate-cache pointer — which now lives in OPFS via the
    // resource-pull pipeline. Looking it up here lets the image-load
    // path treat the peer's sig as if it were a local propsIndex entry
    // and render the publisher's image as a preview before the user
    // commits to adopt.
    const peerImageSigByLabel = new Map<string, string>()
    try {
      const swarm = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') as
        | { peerTilesAtCurrentSig?: () => readonly { name: string; imageSig?: string }[] }
        | undefined
      const peerTiles = swarm?.peerTilesAtCurrentSig?.() ?? []
      for (const t of peerTiles) {
        if (typeof t.imageSig === 'string' && !peerImageSigByLabel.has(t.name)) {
          peerImageSigByLabel.set(t.name, t.imageSig)
        }
      }
    } catch { /* swarm not registered yet — no peer previews */ }

    // Per-batch dedup so cells sharing an image (e.g. substrate fills) only fetch + decode once
    const inFlightImages = new Map<string, Promise<void>>()
    const loadImageOnce = (sig: string): Promise<void> => {
      if (imageAtlas.hasImage(sig) || imageAtlas.hasFailed(sig)) return Promise.resolve()
      // View preparation resolves the exact image signatures and display
      // properties, but GPU decode/upload belongs to the sliced idle bake
      // queue. Decoding every destination cell here via Promise.all monopolized
      // the main thread while other, already-ready tiles were being clicked.
      if (prepareOnly) return Promise.resolve()
      const existing = inFlightImages.get(sig)
      if (existing) return existing
      const promise = (async () => {
        try {
          // LOCAL only — a miss never stalls the batch; the detached fill
          // pulls the bytes and a follow-up render atlas-loads them.
          // Cell-sized optimized visual first: same pixels the atlas would
          // bake from the raw, pre-downscaled so the decode is milliseconds.
          const blob = await this.decode(sig)
          if (!blob) { fillFromHost(sig); return }
          await imageAtlas.loadImage(sig, blob)
        } catch (error) {
          console.warn(`[show-cell] atlas load failed for ${sig.slice(0, 12)}…`, error)
        }
      })()
      inFlightImages.set(sig, promise)
      return promise
    }

    const loadOne = async (cell: FaceCell): Promise<void> => {
      // A peer-only tile can become a local same-identity twin between render
      // passes (paste/adopt). Its previous caches are a projection of the peer,
      // not reusable facts about the new local head. Clear the whole set once
      // before entering the ordinary local resolver.
      if (!cell.external && this.external.delete(cell.label)) {
        this.invalidate(cell.label)
        // This pass reads its own copies, taken before the peer's projection
        // was dropped — clear them too, or the peer's picture, border and
        // tags are reused below and committed straight back.
        imageCache.delete(cell.label)
        borderCache.delete(cell.label)
        tagsCache.delete(cell.label)
        linkCache.delete(cell.label)
        substrateCache.delete(cell.label)
        hideTextCache.delete(cell.label)
      }
      // External cells (kind:'peer' from the SwarmDrone) have no local
      // OPFS dir, so the OPFS-based
      // tags/link/substrate reads further down would always throw. The
      // peer path has its OWN content-addressed image source though:
      // the swarm streamed the publisher's `imageSig` and the bytes are
      // already in __resources__/. Resolve it the same way local cells
      // do (propsBlob → small.image → imageAtlas), then return without
      // touching the OPFS-only caches.
      if (cell.external) {
        this.external.add(cell.label)
        const publishedProperties = this.host.registryProperties(cell.label)
        const published = publishedProperties
          ? participantVariantVisual(publishedProperties, this.host.flat())
          : undefined
        if (published) {
          cell.pendingProps = false
          if (published.borderColor) cell.borderColor = published.borderColor
          cell.hasLink = published.hasLink
          cell.hasSubstrate = published.hasSubstrate
          cell.hideText = published.hideText
          if (published.borderColor) borderCache.set(cell.label, published.borderColor)
          else borderCache.delete(cell.label)
          tagsCache.set(cell.label, [...published.tags])
          linkCache.set(cell.label, published.hasLink)
          substrateCache.set(cell.label, published.hasSubstrate)
          hideTextCache.set(cell.label, published.hideText)
        }
        // Peer-only tiles render ONLY the publisher's streamed image — the
        // sig is content-addressed and the publisher is the authority, so
        // the CURRENT peerImageSigByLabel value always wins. The cache is a
        // derivation memo, valid only while its SOURCE sig is unchanged
        // (peerImageSourceByLabel) — without that check, a stale or
        // cross-contaminated entry pinned peer tiles to WRONG images
        // forever (the witness showed shuffled/random tiles even though
        // the wire carried the exact right sigs per name).
        // No local-pool fallback in any branch: painting the receiver's
        // substrate pick on a tile the receiver doesn't own is wrong.
        // LIVE publisher sig first (swarm visuals); REGISTRY entry sig as
        // the solo fallback — config-mounted tiles (DCP-adopted branches)
        // have no live publisher, their canonical image rides the
        // TileSourceRegistry entry instead. Both are publisher-derived
        // from the same canonical 0000, so either is exact.
        const peerSig = publishedProperties
          ? published?.imageSig
          : peerImageSigByLabel.get(cell.label) ?? this.host.registryImage(cell.label)
        if (peerSig) {
          const cached = imageCache.get(cell.label)
          if (cached && this.peerSources.get(cell.label) === peerSig) {
            cell.imageSig = cached
            return
          }
          try {
            // LOCAL only — peer bytes that haven't streamed yet must not
            // stall the pass; the detached fill re-renders on arrival.
            // While that fill is IN FLIGHT the tile is readiness-shaded
            // (pendingProps) — a concluded miss (#fillMissedSigs) releases
            // it to the bright label-only preview so an offline publisher
            // can't strand the tile dimmed/inert.
            const blob = await resolveLocalResourceReference(store, peerSig)
            if (!blob) {
              fillFromHost(peerSig, cell.label)
              cell.pendingProps = !this.host.fillMissed.has(peerSig)
              imageCache.set(cell.label, null)
              return
            }
            // The wire has carried two shapes: a PROPS pointer (JSON blob
            // whose small.image holds the image sig — the old substrate-
            // cache pointer) and the DIRECT image sig (current visuals
            // inline the canonical 0000, whose small.image IS the image).
            // Parse-as-JSON distinguishes them: parseable → derive; binary
            // → the sig is the image itself.
            let finalSig: string | null = null
            try {
              const props = JSON.parse(await blob.text())
              const smallSig = recoverableTileImageSig(props, this.host.flat())
              if (smallSig && isSignature(smallSig)) finalSig = smallSig
            } catch {
              finalSig = peerSig
            }
            if (finalSig) {
              await loadImageOnce(finalSig)
              cell.imageSig = finalSig
              imageCache.set(cell.label, finalSig)
              this.peerSources.set(cell.label, peerSig)
            } else {
              imageCache.set(cell.label, null)
            }
          } catch {
            imageCache.set(cell.label, null)
          }
          return
        }
        // A complete peer projection with no picture means exactly that: this
        // participant's variant is pictureless. Never reuse the outgoing
        // participant's image or a local substrate fallback.
        if (publishedProperties) {
          cell.imageSig = undefined
          imageCache.set(cell.label, null)
          this.peerSources.delete(cell.label)
          return
        }
        // No CURRENT peer sig (bytes/visual not arrived this pass): reuse a
        // previously-derived value if one exists — re-render passes must not
        // strand the tile — otherwise mark null and wait for the next
        // visuals/resource arrival to re-attempt.
        const cached = imageCache.get(cell.label)
        if (cached) { cell.imageSig = cached; return }
        imageCache.set(cell.label, null)
        return
      }

      // load tags + link from OPFS if not cached (independent of image cache).
      // Sub-layer locations have no on-disk dir under layer-as-primitive; the
      // image path below still resolves via __resources__, so we just skip
      // the tags/link folder read when _dir is null.
      if (!tagsCache.has(cell.label)) {
        if (_dir) {
          try {
            const cellDir = await _dir.getDirectoryHandle(cell.label)
            const tagProps = await readCellProperties(cellDir)
            const rawTags = tagProps?.['tags']
            tagsCache.set(cell.label, Array.isArray(rawTags)
              ? (rawTags as unknown[]).filter((t): t is string => typeof t === 'string')
              : [])
            if (!linkCache.has(cell.label)) {
              linkCache.set(cell.label, typeof tagProps?.['link'] === 'string' && (tagProps['link'] as string).length > 0)
            }
          } catch { tagsCache.set(cell.label, []) }
        } else {
          tagsCache.set(cell.label, [])
        }
      }

      // check cache first — unless the caller forced a reload for this
      // label (substrate:applied / substrate:rerolled just wrote a new
      // propsSig and we need to re-read props instead of serving the
      // stale cached sig).
      if (!forceReload?.has(cell.label) && imageCache.has(cell.label)) {
        const cachedSig = imageCache.get(cell.label) ?? undefined
        cell.imageSig = cachedSig
        cell.pendingProps = false
        cell.borderColor = borderCache.get(cell.label)
        cell.hasLink = linkCache.get(cell.label) ?? false
        cell.hasSubstrate = substrateCache.get(cell.label) ?? false
        cell.hideText = hideTextCache.get(cell.label) ?? false
        // If the atlas has since evicted this signature (a later
        // loadImage displaced its slot), re-queue a load so the
        // render doesn't fall back to label. The blob is almost
        // certainly in the resource cache, so this is cheap.
        if (cachedSig) {
          if (!imageAtlas.hasImage(cachedSig) && !imageAtlas.hasFailed(cachedSig)) {
            await loadImageOnce(cachedSig)
          }
        } else {
          // cache entry is null — first visit resolved no image. This is
          // the commonest failure shape: substrate hadn't yet assigned
          // a propsSig when loadOne first ran, null got cached, and no
          // later path retries. Fall through to the slow path so we
          // re-read propsIndex in case substrate has since populated
          // it.
          imageCache.delete(cell.label)
        }
        if (imageCache.has(cell.label)) return
      }

      // One invariant for every path: explicit/reference sig first, otherwise
      // the active substrate set. A props/index timing miss must never turn
      // "use the default set" into a cached blank tile.
      //
      // PROVISIONAL (`cold`): the tile's own props were not readable THIS
      // pass — the sig is known but its bytes are still arriving (the normal
      // state on a published site, where every byte comes off the origin).
      // The default set is the right thing to PAINT now and the wrong thing
      // to REMEMBER: a cached non-null fallback short-circuits every later
      // pass (only a cached `null` re-reads), so the tile kept its substrate
      // stand-in for the whole session and the published picture never
      // appeared. Paint it, cache nothing, re-derive when the bytes land.
      const loadDefaultImage = async (cold = false): Promise<void> => {
        const remember = (sig: string | null): void => {
          if (cold) { imageCache.delete(cell.label); return }
          imageCache.set(cell.label, sig)
        }
        const faceSig = referenceFaceForLabel(cell.label)
        if (faceSig && isSignature(faceSig)) {
          await loadImageOnce(faceSig)
          cell.imageSig = faceSig
          remember(faceSig)
          return
        }
        const subSvc = (window as any).ioc?.get?.('@diamondcoreprocessor.com/SubstrateService') as
          { pickImageForLabel?: (label: string) => string | null } | undefined
        const fallbackSig = subSvc?.pickImageForLabel?.(cell.label) ?? null
        if (fallbackSig && isSignature(fallbackSig)) {
          await loadImageOnce(fallbackSig)
          cell.imageSig = fallbackSig
          remember(fallbackSig)
        } else {
          remember(null)
        }
      }

      // Read tile properties from the content-addressed resource. The index is
      // a cache, never the authority: edit mode reads the canonical properties
      // slot, so letting a cache miss become an imageless paint is exactly how
      // opening edit appeared to "repair" lost pictures. Resolve canonical on
      // the miss in this paint, including when the warm-head map is cold.
      // True when this pass could not READ the tile's props (bytes still in
      // flight), as opposed to reading them and finding no picture. Only the
      // first is provisional — see loadDefaultImage.
      let propsCold = false
      try {
        let propsSig = propsSigForLabel(cell.label)
        if (!propsSig) {
          propsSig = await readTilePropsSigAt(segmentsForLabel(cell.label), cell.label)
          if (propsSig) {
            const headSig = headSigByLabel.get(cell.label) ?? ''
            if (headSig) seedLayerKeyedEntries([[headSig, propsSig]])
          }
        }
        let outerProps: Record<string, unknown> = {}
        if (propsSig) {
          // LOCAL first keeps a cold resource out of the render's critical
          // path. The canonical read below composes the root defaults and can
          // heal/fetch either incidence; this local projection remains useful
          // while that composition is transiently unavailable.
          const blob = await resolveLocalResourceReference(store, propsSig)
          if (blob) outerProps = JSON.parse(await blob.text()) as Record<string, unknown>
          else {
            fillFromHost(propsSig, cell.label)
            cell.pendingProps = !this.host.fillMissed.has(propsSig)
          }
        }

        // The effective object is exactly `{ ...rootDefaults,
        // ...outerOverrides }`. readTilePropertiesAt owns that composition;
        // artifact values stay as the typed Life incidences carried by each
        // source object. Do not seed this merged view into the props index —
        // the index records the outer layer's own canonical incidence only.
        const effectiveStats = { cold: false }
        const effectiveProps = this.host.cursorPropsOverride()?.has(cell.label)
          ? outerProps
          : await readTilePropertiesAt(
              segmentsForLabel(cell.label),
              cell.label,
              effectiveStats,
            )
        const props: any = Object.keys(effectiveProps).length > 0
          ? effectiveProps
          : outerProps
        if (effectiveStats.cold) propsCold = true
        if (Object.keys(props).length === 0) {
          if (effectiveStats.cold) cell.pendingProps = true
          throw new Error('no props')
        }
        if (effectiveStats.cold) cell.pendingProps = true

        if (!effectiveStats.cold) cell.pendingProps = false

        // extract border color from properties
        const bc = props?.border?.color
        if (bc && typeof bc === 'string' && /^#?[0-9a-fA-F]{6}$/.test(bc.replace('#', ''))) {
          const hex = bc.startsWith('#') ? bc : `#${bc}`
          const r = parseInt(hex.slice(1, 3), 16) / 255
          const g = parseInt(hex.slice(3, 5), 16) / 255
          const b = parseInt(hex.slice(5, 7), 16) / 255
          cell.borderColor = [r, g, b]
          borderCache.set(cell.label, [r, g, b])
        }

        // extract tags from properties
        const cellTags = props?.['tags']
        if (Array.isArray(cellTags)) {
          tagsCache.set(cell.label, cellTags.filter((t: unknown) => typeof t === 'string'))
        } else {
          tagsCache.set(cell.label, [])
        }

        // extract link presence
        const hasLink = typeof props?.link === 'string' && props.link.length > 0
        linkCache.set(cell.label, hasLink)
        cell.hasLink = hasLink

        const isSubstrate = props?.substrate === true
        substrateCache.set(cell.label, isSubstrate)
        cell.hasSubstrate = isSubstrate

        const hideText = props?.hideText === true
        hideTextCache.set(cell.label, hideText)
        cell.hideText = hideText

        const smallSig = recoverableTileImageSig(props, this.host.flat())
        if (smallSig && isSignature(smallSig)) {
          // Load atlas FIRST, then publish the new sig to the cache.
          // Any concurrent render observing `cellImageCache` during the
          // await sees the previous entry (stale-but-valid) rather than
          // a missing one. The cache transitions from old → new
          // atomically, and by the time it does, the atlas already
          // holds the new image.
          await loadImageOnce(smallSig)
          cell.imageSig = smallSig
          imageCache.set(cell.label, smallSig)
        } else {
          await loadDefaultImage(propsCold)
        }
      } catch {
        // Missing props/index/resource is a timing state, not a third image
        // state. Apply the same deterministic default-set projection used by
        // an image-less props bag; the later fill event retries the explicit
        // signature when its bytes arrive.
        await loadDefaultImage(propsCold)
      }
    }

    await Promise.all(cells.map(loadOne))

    // Close the decode→geometry eviction window. applyGeometry pins these
    // signatures too, but background atlas baking can run after this await and
    // before geometry begins. Pin the just-resolved foreground set now, joined
    // with the currently rendered set for incremental/probe calls, so a valid
    // decode cannot disappear between `loadImage` and its first frame.
    if (!prepareOnly && cacheOwner === this.#locationKey) {
      const pins = new Set<string>()
      for (const rendered of this.host.renderedCells()) {
        if (rendered.imageSig) pins.add(rendered.imageSig)
      }
      for (const cell of cells) {
        if (cell.imageSig) pins.add(cell.imageSig)
      }
      for (const sig of this.host.previewSigs()) pins.add(sig)
      imageAtlas.setPinned(pins)
    }

    // Publish only the labels this invocation resolved, and only while its
    // lineage still owns the live caches. An older async render finishing
    // after navigation must be unable to write into the incoming page.
    const labels = cells.map(cell => cell.label)
    const commit = <T>(source: ReadonlyMap<string, T>, target: Map<string, T>, preserveResolvedOnNull = false): void => {
      publishOwnedProjection({
        owner: cacheOwner,
        currentOwner: this.#locationKey,
        prepareOnly,
        source,
        target,
        labels,
        preserveResolvedOnNull,
      })
    }
    commit(imageCache, this.images, true)
    commit(borderCache, this.borders)
    commit(tagsCache, this.tags)
    commit(linkCache, this.links)
    commit(substrateCache, this.substrates)
    commit(hideTextCache, this.hiddenText)

    // Re-mint absent layer-keyed entries from CANONICAL — never from the
    // location fallback we just served: a stale location entry frozen
    // under a head sig it doesn't belong to would outlive every later
    // correction. Fill-if-empty, so a deliberate head-keyed override
    // (format-painter's index-only paint) always wins over this. Heads
    // are warm, so readTilePropsSigAt is map lookups — no resource
    // fetches. Fire-and-forget: a lost re-mint is just a fallback read
    // on the next pass.
    if (unresolvedByLabel.size > 0 && !prepareOnly) {
      void (async () => {
        try {
          const pairs: Array<[string, string]> = []
          let repaint = false
          for (const [label, served] of unresolvedByLabel) {
            const headSig = headSigByLabel.get(label)
            if (!headSig || this.#propslessHeads.has(headSig)) continue
            // Heads are warm, so each canonical ask is map lookups — no
            // resource fetches, no OPFS walks. The tile's OWN location, not
            // the render's — a gathered tile resolved at the render location
            // would conclude "propsless" against a page it never lived on.
            const canonical = await readTilePropsSigAt(segmentsForLabel(label), label)
            if (!canonical) {
              // Concluded absence, memoised BY HEAD SIG — an edit mints a
              // new head, so the memo can never mask a later props write.
              if (served === null) this.#propslessHeads.add(headSig)
              continue
            }
            pairs.push([headSig, canonical])
            // The pass painted nothing (total miss) or painted a fallback
            // that disagrees with canonical (stale location entry — the
            // adopt-sync/restore shape): shed the cached derivation and
            // repaint with the canonical answer now, not next pass.
            if (served !== canonical && cacheOwner === this.#locationKey) {
              this.images.delete(label)
              repaint = true
            }
          }
          if (pairs.length > 0) {
            // Fill-if-empty against a FRESH read, so a deliberate entry
            // written during the batch always wins over this derivation.
            const freshIndex = readTilePropsIndex()
            let dirty = false
            for (const [headSig, sig] of pairs) {
              if (!freshIndex[headSig]) { freshIndex[headSig] = sig; dirty = true }
            }
            if (dirty) writeTilePropsIndex(freshIndex)
          }
          if (repaint) {
            this.host.repaint()
          }
        } catch { /* cache derivation is best-effort */ }
      })()
    }

    return renderSegments
  }

  /** A just-landed props resource names the picture it stands for. Follow that
   *  pointer now rather than waiting for the next render pass to discover it —
   *  see the call site in loadCellImages' fillFromHost. Silent on anything
   *  that isn't a small JSON blob carrying a recoverable image signature;
   *  a raw image blob simply has no pointer to follow. */
  #prefetchNestedImageSig = async (
    blob: Blob,
    fill: (sig: string, label?: string) => void,
  ): Promise<void> => {
    try {
      if (blob.size > 64 * 1024) return   // an image, not a pointer
      const props = JSON.parse(await blob.text())
      const nested = recoverableTileImageSig(props, this.host.flat())
      if (!nested || !isSignature(nested)) return
      if (this.host.imageAtlas()?.hasImage(nested)) return
      if (await this.decode(nested)) return   // already here
      fill(nested)
    } catch { /* not a pointer — nothing to chain */ }
  }

  /** The cheapest LOCAL bytes for an image sig: the cell-sized optimized
   *  visual when minted, else the raw resource. Never network. A raw
   *  fallback heavy enough to matter demands the optimized form for next
   *  time — minted in the optimize phase (visual-optimizer.drone). */
  decode = async (sig: string): Promise<Blob | null> => {
    // PACK FIRST. The layer's manifest is one file carrying the full array of
    // what its tiles need to bind their visuals — including these bytes — so a
    // location that has a pack decodes every image WITHOUT a per-image read.
    // That is the whole point of a per-LAYER optimization: two reads to paint
    // a page, not two plus one per tile.
    const packed = packedVisual(sig)
    if (packed) return packed
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as {
      getResourceLocal: (s: string) => Promise<Blob | null>
      getOptimizedVisual?: (s: string) => Promise<Blob | null>
    } | undefined
    if (!store) return null
    // The atlas remains keyed by the outer incidence sig so lineage identity
    // is preserved even though decoding needs the terminal shared bytes.
    const raw = await resolveLocalResourceReference(store, sig, { optimized: true })
    if (raw && raw.size >= VISUAL_DEMAND_MIN_BYTES) {
      this.host.emit('visual:wanted', { sig })
    }
    return raw
  }
}
