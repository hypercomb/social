// link/link-drop.worker.ts
// Intercepts drag-and-drop link events on the document and routes them
// through the safety service + tile editor pipeline.

import { Worker, EffectBus, portableTileSignatureFromTypes, requestConfirm } from '@hypercomb/core'
import { parseYouTubeVideoId, fetchYouTubeOpenGraph, type YouTubeOpenGraph } from './youtube.js'
import { fetchImageBlob, isImageUrl } from './photo.js'
import { normalizeLink } from './normalize.js'
import { defaultNameForLink } from './link-name.js'
import { byDeadline, CARD_DEADLINE_MS, PICTURE_DEADLINE_MS, SAFETY_DEADLINE_MS } from './deadline.js'
import { verifyLinkDropCard } from './link-drop-card.view.js'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { LinkSafetyService, SafetyVerdict } from '../safety/link-safety.service.js'
import { armImageBlob, storeImageResources } from '../editor/arm-resource.js'
import {
  linkDropDestination,
  persistDroppedTileLink,
  type DroppedLinkImage,
} from './link-drop-destination.js'
import './youtube-metadata-queue.js'
import type { YouTubeMetadataQueue } from './youtube-metadata-queue.js'
import {
  cellLocationSig,
  isParticipantImage,
  readTilePropertiesAt,
  readTilePropsIndex,
  readTilePropsSigAt,
  writeTilePropertiesAt,
  writeTilePropsIndex,
} from '../editor/tile-properties.js'

const NO_OPEN_GRAPH: YouTubeOpenGraph = { title: null, thumbnailUrl: null }

type TileOverlay = {
  labelAtClient(clientX: number, clientY: number): string | null
}

type Lineage = {
  explorerSegments?(): readonly string[]
}

export class LinkDropWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'linking'

  public override description =
    'Intercepts browser drag-and-drop link events and routes URLs into the tile editor.'

  protected override emits = ['command:arm-resource', 'link:safety-blocked', 'link:safety-warning']

  // NO in-flight guard. There was one, held across every await of the route —
  // safety check, card read, picture fetch — so a second drop during those
  // seconds was DISCARDED without a trace, and any route that failed to settle
  // (a loopback safety endpoint behind a permission prompt, say) wedged the
  // gesture permanently: every drop afterwards returned at the guard and
  // nothing ever happened again. Each drop is its own gesture now, carrying
  // its own armId, and per-cell writes already serialise on their own lock.

  constructor() {
    super()
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('drop', this.#onDrop)
    // A drag can leave without dropping — the ring must go with it.
    document.addEventListener('dragleave', this.#onDragLeave)
    document.addEventListener('dragend', this.#endDrag)
    // THE PHONE'S DROP. No drag event ever fires on a touch device, which
    // for a long time meant this whole pipeline — safety check, title
    // unfurl, poster thumbnail, auto-commit — was desktop-only, and the one
    // thing a phone newcomer would try (pasting the URL into the command
    // line) minted husk cells out of the URL's slashes instead. The command
    // line now recognises a pasted/typed URL and hands it here; from this
    // point it IS a canvas drop, same route end to end.
    EffectBus.on<{ url?: unknown }>('link:intake', payload => {
      const raw = typeof payload?.url === 'string' ? payload.url.trim() : ''
      if (!raw) return
      // Hand-typed links often lack a scheme ("www.x.com") — normalize
      // before the scheme gate, exactly as the open path does.
      const url = normalizeLink(raw)
      if (!/^https?:\/\//i.test(url)) return
      const targetSegments = [...(this.#lineage?.explorerSegments?.() ?? [])]
      void this.#routeLink(url, null, targetSegments, null)
    })
  }

  protected override act = async (): Promise<void> => { }

  /** Only a leave that exits the WINDOW ends the drag; leaving one element for
   *  the next fires the same event and would flicker the ring off and on. */
  #onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget === null) this.#endDrag()
  }

  // ── drag handlers ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    // allow drops on the surface — but not when over form inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return
    // A portable tile also carries text/plain, but its signature is not a
    // hyperlink. Leave the gesture to PortableTileDropDrone so this worker
    // does not replace its exact-slot preview with the link-at-top ring.
    if (portableTileSignatureFromTypes(e.dataTransfer?.types ?? [])) return

    // Claim anything carrying a link. `Files` is ADVERTISED by sources that
    // deliver no file at all — a dragged browser tab, a link out of a native
    // app — and refusing those here meant never calling preventDefault, so the
    // drop was never delivered and the gesture did nothing whatsoever. Whether
    // a real file came is knowable only at drop, and that is where we decide.
    const types = e.dataTransfer?.types ?? []
    const hasLink = types.includes('text/uri-list') || types.includes('text/plain')
    if (!hasLink) return
    e.preventDefault()

    // Say that a drag is in the air. Without this the landing ring never
    // appeared for a link and the overlay went on HOVER-highlighting whatever
    // tile the pointer passed — a tile the drop had nothing to do with. The
    // ring answers the question the pointer is actually asking, and the
    // overlay stops answering a different one.
    if (!this.#dragAnnounced) {
      this.#dragAnnounced = true
      EffectBus.emit('drop:dragging', { active: true, atTop: true })
    }
  }

  /** True between the first dragover of a link drag and its end. */
  #dragAnnounced = false

  #endDrag = (): void => {
    if (!this.#dragAnnounced) return
    this.#dragAnnounced = false
    EffectBus.emit('drop:dragging', { active: false })
  }

  #onDrop = (e: DragEvent): void => {
    this.#endDrag()
    // don't steal drops from inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return

    // The SAME arbitration ImageDropDrone applies, from the other side: a
    // drag carrying both an image file and a URL is a HYPERLINK drag — a
    // YouTube video dragged off its page arrives exactly like this — and it
    // is ours; the dragged file becomes the tile's picture. Only a bare
    // image drag (no URL, or a URL that IS the image) goes to the image path.
    const url = this.#extractUrl(e)
    if (!url) return
    const files = e.dataTransfer?.files
    if ((files?.length ?? 0) > 0 && isImageUrl(url)) return

    let draggedImage: File | null = null
    if (files) {
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) { draggedImage = files[i]; break }
      }
    }

    // A drop belongs to the tile under the release point. Selection is not a
    // proxy for aiming: a participant can drop on an unselected tile, or on
    // empty canvas while some other tile remains selected.
    const targetLabel = this.#tileOverlay?.labelAtClient(e.clientX, e.clientY) ?? null
    // Bind the address at gesture time. Safety/thumbnail requests can span
    // navigation, but the drop must always write where it landed.
    const targetSegments = [...(this.#lineage?.explorerSegments?.() ?? [])]

    e.preventDefault()
    void this.#routeLink(url, targetLabel, targetSegments, draggedImage)
  }

  // ── URL extraction ────────────────────────────────────────────

  #extractUrl(e: DragEvent): string | null {
    // prefer text/uri-list (single URL per line, skip comments)
    const uriList = e.dataTransfer?.getData('text/uri-list') ?? ''
    for (const line of uriList.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#') && /^https?:\/\//i.test(trimmed)) {
        return trimmed
      }
    }

    // fallback to plain text
    const plain = (e.dataTransfer?.getData('text/plain') ?? '').trim()
    if (/^https?:\/\//i.test(plain)) return plain

    return null
  }

  // ── routing ───────────────────────────────────────────────────

  async #routeLink(
    url: string,
    targetLabel: string | null,
    targetSegments: readonly string[],
    draggedImage: Blob | null = null,
  ): Promise<void> {
    try {
      const editorSvc = this.#editorService
      const destination = linkDropDestination(editorSvc?.mode, targetLabel)
      const videoId = parseYouTubeVideoId(url)

      // 1. Arm the command line ON RELEASE — before the safety check, before
      // any network read, before anything that can be slow or can fail.
      //
      // Everything this gesture needs is already in hand: the URL, and a name
      // derived from it. What follows only ever IMPROVES that slot. Nothing
      // downstream may decide whether the participant sees that their drop
      // landed — a safety checker whose loopback endpoint isn't listening, a
      // card read the browser blocks, a slow network: each used to mean an
      // empty line and a chevron that never lit.
      const armId = destination.kind === 'canvas' ? this.#armLinkNow(url, videoId) : null

      // 2. safety check — it can retract the arm, but it can never delay it
      const safety = this.#safetyService
      let verdict: SafetyVerdict = { decision: 'allow', reason: 'no safety service' }
      if (safety) {
        // Its checks run through one queue, so a single stalled verdict would
        // hold every drop after it. Past the deadline the drop proceeds.
        verdict = await byDeadline(() => safety.check(url), SAFETY_DEADLINE_MS,
          { decision: 'allow', reason: 'safety check timed out' })
      }

      if (verdict.decision === 'deny') {
        if (armId) EffectBus.emit('command:disarm-resource', { armId })
        EffectBus.emit('link:safety-blocked', { url, reason: verdict.reason })
        console.warn('[link-drop] blocked:', url, verdict.reason)
        return
      }

      // 3. The open-graph card, read ONCE per drop and shared by every
      // destination: its title seeds the command line on a create, its image
      // becomes the picture on whichever tile the drop lands on.
      const openGraph = videoId
        ? await byDeadline(
            (signal) => fetchYouTubeOpenGraph(url, fetch, signal),
            CARD_DEADLINE_MS,
            { title: null, thumbnailUrl: null },
          )
        : NO_OPEN_GRAPH

      // Show what the drop actually READ, right where the participant is
      // looking. Reporting only — the gesture carries on behind it.
      verifyLinkDropCard({
        url,
        title: openGraph.title,
        imageUrl: openGraph.thumbnailUrl,
        destination: destination.kind === 'tile'
          ? { kind: 'tile', label: destination.label }
          : { kind: 'create' },
      })

      // A drop on an existing tile is a complete edit gesture: persist the
      // link immediately. Requiring an unrelated editor Save left the field
      // looking populated while the canonical tile properties stayed stale.
      if (destination.kind === 'tile') {
        await this.#saveTileLink(destination.label, targetSegments, url, openGraph.thumbnailUrl)
        if (verdict.decision === 'warn') {
          EffectBus.emit('link:safety-warning', { url, reason: verdict.reason })
          console.warn('[link-drop] warning:', url, verdict.reason)
        }
        return
      }

      // 4. resolve thumbnail / image — the drag may have BROUGHT one, and
      // what the participant dragged beats anything we could go and fetch.
      let thumbnailBlob: Blob | null = draggedImage

      // 4a. YouTube — fetch the open-graph poster frame
      if (!thumbnailBlob && openGraph.thumbnailUrl) {
        thumbnailBlob = await this.#fetchThumbnail(openGraph.thumbnailUrl)
      }

      // 4b. Direct image URL — fetch with forced MIME type (safe: no script execution)
      // Handles both extension-based URLs (.jpg, .png, etc.) and extensionless
      // URLs (picsum.photos, CDN redirects) via HEAD probe fallback.
      if (!thumbnailBlob) {
        thumbnailBlob = await byDeadline(() => fetchImageBlob(url), PICTURE_DEADLINE_MS, null)
      }

      // 5. Route by the actual release target.
      // Path A: editor already open — set link + optional image
      if (destination.kind === 'editor' && editorSvc) {
        editorSvc.setLink(url)
        if (thumbnailBlob) {
          editorSvc.setLargeBlob(thumbnailBlob)
          await this.#loadImageWhenReady(thumbnailBlob)
        }
      }
      // Path B: empty space — the drop IS the creation. Fill the slot armed on
      // release with what the card turned out to hold, then commit it: dropping
      // a link on empty space means "make this a tile", and waiting for Enter
      // made a finished gesture look like a dead one. The title stays in the
      // line afterwards, naming what just landed.
      else {
        await this.#armLink(url, videoId, thumbnailBlob, openGraph.title, armId)
        EffectBus.emit('command:commit-armed', { armId })
      }

      // 6. emit warning if verdict was warn
      if (verdict.decision === 'warn') {
        EffectBus.emit('link:safety-warning', { url, reason: verdict.reason })
        console.warn('[link-drop] warning:', url, verdict.reason)
      }
    } catch (err) {
      console.warn('[link-drop] failed:', err)
    }
  }

  // ── arm resource ──────────────────────────────────────────────

  /**
   * Arm the link the instant the drop lands, holding nothing but the URL.
   *
   * The identity it returns is what makes the later fill-in safe: the
   * command-line applies the card to THIS armed slot only while it is still
   * the armed slot. Commit or dismiss retires the identity, so a title that
   * arrives after the participant has already moved on is dropped instead of
   * resurrecting a chevron they closed.
   */
  #armLinkNow(url: string, videoId: string | null): string {
    const armId = `link:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    EffectBus.emit('command:arm-resource', {
      armId,
      previewUrl: '',
      largeSig: '',
      smallPointSig: null,
      smallFlatSig: null,
      url,
      type: videoId ? 'youtube' as const : 'link' as const,
      atTop: true,
      // A name from the URL alone, so the line is NEVER empty after a drop.
      // The card's title replaces it when it arrives — and when no card ever
      // arrives (a platform that publishes none, or a read the browser's
      // tracking protection blocks) this is the whole name, and the drop is
      // still completable instead of an armed chevron over a dead line.
      name: videoId ? `youtube ${videoId}` : defaultNameForLink(url),
    })
    return armId
  }

  /**
   * Fill the armed slot with what the card turned out to hold: the picture
   * (stored as content-addressed resources) and the default name. The tile is
   * created on Enter by CommandLineComponent.
   */
  async #armLink(
    url: string,
    videoId: string | null,
    thumbnailBlob: Blob | null,
    name: string | null,
    armId: string | null,
  ): Promise<void> {
    const type = videoId ? 'youtube' as const : 'link' as const

    // `name` is the open-graph title, already read for this drop. It is the
    // default tile name and nothing more — the command-line pre-fills and
    // selects it, so the next keystroke replaces it and Enter accepts it.
    // No title read means the URL's own name stands; never regress to null,
    // which would leave the armed slot describing less than it did on release.
    const named = name ?? (videoId ? `youtube ${videoId}` : defaultNameForLink(url))

    // The picture is stored best-effort. Storing it can fail outright — a
    // second tab holding the packed store is enough — and when it did, the
    // throw took the whole gesture with it: no title, no tile, no LINK. The
    // link is the part that must always land, so a failed picture degrades to
    // the bare arm instead of ending the drop.
    if (thumbnailBlob) {
      try {
        if (await armImageBlob(thumbnailBlob, { url, type, name: named, armId, atTop: true })) return
      } catch (err) {
        console.warn('[link-drop] picture could not be stored — keeping the link:', err)
      }
    }
    // No picture — emit the bare arm anyway so the chevron shows a type badge
    // and the cell gets the link attached on commit.
    EffectBus.emit('command:arm-resource', {
      armId,
      previewUrl: '',
      largeSig: '',
      smallPointSig: null,
      smallFlatSig: null,
      url,
      type,
      name: named,
      atTop: true,
    })
  }

  // ── helpers ───────────────────────────────────────────────────

  async #saveTileLink(
    cell: string,
    parentSegments: readonly string[],
    url: string,
    thumbnailUrl: string | null,
  ): Promise<void> {
    const existing = await readTilePropertiesAt(parentSegments, cell)

    // A tile holds ONE link. Replacing one the participant put there is not
    // something a drop should do behind their back — a drop can land a hex
    // away from where it was aimed, and the old address would be gone with no
    // sign it had ever been there. Ask, and name both, before overwriting.
    const priorLink = typeof existing['link'] === 'string' ? existing['link'] as string : ''
    if (priorLink && priorLink !== url) {
      const replace = await requestConfirm({
        title: 'Replace this tile’s link?',
        message: `“${cell}” already links to ${priorLink}`,
        warning: `Dropping replaces it with ${url}`,
        confirmLabel: 'Replace',
        cancelLabel: 'Keep the old one',
      })
      if (!replace) return
    }

    const image = await this.#tileDropImage(existing, thumbnailUrl)

    await persistDroppedTileLink(
      parentSegments,
      cell,
      url,
      {
        writeProperties: writeTilePropertiesAt,
        readPropertiesSig: readTilePropsSigAt,
        locationSig: cellLocationSig,
        readIndex: readTilePropsIndex,
        writeIndex: writeTilePropsIndex,
      },
      image,
      existing,
    )

    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', {
      cell,
      segments: parentSegments,
    })
    if (parseYouTubeVideoId(url)) {
      this.#metadataQueue?.enqueue({ segments: parentSegments, cell, url })
    }
  }

  /** Fetch a poster frame. Never throws — a missing picture is not a failure. */
  async #fetchThumbnail(thumbnailUrl: string): Promise<Blob | null> {
    return byDeadline(async (signal) => {
      const resp = await fetch(thumbnailUrl, { signal })
      return resp.ok ? await resp.blob() : null
    }, PICTURE_DEADLINE_MS, null)
  }

  /**
   * The picture a drop may put on an EXISTING tile — or null, which is a
   * perfectly good answer. Three ways to get null, and any one is enough:
   * the link carries no picture, the fetch or the store fails, or the tile
   * already wears a picture a PERSON chose. That last one is the point of
   * the check: a drop is "add this link", not "replace my artwork". A
   * substrate default is filler, so the poster frame is an improvement and
   * takes its place.
   */
  async #tileDropImage(
    existing: Record<string, unknown>,
    thumbnailUrl: string | null,
  ): Promise<DroppedLinkImage | null> {
    if (!thumbnailUrl || isParticipantImage(existing)) return null

    const blob = await this.#fetchThumbnail(thumbnailUrl)
    if (!blob) return null

    const stored = await storeImageResources(blob)
    if (!stored) return null
    // The preview Object URL is the arming flow's affordance; this path has
    // no chevron to show it in, so it is released immediately.
    if (stored.previewUrl) {
      try { URL.revokeObjectURL(stored.previewUrl) } catch { /* already gone */ }
    }
    return {
      largeSig: stored.largeSig,
      smallPointSig: stored.smallPointSig,
      smallFlatSig: stored.smallFlatSig,
    }
  }

  async #loadImageWhenReady(blob: Blob): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ie = this.#imageEditor
      if (ie) {
        await ie.loadImage(blob)
        if (ie.hasImage) return
      }
      await new Promise<void>(r => setTimeout(r, 100))
    }
  }

  // ── IoC accessors ─────────────────────────────────────────────

  get #editorService(): TileEditorService | undefined {
    return get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService | undefined
  }

  get #imageEditor(): ImageEditorService | undefined {
    return get('@diamondcoreprocessor.com/ImageEditorService') as ImageEditorService | undefined
  }

  get #tileOverlay(): TileOverlay | undefined {
    return get('@diamondcoreprocessor.com/TileOverlayDrone') as TileOverlay | undefined
  }

  get #lineage(): Lineage | undefined {
    return get('@hypercomb.social/Lineage') as Lineage | undefined
  }

  get #metadataQueue(): YouTubeMetadataQueue | undefined {
    return get('@diamondcoreprocessor.com/YouTubeMetadataQueue') as YouTubeMetadataQueue | undefined
  }

  get #safetyService(): LinkSafetyService | undefined {
    return get('@diamondcoreprocessor.com/LinkSafetyService') as LinkSafetyService | undefined
  }
}

const _linkDrop = new LinkDropWorker()
window.ioc.register('@diamondcoreprocessor.com/LinkDropWorker', _linkDrop)
