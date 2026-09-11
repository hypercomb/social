// editor/tile-editor.service.ts
import { EffectBus } from '@hypercomb/core'

/** Where an editing session is shown. `dock` sits beside the hive, which
 *  stays visible; `page` is a full-height page on a phone. A payload with no
 *  surface is the old modal and keeps its old meaning for anyone listening. */
export type EditorSurfaceKind = 'dock' | 'page'

export type EditorModePayload = {
  active: boolean
  surface?: EditorSurfaceKind
  label?: string
  segments?: readonly string[]
}

/** A changed draft that was thrown away — kept, one at a time and in memory
 *  only, so reopening the same tile can offer it back. Escape, a right-click,
 *  a sweep and a closing sheet all discard; none of them should cost the
 *  participant what they had done. */
export type EditorDraftStash = {
  cell: string
  segments: readonly string[]
  properties: Record<string, unknown>
  picture: {
    source: Blob
    point: { x: number; y: number; scale: number }
    flat: { x: number; y: number; scale: number }
    linked: boolean
    mode: 'fill' | 'fit'
  } | null
  pictureRemoved: boolean
  at: number
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? {})) as T

export class TileEditorService extends EventTarget {

  #mode: 'idle' | 'editing' = 'idle'
  #cell = ''
  #targetSegments: readonly string[] = []
  #properties: Record<string, unknown> = {}
  #baseline = '{}'
  #largeBlob: Blob | null = null
  #surface: EditorSurfaceKind = 'dock'
  #saving = false
  #error = ''
  #stash: EditorDraftStash | null = null

  // ── getters ────────────────────────────────────────────────────

  get mode(): 'idle' | 'editing' { return this.#mode }
  get cell(): string { return this.#cell }
  /** Content-bearing address for this edit. A Portal reference supplies its
   * canonical target; ordinary tiles supply their own lineage location. */
  get targetSegments(): readonly string[] { return this.#targetSegments }
  get properties(): Record<string, unknown> { return this.#properties }
  get largeBlob(): Blob | null { return this.#largeBlob }
  get surface(): EditorSurfaceKind { return this.#surface }
  get saving(): boolean { return this.#saving }
  get error(): string { return this.#error }

  /** The properties exactly as they were when the session opened. */
  get baseline(): Record<string, unknown> { return JSON.parse(this.#baseline) as Record<string, unknown> }

  /** Have the properties moved since the session opened? (The picture and its
   *  framing are the ImageEditorService's to answer.) */
  get dirty(): boolean { return JSON.stringify(this.#properties) !== this.#baseline }

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
    surface: EditorSurfaceKind = 'dock',
  ): void => {
    this.#cell = cell
    this.#targetSegments = [...targetSegments]
    this.#properties = clone(properties)
    this.#baseline = JSON.stringify(this.#properties)
    this.#largeBlob = largeBlob
    this.#surface = surface
    this.#saving = false
    this.#error = ''
    this.#mode = 'editing'
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', {
      active: true, surface, label: cell, segments: [...targetSegments],
    })
  }

  readonly close = (): void => {
    const payload: EditorModePayload = {
      active: false, surface: this.#surface, label: this.#cell, segments: [...this.#targetSegments],
    }
    this.#mode = 'idle'
    this.#cell = ''
    this.#targetSegments = []
    this.#properties = {}
    this.#baseline = '{}'
    this.#largeBlob = null
    this.#saving = false
    this.#error = ''
    this.#emit()
    EffectBus.emit<EditorModePayload>('editor:mode', payload)
  }

  /** The surface can change while a session is open — a window narrowed past
   *  the dock, a phone rotated. Nobody listening to `editor:mode` treats the
   *  two differently any more, so this is local. */
  readonly setSurface = (surface: EditorSurfaceKind): void => {
    if (surface === this.#surface) return
    this.#surface = surface
    this.#emit()
  }

  readonly setSaving = (saving: boolean): void => {
    if (saving === this.#saving) return
    this.#saving = saving
    if (saving) this.#error = ''
    this.#emit()
  }

  readonly setError = (message: string): void => {
    this.#error = message
    this.#emit()
  }

  // CLEARING IS `undefined`, NEVER `delete`. The editor form is handed whole to
  // `writeTilePropertiesAt`, which merges it over the tile's stored props — an
  // ABSENT key there means "leave this one alone", so deleting made every
  // clear a silent no-op (the old value came straight back on save). A key
  // present with `undefined` is the one channel a merge has for a removal.

  readonly setLink = (value: string): void => {
    const props = this.#properties as any
    const next = value || undefined
    if (props.link === next || (props.link === undefined && next === undefined)) return
    props.link = next
    this.#emit()
  }

  readonly setBorderColor = (value: string): void => {
    const props = this.#properties as any
    if (value) {
      if (props.border?.color === value) return
      props.border = { ...(props.border ?? {}), color: value }
    } else if (props.border) {
      const { color: _dropped, ...rest } = props.border
      // The merge is shallow at the top level, so the whole `border` object is
      // replaced — dropping the colour is enough while other keys remain. An
      // emptied object must travel as `undefined` or the stored one survives.
      props.border = Object.keys(rest).length === 0 ? undefined : rest
    } else return
    this.#emit()
  }

  readonly setBackgroundColor = (value: string): void => {
    const props = this.#properties as any
    if (value) {
      if (props.background?.color === value) return
      props.background = { ...(props.background ?? {}), color: value }
    } else if (props.background) {
      const { color: _dropped, ...rest } = props.background
      props.background = Object.keys(rest).length === 0 ? undefined : rest
    } else return
    this.#emit()
  }

  readonly setHideText = (value: boolean): void => {
    const props = this.#properties as any
    const next = value ? true : undefined
    if (props.hideText === next) return
    props.hideText = next
    this.#emit()
  }

  readonly setLargeBlob = (blob: Blob): void => {
    this.#largeBlob = blob
    this.#emit()
  }

  /** Kept for callers of the old Pixi editor, which pushed framing here on
   *  every drag. The framing now lives in ImageEditorService and is written
   *  into the props at save. */
  readonly updateTransform = (x: number, y: number, scale: number, orientation: 'point-top' | 'flat-top' = 'point-top'): void => {
    const props = this.#properties as any
    if (orientation === 'flat-top') {
      props.flat = { ...(props.flat ?? {}), large: { ...(props.flat?.large ?? {}), x, y, scale } }
    } else {
      props.large = { ...(props.large ?? {}), x, y, scale }
    }
    // no emit — this was a high-frequency path
  }

  // ── discarded drafts ───────────────────────────────────────────

  readonly stash = (draft: Omit<EditorDraftStash, 'at'>): void => {
    this.#stash = { ...draft, properties: clone(draft.properties), at: Date.now() }
  }

  /** The discarded draft for this tile, if there is one. */
  readonly stashFor = (cell: string, segments: readonly string[]): EditorDraftStash | null => {
    const held = this.#stash
    if (!held || held.cell !== cell) return null
    if (held.segments.join('/') !== segments.join('/')) return null
    return held
  }

  readonly dropStash = (): void => { this.#stash = null }

  /** Put a stashed draft's properties back into the open session. */
  readonly restoreProperties = (properties: Record<string, unknown>): void => {
    this.#properties = clone(properties)
    this.#emit()
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
