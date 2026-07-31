// diamondcoreprocessor.com/link/link-drop.worker.ts
// Intercepts drag-and-drop link events on the document and routes them
// through the safety service + tile editor pipeline.

import { Worker, EffectBus } from '@hypercomb/core'
import { parseYouTubeVideoId, youTubeThumbnailUrl, fetchYouTubeTitle } from './youtube.js'
import { fetchImageBlob } from './photo.js'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { LinkSafetyService, SafetyVerdict } from '../safety/link-safety.service.js'
import { armImageBlob } from '../editor/arm-resource.js'
import { linkDropDestination, persistDroppedTileLink } from './link-drop-destination.js'
import './youtube-metadata-queue.js'
import type { YouTubeMetadataQueue } from './youtube-metadata-queue.js'
import {
  cellLocationSig,
  readTilePropsIndex,
  readTilePropsSigAt,
  writeTilePropertiesAt,
  writeTilePropsIndex,
} from '../editor/tile-properties.js'

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

  #busy = false

  constructor() {
    super()
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('drop', this.#onDrop)
  }

  protected override act = async (): Promise<void> => { }

  // ── drag handlers ─────────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    // allow drops on the surface — but not when over form inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return

    // only claim the drag if it looks like a link (not a file)
    const types = e.dataTransfer?.types ?? []
    const hasLink = types.includes('text/uri-list') || types.includes('text/plain')
    const hasFiles = types.includes('Files')
    if (hasLink && !hasFiles) {
      e.preventDefault()
    }
  }

  #onDrop = (e: DragEvent): void => {
    // don't steal drops from inputs
    const tgt = e.target as HTMLElement | null
    if (tgt?.closest?.('input, textarea, select, [contenteditable]')) return

    // don't steal file drops (those go to ImageDropDrone / ImagePasteWorker)
    const hasFiles = (e.dataTransfer?.types ?? []).includes('Files')
    if (hasFiles) return

    const url = this.#extractUrl(e)
    if (!url) return

    // A drop belongs to the tile under the release point. Selection is not a
    // proxy for aiming: a participant can drop on an unselected tile, or on
    // empty canvas while some other tile remains selected.
    const targetLabel = this.#tileOverlay?.labelAtClient(e.clientX, e.clientY) ?? null
    // Bind the address at gesture time. Safety/thumbnail requests can span
    // navigation, but the drop must always write where it landed.
    const targetSegments = [...(this.#lineage?.explorerSegments?.() ?? [])]

    e.preventDefault()
    void this.#routeLink(url, targetLabel, targetSegments)
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
  ): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      // 1. safety check
      const safety = this.#safetyService
      let verdict: SafetyVerdict = { decision: 'allow', reason: 'no safety service' }
      if (safety) {
        verdict = await safety.check(url)
      }

      if (verdict.decision === 'deny') {
        EffectBus.emit('link:safety-blocked', { url, reason: verdict.reason })
        console.warn('[link-drop] blocked:', url, verdict.reason)
        return
      }

      const editorSvc = this.#editorService
      const destination = linkDropDestination(editorSvc?.mode, targetLabel)

      // A drop on an existing tile is a complete edit gesture: persist the
      // link immediately. Requiring an unrelated editor Save left the field
      // looking populated while the canonical tile properties stayed stale.
      if (destination.kind === 'tile') {
        await this.#saveTileLink(destination.label, targetSegments, url)
        if (verdict.decision === 'warn') {
          EffectBus.emit('link:safety-warning', { url, reason: verdict.reason })
          console.warn('[link-drop] warning:', url, verdict.reason)
        }
        return
      }

      // 2. resolve thumbnail / image
      let thumbnailBlob: Blob | null = null

      // 2a. YouTube — fetch video thumbnail
      const videoId = parseYouTubeVideoId(url)
      if (videoId) {
        try {
          const thumbUrl = youTubeThumbnailUrl(videoId)
          const resp = await fetch(thumbUrl)
          if (resp.ok) thumbnailBlob = await resp.blob()
        } catch {
          // thumbnail fetch failed — proceed without image
        }
      }

      // 2b. Direct image URL — fetch with forced MIME type (safe: no script execution)
      // Handles both extension-based URLs (.jpg, .png, etc.) and extensionless
      // URLs (picsum.photos, CDN redirects) via HEAD probe fallback.
      if (!thumbnailBlob) {
        thumbnailBlob = await fetchImageBlob(url)
      }

      // 3. Route by the actual release target.
      // Path A: editor already open — set link + optional image
      if (destination.kind === 'editor' && editorSvc) {
        editorSvc.setLink(url)
        if (thumbnailBlob) {
          editorSvc.setLargeBlob(thumbnailBlob)
          await this.#loadImageWhenReady(thumbnailBlob)
        }
      }
      // Path B: empty canvas — arm the link in the command-line chevron slot.
      // User types a cell name and presses Enter to commit.
      else {
        await this.#armLink(url, videoId, thumbnailBlob)
      }

      // 4. emit warning if verdict was warn
      if (verdict.decision === 'warn') {
        EffectBus.emit('link:safety-warning', { url, reason: verdict.reason })
        console.warn('[link-drop] warning:', url, verdict.reason)
      }
    } catch (err) {
      console.warn('[link-drop] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  // ── arm resource ──────────────────────────────────────────────

  /**
   * Store the resolved thumbnail (if any) as a content-addressed resource
   * and emit `command:arm-resource` so the command-line displays the preview
   * in its chevron slot. The tile is created on Enter by CommandLineComponent.
   */
  async #armLink(url: string, videoId: string | null, thumbnailBlob: Blob | null): Promise<void> {
    const type = videoId ? 'youtube' as const : 'link' as const

    // Default tile name: the YouTube video's title (via oEmbed). Overridable —
    // the command-line pre-fills it but the user can retype before Enter.
    const name = videoId ? await fetchYouTubeTitle(url) : null

    if (thumbnailBlob) {
      await armImageBlob(thumbnailBlob, { url, type, name })
      return
    }
    // No thumbnail available — emit a bare arm payload so the chevron shows a
    // type badge and the cell gets the link attached on commit.
    EffectBus.emit('command:arm-resource', {
      previewUrl: '',
      largeSig: '',
      smallPointSig: null,
      smallFlatSig: null,
      url,
      type,
      name,
    })
  }

  // ── helpers ───────────────────────────────────────────────────

  async #saveTileLink(
    cell: string,
    parentSegments: readonly string[],
    url: string,
  ): Promise<void> {
    await persistDroppedTileLink(parentSegments, cell, url, {
      writeProperties: writeTilePropertiesAt,
      readPropertiesSig: readTilePropsSigAt,
      locationSig: cellLocationSig,
      readIndex: readTilePropsIndex,
      writeIndex: writeTilePropsIndex,
    })

    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', {
      cell,
      segments: parentSegments,
    })
    if (parseYouTubeVideoId(url)) {
      this.#metadataQueue?.enqueue({ segments: parentSegments, cell, url })
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
