// editor/tile-editor.service.ts
import { EffectBus } from '@hypercomb/core'

export type EditorModePayload = { active: boolean }

export class TileEditorService extends EventTarget {

  #mode: 'idle' | 'editing' = 'idle'
  #cell = ''
  #targetSegments: readonly string[] = []
  #properties: Record<string, unknown> = {}
  #largeBlob: Blob | null = null

  // ── getters ────────────────────────────────────────────────────

  get mode(): 'idle' | 'editing' { return this.#mode }
  get cell(): string { return this.#cell }
  /** Content-bearing address for this edit. A Portal reference supplies its
   * canonical target; ordinary tiles supply their own lineage location. */
  get targetSegments(): readonly string[] { return this.#targetSegments }
  get properties(): Record<string, unknown> { return this.#properties }
  get largeBlob(): Blob | null { return this.#largeBlob }

  // ── specific property accessors (object notation) ──────────────

  get link(): string {
    return String((this.#properties as any).link ?? '')
  }

  get borderColor(): string {
    return String((this.#properties as any).border?.color ?? '')
  }

  get backgroundColor(): string {
    return String((this.#properties as any).background?.color ?? '')
  }

  get hideText(): boolean {
    return (this.#properties as any).hideText === true
  }

  // ── state mutations ────────────────────────────────────────────

  readonly open = (
    cell: string,
    properties: Record<string, unknown>,
    largeBlob: Blob | null,
    targetSegments: readonly string[] = [],
  ): void => {
    this.#cell = cell
    this.#targetSegments = [...targetSegments]
    this.#properties = { ...properties }
    this.#largeBlob = largeBlob
    this.#mode = 'editing'
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: true })
  }

  readonly close = (): void => {
    this.#mode = 'idle'
    this.#cell = ''
    this.#targetSegments = []
    this.#properties = {}
    this.#largeBlob = null
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', { active: false })
  }

  // CLEARING IS `undefined`, NEVER `delete`. The editor form is handed whole to
  // `writeTilePropertiesAt`, which merges it over the tile's stored props — an
  // ABSENT key there means "leave this one alone", so deleting made every
  // clear a silent no-op (the old value came straight back on save). A key
  // present with `undefined` is the one channel a merge has for a removal.

  readonly setLink = (value: string): void => {
    const props = this.#properties as any
    props.link = value || undefined
    this.#emit()
  }

  readonly setBorderColor = (value: string): void => {
    const props = this.#properties as any
    if (value) {
      if (!props.border) props.border = {}
      props.border.color = value
    } else if (props.border) {
      delete props.border.color
      // The merge is shallow at the top level, so the whole `border` object is
      // replaced — dropping the colour is enough while other keys remain. An
      // emptied object must travel as `undefined` or the stored one survives.
      if (Object.keys(props.border).length === 0) props.border = undefined
    }
    this.#emit()
  }

  readonly setBackgroundColor = (value: string): void => {
    const props = this.#properties as any
    if (value) {
      if (!props.background) props.background = {}
      props.background.color = value
    } else if (props.background) {
      delete props.background.color
      if (Object.keys(props.background).length === 0) props.background = undefined
    }
    this.#emit()
  }

  readonly setHideText = (value: boolean): void => {
    const props = this.#properties as any
    props.hideText = value ? true : undefined
    this.#emit()
  }

  readonly setLargeBlob = (blob: Blob): void => {
    this.#largeBlob = blob
    this.#emit()
  }

  readonly updateTransform = (x: number, y: number, scale: number, orientation: 'point-top' | 'flat-top' = 'point-top'): void => {
    if (orientation === 'flat-top') {
      if (!(this.#properties as any).flat) {
        (this.#properties as any).flat = {}
      }
      if (!(this.#properties as any).flat.large) {
        (this.#properties as any).flat.large = {}
      }
      const flatLarge = (this.#properties as any).flat.large
      flatLarge.x = x
      flatLarge.y = y
      flatLarge.scale = scale
    } else {
      if (!(this.#properties as any).large) {
        (this.#properties as any).large = {}
      }
      const large = (this.#properties as any).large
      large.x = x
      large.y = y
      large.scale = scale
    }
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
