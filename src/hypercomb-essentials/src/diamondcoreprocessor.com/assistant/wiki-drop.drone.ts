// diamondcoreprocessor.com/assistant/wiki-drop.drone.ts
// Intercepts browser drag-and-drop of text/document files on the canvas
// and routes them to WikiDrone for LLM decomposition into wiki cells.
//
// Handles non-image file types: .txt, .md, .html, .pdf
// ImageDropDrone handles image/* — no conflict.

import { Drone, EffectBus } from '@hypercomb/core'

const ACCEPTED_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
])

const ACCEPTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.pdf'])

function isDocumentFile(file: File): boolean {
  if (ACCEPTED_TYPES.has(file.type)) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return ACCEPTED_EXTENSIONS.has(ext)
}

export class WikiDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description =
    'Intercepts drag-and-drop document files and routes them to WikiDrone for knowledge decomposition.'

  protected override emits = ['wiki:ingest', 'drop:dragging']
  protected override listens = ['render:host-ready']

  #effectsRegistered = false
  #dragging = false

  constructor() {
    super()
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('dragleave', this.#onDragLeave)
    document.addEventListener('drop', this.#onDrop)
    document.addEventListener('dragend', this.#onDragEnd)
  }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true
  }

  // ── drag handlers ─────────────────────────────────────────

  #onDragOver = (e: DragEvent): void => {
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return

    // Don't claim if it looks like an image — let ImageDropDrone handle it
    const items = e.dataTransfer?.items
    if (items && items.length > 0) {
      const first = items[0]
      if (first.kind === 'file' && first.type.startsWith('image/')) return
    }

    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'

    if (!this.#dragging) {
      this.#dragging = true
      this.emitEffect('drop:dragging', { active: true, previewUrl: null })
    }
  }

  #onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget) return
    this.#clearDragging()
  }

  #onDragEnd = (): void => {
    this.#clearDragging()
  }

  #onDrop = (e: DragEvent): void => {
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('Files')) return

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) { this.#clearDragging(); return }

    // Find first document file (skip images — those go to ImageDropDrone)
    let docFile: File | null = null
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/')) continue
      if (isDocumentFile(files[i])) {
        docFile = files[i]
        break
      }
    }

    if (!docFile) { this.#clearDragging(); return }

    e.preventDefault()
    this.#clearDragging()

    void this.#readAndEmit(docFile)
  }

  // ── file reading ──────────────────────────────────────────

  async #readAndEmit(file: File): Promise<void> {
    try {
      const content = await file.text()

      if (!content.trim()) {
        console.warn('[wiki-drop] Empty file:', file.name)
        return
      }

      EffectBus.emit('wiki:ingest', {
        content,
        source: 'file-drop',
        fileName: file.name,
      })

      console.log(`[wiki-drop] ${file.name} (${content.length} chars) → wiki:ingest`)
    } catch (err) {
      console.warn('[wiki-drop] Failed to read file:', err)
    }
  }

  // ── helpers ───────────────────────────────────────────────

  #clearDragging(): void {
    if (!this.#dragging) return
    this.#dragging = false
    this.emitEffect('drop:dragging', { active: false, previewUrl: null })
  }
}

const _wikiDrop = new WikiDropDrone()
window.ioc.register('@diamondcoreprocessor.com/WikiDropDrone', _wikiDrop)
console.log('[WikiDropDrone] Loaded')
