// hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-editor.service.ts
// Editor state service: mode, seed, properties, large image blob.
// Extends EventTarget so Angular can bind via fromRuntime().

import { EffectBus } from '@hypercomb/core'

export type EditorModePayload = { active: boolean }

export class TileEditorService extends EventTarget {

  #mode: 'idle' | 'editing' = 'idle'
  #seed = ''
  #properties: Record<string, unknown> = {}
  #largeBlob: Blob | null = null

  // ── getters ────────────────────────────────────────────────────

  get mode(): 'idle' | 'editing' { return this.#mode }
  get seed(): string { return this.#seed }
  get properties(): Record<string, unknown> { return this.#properties }
  get largeBlob(): Blob | null { return this.#largeBlob }

  // ── specific property accessors (object notation) ──────────────

  get link(): string {
    return String((this.#properties as any).link ?? '')
  }

  get borderColor(): string {
    return String((this.#properties as any).border?.color ?? '')
  }

  // ── state mutations ────────────────────────────────────────────

  readonly open = (
    seed: string,
    properties: Record<string, unknown>,
    largeBlob: Blob | null
  ): void => {
    this.#seed = seed
    this.#properties = { ...properties }
    this.#largeBlob = largeBlob
    this.#mode = 'editing'
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: true })
  }

  readonly close = (): void => {
    this.#mode = 'idle'
    this.#seed = ''
    this.#properties = {}
    this.#largeBlob = null
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: false })
  }

  readonly setLink = (value: string): void => {
    if (value) {
      (this.#properties as any).link = value
    } else {
      delete (this.#properties as any).link
    }
    this.#emit()
  }

  readonly setBorderColor = (value: string): void => {
    if (value) {
      if (!(this.#properties as any).border) {
        (this.#properties as any).border = {}
      }
      (this.#properties as any).border.color = value
    } else {
      if ((this.#properties as any).border) {
        delete (this.#properties as any).border.color
        if (Object.keys((this.#properties as any).border).length === 0) {
          delete (this.#properties as any).border
        }
      }
    }
    this.#emit()
  }

  readonly setLargeBlob = (blob: Blob): void => {
    this.#largeBlob = blob
    this.#emit()
  }

  readonly updateTransform = (x: number, y: number, scale: number): void => {
    if (!(this.#properties as any).large) {
      (this.#properties as any).large = {}
    }
    const large = (this.#properties as any).large
    large.x = x
    large.y = y
    large.scale = scale
    // no emit — transform updates are high frequency (drag/zoom)
  }

  // ── internal ───────────────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorService',
  new TileEditorService()
)
