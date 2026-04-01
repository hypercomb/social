// diamondcoreprocessor.com/link/link-drop.worker.ts
// Intercepts drag-and-drop link events on the document and routes them
// through the safety service + tile editor pipeline.

import { Worker, EffectBus } from '@hypercomb/core'
import { parseYouTubeVideoId, youTubeThumbnailUrl } from './youtube.js'
import { fetchImageBlob } from './photo.js'
import type { TileEditorService } from '../editor/tile-editor.service.js'
import type { ImageEditorService } from '../editor/image-editor.service.js'
import type { SelectionService } from '../selection/selection.service.js'
import type { LinkSafetyService, SafetyVerdict } from '../safety/link-safety.service.js'

export class LinkDropWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'linking'

  public override description =
    'Intercepts browser drag-and-drop link events and routes URLs into the tile editor.'

  protected override emits = ['cell:added', 'link:safety-blocked', 'link:safety-warning']

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
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

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
    const el = document.activeElement
    if (el && (el as HTMLElement).matches?.('input, textarea, select, [contenteditable]')) return

    // don't steal file drops (those go to ImageDropDrone / ImagePasteWorker)
    const hasFiles = (e.dataTransfer?.types ?? []).includes('Files')
    if (hasFiles) return

    const url = this.#extractUrl(e)
    if (!url) return

    e.preventDefault()
    void this.#routeLink(url)
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

  async #routeLink(url: string): Promise<void> {
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

      // 3. three-path routing (same as ImagePasteWorker)
      const editorSvc = this.#editorService

      // Path A: editor already open — set link + optional image
      if (editorSvc?.mode === 'editing') {
        editorSvc.setLink(url)
        if (thumbnailBlob) {
          editorSvc.setLargeBlob(thumbnailBlob)
          await this.#loadImageWhenReady(thumbnailBlob)
        }
      }
      // Path B: tile selected — open editor, then set link + image
      else if (this.#selection && this.#selection.count > 0 && this.#selection.active) {
        const cell = this.#selection.active
        EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
        await this.#waitForEditorMode()
        this.#editorService?.setLink(url)
        if (thumbnailBlob) {
          this.#editorService?.setLargeBlob(thumbnailBlob)
          await this.#loadImageWhenReady(thumbnailBlob)
        }
      }
      // Path C: nothing selected — create new cell, open editor, set link + image
      else {
        const label = 'link-' + Date.now()
        EffectBus.emit('cell:added', { cell: label })

        // let history record the add before opening editor
        await new Promise<void>(r => setTimeout(r, 100))

        EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
        await this.#waitForEditorMode()
        this.#editorService?.setLink(url)
        if (thumbnailBlob) {
          this.#editorService?.setLargeBlob(thumbnailBlob)
          await this.#loadImageWhenReady(thumbnailBlob)
        }
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

  // ── helpers ───────────────────────────────────────────────────

  async #waitForEditorMode(): Promise<void> {
    if (this.#editorService?.mode === 'editing') return
    await new Promise<void>(resolve => {
      const off = EffectBus.on<{ active: boolean }>('editor:mode', (payload) => {
        if (payload?.active) { off(); resolve() }
      })
      setTimeout(() => { off(); resolve() }, 2000)
    })
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

  get #selection(): SelectionService | undefined {
    return get('@diamondcoreprocessor.com/SelectionService') as SelectionService | undefined
  }

  get #safetyService(): LinkSafetyService | undefined {
    return get('@diamondcoreprocessor.com/LinkSafetyService') as LinkSafetyService | undefined
  }
}

const _linkDrop = new LinkDropWorker()
window.ioc.register('@diamondcoreprocessor.com/LinkDropWorker', _linkDrop)
