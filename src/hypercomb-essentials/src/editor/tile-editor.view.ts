// editor/tile-editor.view.ts
//
// THE TILE EDITOR: ONE FULL-SCREEN DESK, a model in the middle.
//
// The desk is a box like the Notes and Chat desks: it covers the hive, leaves
// the shell's rail and tools row outside it, and has its own slim header. The
// tile list stands on the left (the shared AgentTilesRail), and the middle is a
// labelled technical drawing of ONE tile — a MODEL, never a shape this file
// knows. The drawing, its callouts, leaders and lighting are the diagram's
// (diagram/tile-diagram.ts); the picture under the participant's hands is the
// CropStage; what is here is the shell around them:
//
//   · the session: the docked-panel chrome, the mode claim, the Back gesture,
//     the keymap hold, the window session (park / unpark), the Escape ladder;
//   · the header: the STORED reading, the address, the unsaved word, Save and
//     close, the leave prompt, the notices;
//   · the TileSessionPort the diagram reads and writes through, built over the
//     tile session, the picture model and the name's memory (TileTitle);
//   · the picture's doors: files, drops, the camera, the live preview in the hive.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// and defined by the drone on the first edit. It holds no state that matters:
// the session lives in TileEditorService, the picture in ImageEditorService,
// the name in TileTitle and the save in TileEditorDrone, so a rebuild loses
// nothing. This file never names a shape: every length, path and part comes
// from the model, and what a part does comes from the KIND of its field.

import {
  EffectBus,
  I18N_IOC_KEY,
  SignatureService,
  attachDockedPanel,
  dismissOpenPopover,
  type DockedPanel,
  type I18nProvider,
  type WindowSession,
} from '@hypercomb/core'
import { CropStage } from './crop-stage.js'
import { EMPTY_TILE_GROUND } from './tile-look-overlay.js'
import { mobileModeActive, type TileEditorService } from './tile-editor.service.js'
import { parseHexColour } from './hex-capture.js'
import { frameSize, scaleLimits, scaleOfSlider, sliderOf, zoomPercent, zoomToward, type HexOrientation } from './crop-math.js'
import { installTileEditorStyles } from './tile-editor.styles.js'
import type { ImageEditorService } from './image-editor.service.js'
import { pictureHistory } from './picture-history.js'
import { TileTitle, type TitleDecorations, type TitleStatus } from './tile-title.js'
import { modelFor } from './models/models.js'
import type { FieldKey, ModelGeometry, Rect, TileModel } from './models/tile-model.js'
import { FIELDS } from './diagram/fields.js'
import { layoutFor, type LayoutOut } from './diagram/layout.js'
import { closeLayerMenus, type FieldValue, type LayerChoice, type TileSessionPort } from './diagram/controls.js'
import { createTileDiagram, type TileDiagram } from './diagram/tile-diagram.js'
import { installDiagramStyles } from './diagram/diagram.styles.js'
import type { EditorField, PropertyChoice, PropertyLayer } from './tile-properties.js'

/** The view's IoC key — tile-editor.drone.ts registers the facade under it. */
export const TILE_EDITOR_VIEW_KEY = '@diamondcoreprocessor.com/TileEditorView'

/** The desk's name everywhere it is counted: the window id, the mode owner, the
 *  Back gesture owner and the keymap hold's reason. One string, on purpose. */
const DESK = 'tile-editor'
const KEYS = {
  service: '@diamondcoreprocessor.com/TileEditorService',
  images: '@diamondcoreprocessor.com/ImageEditorService',
  drone: '@diamondcoreprocessor.com/TileEditorDrone',
  modes: '@diamondcoreprocessor.com/ModeRegistry',
  rail: '@diamondcoreprocessor.com/AgentTilesRailFactory',
  decorations: '@diamondcoreprocessor.com/DecorationService',
  notes: '@diamondcoreprocessor.com/NotesService',
  safety: '@diamondcoreprocessor.com/LinkSafetyService',
  back: '@diamondcoreprocessor.com/BackGesture',
  lineage: '@hypercomb.social/Lineage',
  store: '@hypercomb.social/Store',
  history: '@diamondcoreprocessor.com/HistoryService',
} as const

const SLIDER_STEPS = 1000
const SAVED_MS = 3200
/** The hive's two small pictures, in the order the model lists its variants. */
const PREVIEW_SLOTS = ['point', 'flat'] as const
const TITLE_FIELD: FieldKey = 'title'

/** What each layer offers (alias-properties.md, step 4). A locked field offers
 *  none — the repo's lock is absolute. */
const OFFERED: Record<PropertyLayer, readonly PropertyChoice[]> = {
  inherited: ['here', 'hide'], here: ['inherit', 'hide'], hidden: ['inherit', 'here'], locked: [],
}

type DroneShape = {
  saveAndComplete?(): Promise<void>
  cancelEditing?(): void
  switchTo?(label: string, options?: { save?: boolean; parent?: readonly string[] }): Promise<boolean>
  readonly openTile?: { label: string; parent: readonly string[] } | null
}
type NotesShape = { notesFor?(cell: string): readonly { id: string; text?: string }[] }
type ReadingShape = { readingAt?(segments: readonly string[], locale?: string): string }
type LinkSafetyShape = { check(url: string): Promise<{ decision: 'allow' | 'warn' | 'deny'; reason: string }> }
type BackGestureShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type LineageShape = { explorerSegments?(): readonly string[] }
type ModesShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void; releaseOwner?(owner: string): void }
type RailRow = { readonly name: string; readonly segments: readonly string[] }
type RailShape = {
  mount(host: HTMLElement): void
  dispose(): void
  paint(): void
  refresh(): void
  showCurrent(name: string | null, level?: readonly string[]): void
  showSelection(paths: readonly (readonly string[])[]): void
  markSibling(segments: readonly string[] | null): void
  onSubjectChanged: (subject: { name: string; path: readonly string[] } | null) => void
}
type RailFactoryShape = { create(profile: Record<string, unknown>): RailShape }
type Preview = { sig: string; blob: Blob }
type PreviewSet = Partial<Record<(typeof PREVIEW_SLOTS)[number], Preview>>

const Q_NOTE = /^\[Q(?:\s+[^\]]*)?\]\s*([\s\S]+)$/
const A_NOTE = /^\[A:([a-zA-Z0-9_-]+)\]\s*([\s\S]+)$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** A caption, or its plain-English stand-in — `t()` echoes an unknown key. */
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const glyph = (name: string): HTMLSpanElement => {
  const span = make('span', 'mat-sym', name)
  span.setAttribute('aria-hidden', 'true')
  return span
}

const iconButton = (name: string, label: string, action: string): HTMLButtonElement => {
  const btn = make('button', 'te-icon-btn')
  btn.type = 'button'
  btn.dataset['action'] = action
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.append(glyph(name))
  return btn
}

const isTouch = (): boolean => {
  try { return matchMedia('(pointer: coarse)').matches } catch { return false }
}

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index])

/** An explicit scheme that is not web or mail, or null. A browser ignores tabs,
 *  newlines and spaces inside a scheme, so they are dropped before looking; a
 *  host and port (example.com:8080) is not a scheme and stays as typed. */
export const unsafeScheme = (value: string): string | null => {
  const flat = value.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  const found = /^([a-z][a-z0-9+.-]*):(?!\d+(?:[/?#]|$))/.exec(flat)
  return found && !['http', 'https', 'mailto'].includes(found[1]!) ? found[1]! : null
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** `3:2` for a picture whose sides reduce to small numbers, else one decimal. */
const ratioOf = (width: number, height: number): string => {
  const w = Math.round(width), h = Math.round(height)
  if (!(w > 0 && h > 0)) return ''
  const d = gcd(w, h)
  return w / d <= 21 && h / d <= 21 ? `${w / d}:${h / d}` : `${(w / h).toFixed(2).replace(/\.?0+$/, '')}:1`
}

/** The view's IoC face. The element is created by the shell's surface host, so
 *  the registered object forwards to whichever element is mounted. */
const facade = {
  current: null as TileEditorElement | null,
  dismissInner(): boolean { return facade.current?.dismissInner() ?? false },
}

export class TileEditorElement extends HTMLElement {

  #service: TileEditorService | undefined
  #images: ImageEditorService | undefined
  #panel: HTMLElement | null = null
  #stage: CropStage | null = null
  #diagram: TileDiagram | null = null
  #rail: RailShape | null = null
  #dock: DockedPanel | null = null
  #releaseBack: (() => void) | null = null
  #modes: ModesShape | null = null
  #cleanup: (() => void)[] = []
  #openCleanup: (() => void)[] = []
  #refs = new Map<string, HTMLElement>()

  readonly #title = new TileTitle({
    decorations: () => ioc<TitleDecorations>(KEYS.decorations),
    toast: (message, tone) => EffectBus.emit('toast:show', { type: tone, message }),
    t,
  })
  #port: TileSessionPort | null = null
  #listeners = new Set<() => void>()
  #model: TileModel = modelFor()
  #size = 400
  #layout: LayoutOut | null = null
  #frame = 0
  #inSync = false
  #savedAt = 0
  #savedTimer = 0
  #railKey = ''
  #railMark = ''

  #verdict: { tone: 'warn' | 'alert'; reason: string } | null = null
  #linkCheck: Promise<void> = Promise.resolve()
  #linkBusy = false
  #twinUrls = new Map<string, string>()
  #twinTimer = 0
  #twinGeneration = 0
  #historyUrls: string[] = []
  #previewPictures: PreviewSet = {}
  #previewLabels = new Set<string>()
  #hasCamera = false
  #camera: { stream: MediaStream; root: HTMLElement; facing: 'environment' | 'user' } | null = null
  #answerDrafts = new Map<string, string>()
  /** The link value the last completed safety check was for. */
  #checkedLink = ''
  /** The element that had focus when the desk opened; it gets it back on close. */
  #returnFocus: HTMLElement | null = null
  /** A polite region that outlives the panel, so the close can be said aloud. */
  #farewell: HTMLElement | null = null
  #nameState = ''
  #announceFrame = 0

  // The tile the desk is built for, a tile clicked while this one has unsaved
  // changes (the prompt asks), and a move in flight (the preview stands down so
  // neither tile is painted with the other's look).
  #target = ''
  #leaving: { label: string; parent?: readonly string[] } | null = null
  #switchingTo = ''
  #busy = false
  #grouped = false
  #drawer = false
  #parkedCell = ''

  readonly #session: WindowSession = {
    // Put away by the shell (another window, a lane, the installer). Its changed
    // draft is kept and SAID to be, with the tile as the door; a name still
    // unwritten is named in the toast, and the teardown writes it.
    park: () => {
      const cell = this.#service?.cell ?? ''
      const changed = this.#dirty()
      const name = this.#pendingName()
      this.#parkedCell = cell
      this.#cancel()
      if (!changed || !cell) return
      const message = t('editor.draft-kept', 'Draft kept — reopen {tile} to continue', { tile: cell })
      EffectBus.emit('toast:show', {
        type: 'info',
        message: name ? `${message} (${t('editor.name', 'name')}: “${name}”)` : message,
        actionLabel: t('editor.draft-kept-open', 'open {tile}', { tile: cell }),
        actionEffect: 'tile:action',
        actionPayload: { action: 'edit', label: cell },
      })
    },
    // Brought back by the shell: the same tile opens again through its own door.
    unpark: () => {
      const cell = this.#parkedCell
      this.#parkedCell = ''
      if (cell) EffectBus.emit('tile:action', { action: 'edit', label: cell })
    },
    dismiss: () => this.dismissInner(),
    close: () => this.#cancel(),
  }

  // ── lifecycle ─────────────────────────────────────────────────

  connectedCallback(): void {
    installTileEditorStyles()
    installDiagramStyles()
    facade.current = this
    this.#service = ioc<TileEditorService>(KEYS.service)
    this.#images = ioc<ImageEditorService>(KEYS.images)
    this.#service?.addEventListener('change', this.#onServiceChange)
    this.#images?.addEventListener('change', this.#onImagesChange)
    this.#title.addEventListener('change', this.#onTitleChange)
    window.addEventListener('resize', this.#schedule)
    this.#cleanup.push(
      () => this.#service?.removeEventListener('change', this.#onServiceChange),
      () => this.#images?.removeEventListener('change', this.#onImagesChange),
      () => this.#title.removeEventListener('change', this.#onTitleChange),
      () => window.removeEventListener('resize', this.#schedule),
      EffectBus.on('notes:changed', () => this.#notify()),
      EffectBus.on('title:indexed', () => this.#rail?.paint()),
      EffectBus.on('tile:saved', () => this.#rail?.refresh()),
      EffectBus.on<{ label?: unknown; parent?: unknown }>('editor:switch-request', this.#onSwitchRequest),
    )
    const farewell = make('div', 'te-live')
    farewell.setAttribute('role', 'status')
    this.#farewell = farewell
    this.appendChild(farewell)
    this.#cleanup.push(() => { farewell.remove(); if (this.#farewell === farewell) this.#farewell = null })
    this.#onServiceChange()
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup.splice(0)) off?.()
    if (this.#panel) {
      // Taken off the page mid-edit: close the session too, or the hive's input
      // gate stays locked behind an editor nobody can see.
      this.#teardown()
      ioc<DroneShape>(KEYS.drone)?.cancelEditing?.()
    }
    if (facade.current === this) facade.current = null
  }

  /** Unwind ONE level of the editor's own state — the Escape ladder. True = the
   *  press was used; false hands it on (the keydown then closes the editor). */
  dismissInner(): boolean {
    const panel = this.#panel
    if (!panel) return false
    if (this.#leaving) { this.#setLeaving(null); return true }
    if (this.#camera) { this.#stopCamera(); return true }
    if (dismissOpenPopover()) return true
    if (panel.querySelector('.te-dg-lmenu:not([hidden])')) { closeLayerMenus(panel); return true }
    const name = this.#nameInput
    if (name && document.activeElement === name) { this.#title.revert(); name.value = this.#title.draft; name.blur(); return true }
    if (this.#verdict) { this.#verdict = null; this.#notify(); return true }
    const active = document.activeElement
    if (active instanceof HTMLElement && panel.contains(active) && active.matches('input, textarea')) { active.blur(); return true }
    const light = this.#diagram?.light
    if (light?.open) { this.#diagram?.setLight({ open: null }); return true }
    if (light?.pin) { this.#diagram?.setLight({ pin: null }); return true }
    if (this.#drawer) { this.#setDrawer(false); return true }
    return false
  }

  // ── the session ───────────────────────────────────────────────

  #onServiceChange = (): void => {
    const service = this.#service
    if (!service) return
    const editing = service.mode === 'editing'
    if (editing && !this.#panel) this.#open()
    else if (!editing && this.#panel) this.#teardown()
    else if (editing && this.#targetKey() !== this.#target) this.#retarget()
    else if (editing) this.#schedule()
  }

  #onImagesChange = (): void => {
    if (!this.#panel) return
    this.#scheduleTwins()
    this.#schedule()
  }

  #onTitleChange = (): void => {
    const status = this.#title.status
    if (status.state === 'saved') {
      this.#savedAt = Date.now()
      window.clearTimeout(this.#savedTimer)
      this.#savedTimer = window.setTimeout(() => this.#schedule(), SAVED_MS + 20)
      this.#announce(t('editor.name-saved', 'name saved'))
    }
    const named = status.state === 'refused' || status.state === 'failed' ? status.state : ''
    if (named !== this.#nameState) {
      this.#nameState = named
      if (status.state === 'refused') {
        this.#restoreRail()
        this.#say(this.#ref('live-alert'), t('editor.name-taken-by', '"{name}" is taken. The tile {address} already reads that way here.', { name: status.sibling, address: status.siblingAddress }))
      } else if (status.state === 'failed') {
        this.#say(this.#ref('live-alert'), t('editor.name-failed', 'Could not save the name.'))
      }
    }
    const sibling = status.state === 'refused' && status.siblingAddress
      ? [...this.#title.segments.slice(0, -1), status.siblingAddress]
      : null
    this.#rail?.markSibling(sibling)
    this.#schedule()
  }

  #targetKey(): string {
    const service = this.#service
    return service ? `${service.cell}|${service.targetSegments.join('/')}` : ''
  }

  #cancel(): void {
    ioc<DroneShape>(KEYS.drone)?.cancelEditing?.()
  }

  /** Save: the name first (a refusal keeps the desk open and returns to it), the
   *  link verdict next (a deny can no longer race the save), then the drone. */
  async #save(): Promise<void> {
    const service = this.#service
    if (!service || service.saving || this.#busy || this.#leaving) return
    this.#busy = true
    this.#schedule()
    try {
      // A group has no name field: a name left refused there cannot hold Save back.
      if (!service.grouped && this.#title.dirty && (await this.#title.flush()) !== 'ok') { this.#focusName(); return }
      if (!(await this.#settleLink())) return
      await ioc<DroneShape>(KEYS.drone)?.saveAndComplete?.()
    } finally {
      this.#busy = false
      this.#schedule()
    }
  }

  // ── another tile ──────────────────────────────────────────────
  //
  // A row of the list (or a click in the hive) moves the desk to that tile.
  // Nothing changed: it just moves. With changes — a name not yet written counts
  // — the header asks: save and open, open without saving (the draft is kept and
  // offered back), or keep editing.

  #openTile(): { label: string; parent: readonly string[] } {
    const drone = ioc<DroneShape>(KEYS.drone)
    return drone?.openTile ?? { label: this.#service?.cell ?? '', parent: this.#pageSegments() }
  }

  #onSwitchRequest = (payload: { label?: unknown; parent?: unknown } | undefined): void => {
    const service = this.#service
    const label = typeof payload?.label === 'string' ? payload.label : ''
    const parent = Array.isArray(payload?.parent) ? (payload.parent as unknown[]).map(String) : undefined
    if (!label || !service || !this.#panel) return
    if (service.mode !== 'editing' || service.saving || this.#switchingTo) return
    const here = this.#openTile()
    const samePage = !parent || sameSegments(parent, here.parent)
    // A plain click on a tile of the group (the open one included) collapses
    // the group onto that tile: the drone's move lets the selection go.
    if (label === here.label && samePage && !service.grouped) { this.#restoreRail(); return }
    this.#setDrawer(false)
    if (this.#dirty()) { this.#setLeaving({ label, parent }); return }
    void this.#switchTo(label, false, parent)
  }

  #pendingName(): string {
    const title = this.#title
    const draft = title.draft.trim()
    return title.segments.length > 0 && draft !== title.stored ? draft : ''
  }

  #dirty(): boolean {
    const service = this.#service
    const images = this.#images
    if (!service || !images) return false
    return service.dirty || images.pictureChanged || images.framingChanged || this.#title.dirty
  }

  async #switchTo(label: string, save: boolean, parent?: readonly string[]): Promise<void> {
    const service = this.#service
    const drone = ioc<DroneShape>(KEYS.drone)
    if (!label || !service || !drone?.switchTo || this.#switchingTo) return
    const from = this.#target
    this.#setLeaving(null)
    // The name is written the moment it is let go of, and a refusal keeps the
    // desk where it is — except for "don't save", which drops only the typed text.
    if (!service.grouped && this.#title.dirty) {
      if (!save) {
        // "Don't save" lets go of the typed text; it is never written.
        this.#title.revert()
        const input = this.#nameInput
        if (input) input.value = this.#title.draft
      } else if ((await this.#title.flush()) !== 'ok') { this.#restoreRail(); this.#focusName(); return }
    }
    if (save && !(await this.#settleLink())) { this.#restoreRail(); return }
    // The preview stays painted — a save's own render replaces it with the same
    // pixels — but nothing new is emitted until the desk has arrived.
    this.#switchingTo = label
    try {
      await drone.switchTo(label, parent ? { save, parent } : { save })
    } finally {
      if (this.#switchingTo === label) this.#switchingTo = ''
      // Still on the first tile (the save failed, or it could not be read): it
      // goes on showing the edit.
      if (this.#panel && this.#target === from) { this.#emitPreview(); this.#restoreRail() }
    }
  }

  #setLeaving(next: { label: string; parent?: readonly string[] } | null): void {
    this.#leaving = next
    const leave = this.#ref('leave')
    if (!leave) return
    const question = this.#ref('leave-question')
    if (question && next) {
      question.textContent = t('editor.leave-question', 'Save your changes before opening “{name}”?', { name: next.label })
    }
    const hadFocus = leave.contains(document.activeElement)
    leave.hidden = !next
    for (const name of ['cancel', 'primary']) {
      const btn = this.#ref(name)
      if (btn) btn.hidden = !!next
    }
    if (next) this.#ref<HTMLButtonElement>('leave-save')?.focus({ preventScroll: true })
    else if (hadFocus) this.#panel?.focus({ preventScroll: true })
  }

  /** The session moved to another tile under an open desk: the desk and the list
   *  stay where they are; what belonged to the last tile goes. */
  #retarget(): void {
    this.#target = this.#targetKey()
    this.#switchingTo = ''
    this.#setLeaving(null)
    this.#endPreview()
    this.#stopCamera()
    this.#resetTwins()
    this.#verdict = null
    this.#checkedLink = ''
    this.#nameState = ''
    void this.#title.load(this.#segments())
    this.#announce(t('editor.status-editing', 'Editing {name}', { name: this.#service?.cell ?? '' }))
    const body = this.#ref('vp')
    if (body) body.scrollTop = 0
    this.#syncNow()
  }

  // ── building ──────────────────────────────────────────────────

  #open(): void {
    const service = this.#service
    const images = this.#images
    if (!service || !images) return
    this.#model = modelFor()
    this.#target = this.#targetKey()
    this.#checkedLink = ''
    this.#nameState = ''
    const active = document.activeElement
    this.#returnFocus = active instanceof HTMLElement && active !== document.body ? active : null
    const nameInput = this.#keep('name', this.#buildName())

    const panel = make('aside', 'te-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('editor.title', 'tile editor'))
    panel.setAttribute('data-hc-tile-editor', '')
    panel.setAttribute('data-consumes-wheel', '')
    panel.tabIndex = -1
    this.#panel = panel

    this.#stage = new CropStage(images, {
      geometry: () => this.#geometry(),
      onCommit: () => { this.#scheduleTwins(); this.#schedule() },
      onRender: () => { if (!this.#inSync) this.#schedule() },
      onGesture: on => { if (on) this.#diagram?.setLight({ hover: null }); this.#schedule() },
    })
    const stage = this.#stage.el
    // The picture frame is a group the keys move, not a bare box.
    stage.setAttribute('role', 'group')
    stage.setAttribute('aria-roledescription', t('editor.picture-frame', 'picture frame').toLocaleLowerCase())
    stage.setAttribute('aria-label', t('editor.picture-frame', 'Picture frame'))
    stage.setAttribute('aria-describedby', 'te-frame-keys')
    stage.append(this.#buildEmpty())
    stage.addEventListener('dragover', this.#onDragOver)
    stage.addEventListener('dragleave', this.#onDragLeave)
    stage.addEventListener('drop', this.#onDrop)

    const figure = this.#keep('figure', make('div', 'te-figure'))
    figure.append(stage, nameInput)
    const home = this.#keep('toolbar-home', make('div', 'te-toolbar-home'))
    const notices = this.#keep('notices', make('div', 'te-notices'))
    const vp = this.#keep('vp', make('div', 'te-vp'))
    vp.setAttribute('data-consumes-wheel', '')
    vp.append(figure, home, notices)
    notices.append(this.#buildRestore(), this.#buildError(), this.#buildWrites())

    const list = this.#keep('list', make('nav', 'te-list'))
    list.id = 'te-list'
    list.setAttribute('aria-label', t('editor.tiles', 'tiles'))
    const scrim = make('div', 'te-scrim')
    scrim.addEventListener('click', () => this.#setDrawer(false))
    const body = make('div', 'te-body')
    body.append(list, scrim, vp)

    const skip = make('button', 'te-skip', t('editor.skip', 'skip to the editor'))
    skip.type = 'button'
    skip.addEventListener('click', () => stage.focus({ preventScroll: true }))
    const live = this.#keep('live', make('div', 'te-live'))
    live.setAttribute('role', 'status')
    live.setAttribute('aria-live', 'polite')
    const alert = this.#keep('live-alert', make('div', 'te-live'))
    alert.setAttribute('role', 'alert')
    const keys = make('span', 'te-live', t('editor.picture-frame-keys', 'Arrow keys move the picture, plus and minus zoom, 0 resets, F fits.'))
    keys.id = 'te-frame-keys'
    panel.append(skip, this.#buildHeader(), body, live, alert, keys)
    this.appendChild(panel)

    panel.addEventListener('keydown', this.#onKeyDown)
    this.#openCleanup.push(() => panel.removeEventListener('keydown', this.#onKeyDown))
    // Focus can be on the page itself (a click on the glass, a closed menu):
    // Ctrl/Cmd+Enter still saves. Anything inside the desk is the panel's own
    // listener; any other target (a field or button of another window) is theirs.
    const onDocumentKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing || e.defaultPrevented) return
      const target = e.target
      if (target !== document.body && target !== document.documentElement && target !== document) return
      if (this.#leaving || this.#panel !== panel) return
      e.preventDefault()
      void this.#save()
    }
    document.addEventListener('keydown', onDocumentKey)
    this.#openCleanup.push(() => document.removeEventListener('keydown', onDocumentKey))

    this.#port = this.#makePort()
    this.#diagram = createTileDiagram({
      model: this.#model,
      port: this.#port,
      viewport: vp,
      figure,
      gesture: stage,
      toolbarHome: home,
      t,
      events: {
        onLight: () => this.#schedule(),
        onIntent: ({ activation }) => {
          if (activation === 'focus-text') this.#focusName()
          else if (activation === 'pin-stage') stage.focus({ preventScroll: true })
        },
      },
    })

    // The diagram leaves a slot for notices; the restore strip and the error go in it.
    const slot = this.#diagram.el.querySelector('[data-slot="notices"]')
    if (slot) slot.append(...notices.children)

    // The docked-panel chrome: the text-size gear, the lane, the window session.
    // It writes its width and edge inline; the desk's stylesheet wins with
    // `!important`, so the box below is the box.
    this.#dock = attachDockedPanel(panel, {
      id: DESK,
      dockSide: 'right',
      dockExclusive: false,
      ownsSize: false,
      sizeOwner: { panelWidth: () => 400, setPanelWidth: () => undefined },
      defaultText: 1,
      hcSession: this.#session,
      onClose: () => this.#cancel(),
    })

    this.#claimModes(panel)
    // Held for the WHOLE session, not per focus: the browser fires focusout(null)
    // when a focused node is removed, and Space or Delete would reach the hive.
    EffectBus.emit('keymap:suppress', { reason: DESK })
    this.#releaseBack = ioc<BackGestureShape>(KEYS.back)?.register({
      owner: DESK,
      active: () => this.#panel !== null,
      back: () => { if (!this.dismissInner()) this.#cancel() },
    }) ?? null

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.#schedule())
      observer.observe(panel)
      this.#openCleanup.push(() => observer.disconnect())
      // The text-size gear scales the panel's em without changing its box, so
      // nothing above sees it. A hidden 1em square changes size exactly when
      // the em does.
      const probe = make('span', 'te-em-probe')
      probe.setAttribute('aria-hidden', 'true')
      probe.setAttribute('style', 'position:absolute;left:0;top:0;width:1em;height:1em;visibility:hidden;pointer-events:none')
      panel.appendChild(probe)
      const emObserver = new ResizeObserver(() => this.#schedule())
      emObserver.observe(probe)
      this.#openCleanup.push(() => { emObserver.disconnect(); probe.remove() })
    }
    this.#watchKeyboard(panel)
    this.#mountRail(panel, list)
    this.#probeCamera()
    void this.#title.load(this.#segments())
    this.#announce(t('editor.status-editing', 'Editing {name}', { name: service.cell }))
    this.#syncNow()
    this.#scheduleTwins()
    requestAnimationFrame(() => {
      if (this.#panel !== panel) return
      this.#schedule()
      panel.focus({ preventScroll: true })
    })
  }

  #teardown(): void {
    // The claims that lock the hive go FIRST, each on its own, so one throw while
    // the pieces come down cannot strand `view:active` or the keymap hold.
    const attempt = (what: () => void): void => {
      try { what() } catch (error) { console.warn('[tile-editor] teardown step failed', error) }
    }
    attempt(() => this.#releaseModes())
    attempt(() => EffectBus.emit('keymap:unsuppress', { reason: DESK }))
    attempt(() => { this.#releaseBack?.(); this.#releaseBack = null })
    attempt(() => { this.#dock?.dispose(); this.#dock = null })

    // The name is written for the tile it belongs to — and a refusal that
    // arrives after the desk is gone is said aloud.
    attempt(() => this.#title.dispose())
    window.clearTimeout(this.#savedTimer)
    if (this.#frame) cancelAnimationFrame(this.#frame)
    this.#frame = 0
    attempt(() => this.#endPreview())
    attempt(() => this.#stopCamera())
    attempt(() => this.#resetTwins())
    attempt(() => this.#closeHistoryUrls())
    for (const off of this.#openCleanup.splice(0)) attempt(off)
    attempt(() => this.#diagram?.dispose())
    this.#diagram = null
    attempt(() => this.#stage?.dispose())
    this.#stage = null
    attempt(() => this.#rail?.dispose())
    this.#rail = null
    this.#railKey = ''
    this.#railMark = ''
    this.#panel?.remove()
    this.#panel = null
    this.#port = null
    this.#layout = null
    this.#refs.clear()
    this.#verdict = null
    this.#linkCheck = Promise.resolve()
    this.#linkBusy = false
    this.#checkedLink = ''
    this.#nameState = ''
    this.#answerDrafts.clear()
    this.#target = ''
    this.#leaving = null
    this.#switchingTo = ''
    this.#grouped = false
    this.#drawer = false
    this.#busy = false
    // Said aloud from a region that outlives the panel, and focus goes back to
    // where it was before the desk opened.
    this.#say(this.#farewell, t('editor.status-closed', 'Closed'))
    const back = this.#returnFocus
    this.#returnFocus = null
    if (back?.isConnected) attempt(() => back.focus({ preventScroll: true }))
  }

  #ref<T extends HTMLElement>(name: string): T | null {
    return (this.#refs.get(name) as T | undefined) ?? null
  }

  #keep<T extends HTMLElement>(name: string, node: T): T {
    this.#refs.set(name, node)
    return node
  }

  get #nameInput(): HTMLInputElement | null { return this.#ref<HTMLInputElement>('name') }

  /** The covering claim, owner-counted: `view:keeps-controls` first so the control
   *  bar keeps its edge, then `view:active` so the hive is put away. Released in
   *  reverse, and the owner is dropped from every mode when the desk goes. */
  #claimModes(panel: HTMLElement): void {
    const claim = (modes: ModesShape): void => {
      this.#modes = modes
      modes.enter('view:keeps-controls', DESK)
      modes.enter('view:active', DESK)
    }
    const modes = ioc<ModesShape>(KEYS.modes)
    if (modes) { claim(modes); return }
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(KEYS.modes, value => { if (this.#panel === panel && !this.#modes) claim(value as ModesShape) })
  }

  #releaseModes(): void {
    const modes = this.#modes
    this.#modes = null
    if (!modes) return
    modes.exit('view:active', DESK)
    modes.exit('view:keeps-controls', DESK)
    modes.releaseOwner?.(DESK)
  }

  #buildHeader(): HTMLElement {
    // The header IS the actions row: its LAST child is the close button, which
    // is where the docked-panel chrome puts the text-size gear beside.
    const head = make('header', 'te-head te-actions')
    const toggle = this.#keep('drawer-toggle', iconButton('menu', t('editor.tiles', 'tiles'), 'tiles'))
    toggle.classList.add('te-drawer-toggle')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-controls', 'te-list')
    toggle.addEventListener('click', () => this.#setDrawer(!this.#drawer))

    const reading = this.#keep('reading', make('span', 'te-reading'))
    const address = this.#keep('address', make('span', 'te-address'))
    address.title = t('editor.address-hint', 'The address never changes.')
    const portal = this.#keep('portal', make('span', 'te-portal'))
    portal.append(glyph('link'), make('span', '', t('editor.portal-target', 'edits the original')))
    const state = this.#keep('state', make('span', 'te-state'))
    state.append(make('i', 'te-dot'), make('span', 'te-state-word'))

    const save = this.#keep('primary', make('button', 'te-btn te-btn-primary'))
    save.type = 'button'
    save.dataset['action'] = 'save'
    save.title = 'Ctrl+Enter'
    save.addEventListener('click', () => void this.#save())

    // Asked when another tile is chosen while this one has unsaved changes.
    const leave = this.#keep('leave', make('div', 'te-leave'))
    leave.hidden = true
    leave.setAttribute('role', 'group')
    const question = this.#keep('leave-question', make('p', 'te-leave-question'))
    question.id = 'te-leave-question'
    question.setAttribute('aria-live', 'polite')
    leave.setAttribute('aria-labelledby', question.id)
    const choices = make('div', 'te-leave-choices')
    const choice = (name: string, key: string, fallback: string, primary: boolean, act: () => void): HTMLButtonElement => {
      const btn = this.#keep(name, make('button', primary ? 'te-btn te-btn-primary' : 'te-btn', t(key, fallback)))
      btn.type = 'button'
      btn.dataset['action'] = name
      btn.addEventListener('click', act)
      return btn
    }
    const asked = (): { label: string; parent?: readonly string[] } | null => this.#leaving
    choices.append(
      choice('leave-stay', 'editor.leave-stay', 'keep editing', false, () => { this.#setLeaving(null); this.#restoreRail() }),
      choice('leave-discard', 'editor.leave-discard', 'don’t save', false, () => { const to = asked(); if (to) void this.#switchTo(to.label, false, to.parent) }),
      choice('leave-save', 'editor.leave-save', 'save and open', true, () => { const to = asked(); if (to) void this.#switchTo(to.label, true, to.parent) }),
    )
    leave.append(question, choices)

    const close = this.#keep('cancel', iconButton('close', t('editor.close-hint', 'Close. Your changes are kept as a draft.'), 'cancel'))
    close.classList.add('close')
    close.addEventListener('click', () => this.#cancel())
    head.append(toggle, reading, address, portal, make('span', 'te-grow'), state, leave, save, close)
    return head
  }

  /** The ONE in-place name input. The diagram places it on the model's name box;
   *  the shell owns what it does. */
  #buildName(): HTMLInputElement {
    const input = make('input', 'te-title')
    input.type = 'text'
    input.name = 'tile-name'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('enterkeyhint', 'done')
    input.setAttribute('aria-label', t('editor.name', 'name'))
    input.setAttribute('data-hc-ground', EMPTY_TILE_GROUND)
    input.title = t('editor.name-hint', 'How this tile reads in your language.')
    input.addEventListener('input', () => {
      this.#title.edit(input.value)
      input.removeAttribute('aria-invalid')
      this.#schedule()
    })
    input.addEventListener('focus', () => {
      const id = this.#namePart()
      if (id) this.#diagram?.setLight({ focus: id })
    })
    input.addEventListener('blur', () => {
      const id = this.#namePart()
      if (id && this.#diagram?.light.focus === id) this.#diagram.setLight({ focus: null })
      // The leave prompt takes focus from the field: what was typed waits for the answer.
      if (this.#leaving) return
      // A refusal is not asked again by a blur: Save retries it, an edit clears it.
      const state = this.#title.status.state
      if (state !== 'refused' && state !== 'failed' && this.#title.draft.trim() !== this.#title.stored) void this.#title.commit()
    })
    return input
  }

  /** The part that edits the title field — found by FIELD, never by a part id. */
  #namePart(): string | null {
    return this.#model.parts.find(part => part.fields.includes(TITLE_FIELD))?.id ?? null
  }

  #focusName(): void {
    const input = this.#nameInput
    if (!input || input.hidden) return
    input.focus({ preventScroll: true })
    input.select()
  }

  /** Empty: the tile's own ground, and a way to give it a picture. */
  #buildEmpty(): HTMLElement {
    const empty = this.#keep('empty', make('div', 'te-empty'))
    empty.setAttribute('data-hc-ground', EMPTY_TILE_GROUND)
    const mark = glyph('add_photo_alternate')
    mark.classList.add('te-empty-mark')
    const tools = make('div', 'te-empty-tools')
    tools.append(make('p', '', t('editor.drop-or-choose', 'drop a picture, or choose one')))
    const row = make('div')
    const phone = (): boolean => mobileModeActive() || isTouch()
    const upload = make('button', 'te-empty-btn')
    upload.type = 'button'
    upload.dataset['action'] = 'upload'
    upload.append(glyph(phone() ? 'photo_library' : 'upload'),
      document.createTextNode(phone() ? t('editor.library', 'library') : t('editor.upload', 'upload')))
    upload.addEventListener('click', () => this.#pickFile(false))
    const camera = this.#keep('empty-camera', make('button', 'te-empty-btn'))
    camera.type = 'button'
    camera.dataset['action'] = 'camera'
    camera.append(glyph('photo_camera'), document.createTextNode(t('editor.camera', 'camera')))
    camera.addEventListener('click', () => this.#openCamera())
    row.append(upload, camera)
    tools.append(row)
    empty.append(mark, make('span'), tools)
    return empty
  }

  #buildRestore(): HTMLElement {
    const restore = this.#keep('restore', make('div', 'te-note'))
    restore.hidden = true
    restore.setAttribute('role', 'status')
    const restoreBtn = make('button', 'te-chip')
    restoreBtn.type = 'button'
    restoreBtn.dataset['action'] = 'restore'
    restoreBtn.append(glyph('undo'), document.createTextNode(` ${t('editor.restore', 'restore')}`))
    restoreBtn.addEventListener('click', () => void this.#restore())
    const dismiss = iconButton('close', t('editor.notice-dismiss', 'Dismiss'), 'dismiss-restore')
    dismiss.addEventListener('click', () => { this.#service?.dropStash(); restore.hidden = true })
    restore.append(make('span', '', t('editor.restore-hint', 'You left changes here unsaved.')), restoreBtn, dismiss)
    return restore
  }

  #buildError(): HTMLElement {
    const error = this.#keep('error', make('div', 'te-note'))
    error.dataset['tone'] = 'alert'
    error.setAttribute('role', 'alert')
    error.hidden = true
    return error
  }

  /** What the group will write to every tile: the fields that were given a value. */
  #buildWrites(): HTMLElement {
    const writes = this.#keep('group-writes', make('div', 'te-note'))
    writes.hidden = true
    writes.setAttribute('role', 'status')
    writes.append(make('span'))
    return writes
  }

  /** The names of the group fields that hold a value (state-bound). */
  #groupSet(): string[] {
    const service = this.#service
    if (!service?.grouped) return []
    const props = service.properties as { border?: { color?: unknown }; background?: { color?: unknown }; hideText?: unknown; link?: unknown }
    const word = (key: FieldKey, fallback: string): string => t(FIELDS[key].labelKey, fallback)
    const out: string[] = []
    if (typeof props.border?.color === 'string' && props.border.color) out.push(word('border.color', 'border'))
    if (typeof props.background?.color === 'string' && props.background.color) out.push(word('background.color', 'fill behind'))
    if (typeof props.hideText === 'boolean') out.push(word('hideText', 'name'))
    if (typeof props.link === 'string' && props.link) out.push(word('link', 'link'))
    return out
  }

  // ── the list ──────────────────────────────────────────────────
  //
  // The shared tile rail, made per open through IoC (it drags in the chat chain,
  // so it is never imported). It browses freely with no follower of its level:
  // following would walk the hive, clear the selection and could write to a
  // phantom cell. A row on another level opens through the drone.

  #mountRail(panel: HTMLElement, host: HTMLElement): void {
    const reading = (row: RailRow): string =>
      ioc<ReadingShape>(KEYS.decorations)?.readingAt?.(row.segments) || row.name
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(KEYS.rail, value => {
        if (this.#panel !== panel || this.#rail) return
        const rail = (value as RailFactoryShape).create({
          walk: true,
          chats: false,
          choose: false,
          badge: () => 0,
          toggle: (row: RailRow) => {
            // A group is the tiles of ONE page: a row of another page is not added.
            if (!sameSegments(row.segments.slice(0, -1), this.#openTile().parent)) {
              const message = t('editor.group-same-page', 'A group is tiles of one page.')
              this.#announce(message)
              EffectBus.emit('toast:show', { type: 'info', message })
              return
            }
            EffectBus.emitTransient('editor:group-toggle', { label: row.name })
          },
          labelOf: reading,
          findLabel: t('editor.find-tiles', 'find tiles'),
          clickLabel: t('editor.open-tile', 'edit this tile'),
        })
        rail.onSubjectChanged = pick => {
          if (!pick) return
          EffectBus.emitTransient('editor:switch-request', { label: pick.name, parent: [...pick.path] })
        }
        rail.mount(host)
        this.#rail = rail
        this.#railKey = ''
        this.#railMark = ''
        this.#paintRail()
      })
  }

  /** The open tile lit, the group marked from the SESSION (the drone can refuse
   *  a toggle, so the rail never counts for itself). */
  #paintRail(): void {
    const rail = this.#rail
    const service = this.#service
    if (!rail || !service || service.mode !== 'editing') return
    const here = this.#openTile()
    const key = `${here.label}|${here.parent.join('/')}`
    if (key !== this.#railKey) { this.#railKey = key; rail.showCurrent(here.label, here.parent) }
    const marks = service.grouped ? service.group.map(label => [...here.parent, label]) : []
    const mark = marks.map(path => path.join('/')).join('\n')
    if (mark !== this.#railMark) { this.#railMark = mark; rail.showSelection(marks) }
  }

  /** The list's mark follows the OPEN tile. A switch that did not happen leaves
   *  the key unchanged, so the repaint is forced. */
  #restoreRail(): void {
    this.#railKey = ''
    this.#paintRail()
  }

  #setDrawer(open: boolean): void {
    this.#drawer = open
    this.#panel?.toggleAttribute('data-drawer', open)
    this.#ref('drawer-toggle')?.setAttribute('aria-expanded', String(open))
  }

  // ── the arithmetic ────────────────────────────────────────────

  /** The model's geometry: the diagram's own when it exists, so the art and the
   *  lit shapes cannot drift, else computed from the same numbers. */
  #geometry(): ModelGeometry {
    return this.#diagram?.geometry ?? this.#model.geometry(this.#size, this.#variant())
  }

  #variant(): string {
    return String(this.#images?.orientation ?? this.#model.defaultVariant)
  }

  #measure(panel: HTMLElement): LayoutOut {
    const root = document.documentElement
    const em = parseFloat(getComputedStyle(panel).fontSize) || 16
    const rem = parseFloat(getComputedStyle(root).fontSize) || 16
    const rootWidth = root.clientWidth || window.innerWidth
    const listWidth = this.#ref('list')?.getBoundingClientRect().width
    return layoutFor({
      listWidth: listWidth && listWidth > 0 && panel.dataset['layout'] !== 'narrow' ? listWidth : undefined,
      rootWidth,
      rootRem: rem,
      em,
      desk: { w: panel.clientWidth || rootWidth - 3.5 * rem, h: panel.clientHeight || window.innerHeight },
      model: this.#model,
      variant: this.#variant(),
      innerHeight: window.innerHeight,
    })
  }

  /** The framed picture in stage pixels — what the lit layer hatches around. */
  #pictureRect(size: number): Rect | null {
    const images = this.#images
    const natural = images?.natural
    if (!images || !natural || !images.hasImage || this.#service?.grouped) return null
    const framing = images.framingFor()
    const k = size / frameSize(images.side)
    const w = natural.width * framing.scale * k
    const h = natural.height * framing.scale * k
    return { x: size / 2 + framing.x * k - w / 2, y: size / 2 + framing.y * k - h / 2, w, h }
  }

  // ── syncing from the services ─────────────────────────────────

  readonly #schedule = (): void => {
    if (!this.#panel || this.#frame) return
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; this.#syncNow() })
  }

  /** Everything the desk shows, brought to what the services say. One pass, in
   *  an order that matters: layout, then the diagram (which owns the geometry),
   *  then the art drawn from that geometry. */
  #syncNow(): void {
    const panel = this.#panel
    const service = this.#service
    const images = this.#images
    if (!panel || !service || !images || this.#inSync) return
    this.#inSync = true
    try {
      const grouped = service.grouped
      if (grouped !== this.#grouped) this.#onGroupChanged(grouped)
      panel.toggleAttribute('data-group', grouped)

      const layout = this.#measure(panel)
      this.#layout = layout
      this.#size = layout.size
      panel.dataset['layout'] = layout.layout
      panel.dataset['list'] = layout.list
      const figure = this.#ref('figure')
      if (figure) {
        figure.style.width = figure.style.height = `${layout.size}px`
        figure.style.left = layout.layout === 'wide' ? `${layout.figure.left}px` : ''
        figure.style.top = layout.layout === 'wide' ? `${layout.figure.top}px` : ''
      }

      const hasPicture = images.hasImage && !grouped
      const hideText = service.hideText
      const diagram = this.#diagram
      diagram?.update({
        size: layout.size,
        variant: this.#variant(),
        unit: layout.unit,
        viewport: layout.viewport,
        layout: layout.layout,
        figure: layout.figure,
        picture: this.#pictureRect(layout.size),
        hasPicture,
        showName: !hideText || !hasPicture,
        ghostName: hideText && hasPicture,
        gesturing: this.#stage?.gesturing ?? false,
        camera: this.#camera !== null,
        open: diagram?.light.open ?? null,
      })

      if (this.#camera) this.#camera.root.style.clipPath = `path('${this.#geometry().mask}')`
      this.#syncName()
      this.#syncHeader()
      this.#syncNotices()
      const empty = this.#ref('empty')
      if (empty) empty.hidden = images.hasImage || grouped
      const cam = this.#ref('empty-camera')
      if (cam) cam.hidden = !this.#cameraAvailable()

      this.#stage?.setLook({
        border: parseHexColour(service.borderColor) ?? FIELDS['border.color'].fallback ?? '',
        name: this.#title.reading,
        showName: grouped || !hideText,
        fill: grouped ? '' : parseHexColour(service.backgroundColor) ?? '',
      })
      this.#paintRail()
      this.#emitPreview()
      this.#notify()
    } finally {
      this.#inSync = false
    }
  }

  #onGroupChanged(grouped: boolean): void {
    this.#grouped = grouped
    if (grouped) {
      this.#stopCamera()
      // A group has no name field: a refused or failed name is let go of, or it
      // would go on holding Save back from a field nobody can reach.
      const state = this.#title.status.state
      if (state === 'refused' || state === 'failed') {
        this.#title.revert()
        const input = this.#nameInput
        if (input) { input.value = this.#title.draft; input.removeAttribute('aria-invalid') }
      }
    }
    const service = this.#service
    this.#announce(grouped
      ? t('editor.group-announce', '{count} tiles. Changes apply to all.', { count: service?.group.length ?? 0 })
      : t('editor.group-one', 'One tile.'))
    if (grouped && document.activeElement === this.#nameInput) this.#nameInput?.blur()
  }

  /** The name input shows what is typed, unless it is being typed in. (A group has
   *  no name field: the diagram takes the input out of the way and the band
   *  speaks for the group in its own element.) */
  #syncName(): void {
    const input = this.#nameInput
    const service = this.#service
    if (!input || !service) return
    input.placeholder = this.#title.address || service.cell
    if (document.activeElement !== input && input.value !== this.#title.draft) input.value = this.#title.draft
    const refused = this.#title.status.state === 'refused'
    if (refused) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
  }

  #syncHeader(): void {
    const service = this.#service
    const images = this.#images
    if (!service || !images) return
    const grouped = service.grouped
    const here = this.#openTile()
    const reading = this.#ref('reading')
    const address = this.#ref('address')
    if (reading) {
      reading.textContent = grouped
        ? t('editor.group-title', '{count} tiles', { count: service.group.length })
        : (this.#title.stored || this.#title.address || service.cell)
    }
    if (address) {
      const readings = ioc<ReadingShape>(KEYS.decorations)
      address.textContent = grouped
        ? service.group.map(label => readings?.readingAt?.([...here.parent, label]) || label).join(', ')
        : `/${[...this.#segments()].join('/')}`
    }
    const portal = this.#ref('portal')
    if (portal) portal.hidden = grouped || !this.#throughPortal()

    const dirty = this.#dirty()
    const justSaved = !dirty && this.#title.status.state === 'saved' && Date.now() - this.#savedAt < SAVED_MS
    const state = this.#ref('state')
    if (state) {
      state.dataset['state'] = dirty ? 'dirty' : justSaved ? 'saved' : 'clean'
      const word = state.querySelector('.te-state-word')
      if (word) word.textContent = dirty ? t('editor.unsaved', 'unsaved') : justSaved ? t('editor.saved', 'saved') : ''
    }
    const primary = this.#ref<HTMLButtonElement>('primary')
    if (primary) {
      const saving = service.saving || this.#title.saving || this.#busy
      primary.disabled = saving
      primary.textContent = saving ? t('editor.saving', 'saving…') : dirty ? t('editor.save', 'save') : t('editor.done', 'done')
    }
    this.#panel?.setAttribute('aria-busy', String(service.saving))
  }

  #syncNotices(): void {
    const service = this.#service
    if (!service) return
    const restore = this.#ref('restore')
    if (restore) restore.hidden = service.grouped || !service.stashFor(service.cell, service.targetSegments)
    const writes = this.#ref('group-writes')
    if (writes) {
      const set = this.#groupSet()
      writes.hidden = set.length === 0
      const line = writes.firstElementChild
      if (line) {
        const text = set.length
          ? t('editor.group-writes', 'Set on all {count} tiles: {fields}.', { count: service.group.length, fields: set.join(', ') })
          : ''
        if (line.textContent !== text) line.textContent = text
      }
    }
    const error = this.#ref('error')
    if (error) {
      error.hidden = !service.error
      error.textContent = service.error
    }
  }

  #announce(text: string): void { this.#say(this.#ref('live'), text) }

  /** Say `text` in a live region. The same words again are cleared first and set
   *  on the next frame, or a screen reader would hear nothing the second time. */
  #say(region: HTMLElement | null, text: string): void {
    if (!region) return
    if (region.textContent !== text) { region.textContent = text; return }
    region.textContent = ''
    cancelAnimationFrame(this.#announceFrame)
    this.#announceFrame = requestAnimationFrame(() => { region.textContent = text })
  }

  /** Tell the diagram's controls that something they read has moved. */
  #notify(): void {
    for (const cb of [...this.#listeners]) cb()
  }

  // ── the name's address ────────────────────────────────────────

  #pageSegments(): string[] {
    return (ioc<LineageShape>(KEYS.lineage)?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #segments(): string[] {
    const service = this.#service
    if (!service) return []
    if (service.targetSegments.length > 0) return [...service.targetSegments]
    return service.cell ? [...this.#pageSegments(), service.cell] : []
  }

  #throughPortal(): boolean {
    const service = this.#service
    if (!service || service.targetSegments.length === 0) return false
    return service.targetSegments.join('/') !== [...this.#pageSegments(), service.cell].join('/')
  }

  // ── the port the diagram reads and writes through ────────────

  #makePort(): TileSessionPort {
    const view = this
    const service = (): TileEditorService => view.#service!
    const images = (): ImageEditorService => view.#images!
    const input = this.#nameInput!

    const READ: Record<FieldKey, () => FieldValue> = {
      'border.color': () => service().borderColor,
      'background.color': () => service().backgroundColor,
      hideText: () => {
        const hide = (service().properties as { hideText?: unknown }).hideText
        return service().grouped ? (typeof hide === 'boolean' ? hide : undefined) : service().hideText
      },
      link: () => service().link,
      title: () => view.#title.draft,
      picture: () => undefined,
      orientation: () => view.#variant(),
    }
    const WRITE: Record<FieldKey, (value: FieldValue) => void> = {
      'border.color': v => service().setBorderColor(typeof v === 'string' ? v : ''),
      'background.color': v => service().setBackgroundColor(typeof v === 'string' ? v : ''),
      hideText: v => service().setHideText(typeof v === 'boolean' ? v : undefined),
      link: v => {
        if (view.#verdict) { view.#verdict = null; view.#notify() }
        service().setLink(typeof v === 'string' ? v.trim() : '')
      },
      title: () => undefined,
      picture: () => undefined,
      orientation: v => { if (typeof v === 'string') void images().setOrientation(v as HexOrientation) },
    }

    const act = (a: Parameters<TileSessionPort['picture']['act']>[0]): void => {
      const model = images()
      const todo: Record<typeof a, () => void> = {
        upload: () => view.#pickFile(false),
        camera: () => view.#openCamera(),
        search: () => {
          // The words in the name field, then the stored reading, then the address.
          const q = view.#nameInput?.value.trim() || view.#title.reading || service().cell
          if (q) window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank', 'noopener')
        },
        remove: () => model.removePicture(),
        fill: () => model.setMode('fill'),
        fit: () => model.setMode('fit'),
        'zoom-in': () => view.#zoomBy(1.25),
        'zoom-out': () => view.#zoomBy(1 / 1.25),
        reset: () => model.resetFraming(),
        'link-toggle': () => model.setLinked(!model.linked),
      }
      todo[a]()
      view.#afterGesture()
    }

    const natural = (): { framing: ReturnType<ImageEditorService['framingFor']>; limits: ReturnType<typeof scaleLimits> } | null => {
      const model = images()
      if (!model.hasImage || !model.natural) return null
      return { framing: model.framingFor(), limits: scaleLimits(model.natural, model.boxFor(), model.mode) }
    }

    return {
      get group() {
        const s = service()
        return s.grouped ? { count: s.group.length, labels: [...s.group] } : null
      },
      value: key => READ[key](),
      set: (key, value) => WRITE[key](value),
      fallback: key => FIELDS[key].fallback ?? '',
      layer: (field: EditorField) => {
        const s = service()
        const layers = s.layers
        if (!layers || s.grouped) return null
        const base = layers[field]
        const pending = s.choices.get(field) ?? null
        const offered = [...OFFERED[base]] as LayerChoice[]
        if (pending && !offered.includes(pending)) offered.push(pending)
        return {
          base,
          choice: pending,
          offered,
          // Choosing the pending choice again takes it back.
          choose: (choice: LayerChoice | null) => s.choose(field, choice !== null && s.choices.get(field) === choice ? null : choice),
        }
      },
      name: {
        input,
        get value() { return view.#title.draft },
        get stored() { return view.#title.stored },
        get address() { return view.#title.address || service().cell },
        get locale() { return ioc<I18nProvider>(I18N_IOC_KEY)?.locale ?? 'en' },
        get status(): TitleStatus {
          const status = view.#title.status
          return status.state === 'saved' && Date.now() - view.#savedAt > SAVED_MS ? { state: 'idle' } : status
        },
        get dirty() { return view.#title.dirty },
        get throughPortal() { return view.#throughPortal() },
        focus: () => view.#focusName(),
        undo: () => { view.#title.revert(); input.value = view.#title.draft; view.#schedule() },
      },
      picture: {
        get has() { return images().hasImage },
        get mode() { return images().mode },
        get linked() { return images().linked },
        get noOriginal() {
          const model = images()
          const props = service().properties as { small?: { image?: unknown }; flat?: { small?: { image?: unknown } } }
          const kept = typeof props.small?.image === 'string' || typeof props.flat?.small?.image === 'string'
          return !model.hasImage && !model.loading && !model.removed && kept
        },
        get percent() {
          const n = natural()
          return n ? zoomPercent(n.framing.scale, images().natural!, images().boxFor()) : 0
        },
        get ratio() { const n = images().natural; return n ? ratioOf(n.width, n.height) : '' },
        get slider01() { const n = natural(); return n ? sliderOf(n.framing.scale, n.limits) : 0 },
        get cameraAvailable() { return view.#cameraAvailable() },
        get phone() { return mobileModeActive() || isTouch() },
        act,
        setSlider01: value => { view.#zoomTo(value); view.#afterGesture() },
        history: () => view.#history(),
        twinUrl: variant => view.#twinUrls.get(variant) ?? '',
        setVariant: id => { void images().setOrientation(id as HexOrientation); view.#stage?.el.focus({ preventScroll: true }) },
      },
      link: {
        get verdict() { return view.#verdict },
        check: () => view.#checkLink(),
        clearVerdict: () => { if (view.#verdict) { view.#verdict = null; view.#notify() } },
      },
      questions: {
        get items() { return view.#questions() },
        draft: id => view.#answerDrafts.get(id) ?? '',
        setDraft: (id, text) => { view.#answerDrafts.set(id, text) },
        reply: (id, text) => {
          const body = text.trim()
          if (!body) return
          EffectBus.emit('note:commit', { cellLabel: service().cell, text: `[A:${id}] ${body}` })
          view.#answerDrafts.delete(id)
          window.setTimeout(() => view.#notify(), 300)
        },
      },
      onChange: cb => { view.#listeners.add(cb); return () => { view.#listeners.delete(cb) } },
    }
  }

  // ── the picture ───────────────────────────────────────────────

  #afterGesture(): void {
    this.#scheduleTwins()
    this.#schedule()
  }

  #zoomTo(t01: number): void {
    const model = this.#images
    const natural = model?.natural
    if (!model || !natural) return
    const limits = scaleLimits(natural, model.boxFor(), model.mode)
    model.setFraming(zoomToward(model.framingFor(), scaleOfSlider(Math.min(1, Math.max(0, t01)), limits), { x: 0, y: 0 }, natural, model.boxFor(), model.mode))
  }

  #zoomBy(factor: number): void {
    const model = this.#images
    const natural = model?.natural
    if (!model || !natural) return
    const current = model.framingFor()
    model.setFraming(zoomToward(current, current.scale * factor, { x: 0, y: 0 }, natural, model.boxFor(), model.mode))
  }

  /** Every picture this name has worn (alias-properties.md, step 5); choosing one
   *  loads it as a new picture — the save then sinks it, or keeps it here. */
  async #history(): ReturnType<TileSessionPort['picture']['history']> {
    const service = this.#service
    const history = ioc<Parameters<typeof pictureHistory>[0]>(KEYS.history)
    const store = ioc<Parameters<typeof pictureHistory>[1]>(KEYS.store)
    this.#closeHistoryUrls()
    if (!service || !history || !store) return []
    const segments = service.targetSegments.length > 0 ? service.targetSegments : this.#segments()
    const entries = await pictureHistory(history, store, segments.slice(0, -1), service.cell).catch(() => [])
    if (!this.#panel) return []
    const out: { id: string; url: string; from: 'here' | 'repo' | 'variant'; choose(): void }[] = []
    for (const entry of entries) {
      // The desk may have closed while the thumbnails were read: no URL is made then.
      if (!this.#panel) return out
      const thumb = await store.getResource(entry.thumb).catch(() => null)
      if (!thumb) continue
      if (!this.#panel) return out
      const url = URL.createObjectURL(thumb)
      this.#historyUrls.push(url)
      out.push({
        id: entry.original,
        url,
        from: entry.from,
        choose: () => void store.getResource(entry.original).then(blob => { if (blob) this.#take(blob) }).catch(() => undefined),
      })
    }
    return out
  }

  #closeHistoryUrls(): void {
    for (const url of this.#historyUrls.splice(0)) URL.revokeObjectURL(url)
  }

  #resetTwins(): void {
    if (this.#twinTimer) clearTimeout(this.#twinTimer)
    this.#twinTimer = 0
    this.#twinGeneration++
    for (const url of this.#twinUrls.values()) URL.revokeObjectURL(url)
    this.#twinUrls.clear()
    this.#previewPictures = {}
  }

  /** The twins show the bytes a save would write — captured from the original a
   *  moment after a gesture settles. */
  #scheduleTwins(): void {
    if (this.#twinTimer) clearTimeout(this.#twinTimer)
    this.#twinTimer = 0
    const model = this.#images
    if (!this.#panel || !model) return
    if (!model.hasImage) {
      this.#twinGeneration++
      for (const url of this.#twinUrls.values()) URL.revokeObjectURL(url)
      this.#twinUrls.clear()
      this.#previewPictures = {}
      this.#emitPreview()
      return
    }
    if (this.#stage?.gesturing) return
    this.#twinTimer = window.setTimeout(() => { this.#twinTimer = 0; void this.#renderTwins() }, 160)
  }

  async #renderTwins(): Promise<void> {
    const model = this.#images
    const service = this.#service
    if (!model?.hasImage || !service) return
    const generation = ++this.#twinGeneration
    const fill = parseHexColour(service.backgroundColor)
    const pictures: PreviewSet = {}
    const variants = this.#model.variants
    for (let index = 0; index < variants.length; index++) {
      const id = variants[index].id
      try {
        const blob = await model.capture(id as HexOrientation, fill)
        if (generation !== this.#twinGeneration || !this.#panel) return
        const previous = this.#twinUrls.get(id)
        if (previous) URL.revokeObjectURL(previous)
        this.#twinUrls.set(id, URL.createObjectURL(blob))
        // Signed like the store signs it: the saved tile will ask the atlas for
        // exactly this signature, and find it already there.
        const sig = await SignatureService.sign(await blob.arrayBuffer())
        if (generation !== this.#twinGeneration || !this.#panel) return
        const slot = PREVIEW_SLOTS[index]
        if (slot) pictures[slot] = { sig, blob }
      } catch { return }
    }
    this.#previewPictures = pictures
    this.#emitPreview()
    this.#notify()
  }

  /** Paint the edit onto its tile in the hive (which the desk covers, so a save
   *  never flashes the old picture). Nothing is written: the renderer draws it
   *  over the tile's stored look until the desk closes. */
  #emitPreview(): void {
    const service = this.#service
    const model = this.#images
    if (!this.#panel || !service || !model || service.mode !== 'editing' || !service.cell) return
    if (this.#switchingTo) return
    const page = this.#pageSegments().join('/')
    if (service.grouped) {
      // A group paints only what it was given; everything else is each tile's own.
      const props = service.properties as { border?: { color?: unknown }; hideText?: unknown }
      const border = parseHexColour(props.border?.color) ?? undefined
      const hideText = typeof props.hideText === 'boolean' ? props.hideText : undefined
      const labels = new Set(service.group)
      this.#endPreview(labels)
      for (const label of labels) {
        this.#previewLabels.add(label)
        EffectBus.emitTransient('tile:preview', { label, page, point: null, flat: null, removed: false, border, hideText })
      }
      return
    }
    this.#endPreview(new Set([service.cell]))
    const pending = model.hasImage && !this.#previewPictures.point && !this.#previewPictures.flat
    this.#previewLabels.add(service.cell)
    EffectBus.emitTransient('tile:preview', {
      label: service.cell,
      page,
      // Until the first capture lands, leave the tile's stored picture up.
      point: pending ? null : this.#previewPictures.point ?? null,
      flat: pending ? null : this.#previewPictures.flat ?? null,
      removed: model.removed,
      border: parseHexColour(service.borderColor),
      hideText: service.hideText,
    })
  }

  /** End the preview on every tile but those in `keep`. */
  #endPreview(keep: ReadonlySet<string> = new Set()): void {
    for (const label of [...this.#previewLabels]) {
      if (keep.has(label)) continue
      EffectBus.emitTransient('tile:preview', { label, clear: true })
      this.#previewLabels.delete(label)
    }
    if (keep.size === 0) this.#previewPictures = {}
  }

  #take(blob: Blob): void {
    if (this.#service?.grouped) return
    this.#service?.setLargeBlob(blob)
    void this.#images?.loadImage(blob)
    this.#stage?.el.focus({ preventScroll: true })
  }

  #pickFile(capture: boolean): void {
    const panel = this.#panel
    if (!panel || this.#service?.grouped) return
    const input = make('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (capture) input.setAttribute('capture', 'environment')
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file) this.#take(file)
    })
    panel.appendChild(input)
    input.click()
  }

  #onDragOver = (e: DragEvent): void => {
    if (this.#service?.grouped || !e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (this.#stage) this.#stage.el.dataset['drop'] = 'true'
  }

  #onDragLeave = (): void => {
    if (this.#stage) delete this.#stage.el.dataset['drop']
  }

  #onDrop = (e: DragEvent): void => {
    this.#onDragLeave()
    if (this.#service?.grouped) return
    const image = [...(e.dataTransfer?.files ?? [])].find(file => file.type.startsWith('image/'))
    if (!image) return
    e.preventDefault()
    e.stopPropagation()
    this.#take(image)
  }

  // ── the camera ────────────────────────────────────────────────

  #cameraAvailable(): boolean {
    if (this.#service?.grouped) return false
    return mobileModeActive() || isTouch() || this.#hasCamera
  }

  #probeCamera(): void {
    const devices = navigator.mediaDevices
    if (!window.isSecureContext || !devices?.enumerateDevices || !devices.getUserMedia) return
    void devices.enumerateDevices().then(list => {
      this.#hasCamera = list.some(device => device.kind === 'videoinput')
      this.#schedule()
    }).catch(() => { /* no camera to offer */ })
  }

  #openCamera(): void {
    if (this.#service?.grouped) return
    // A phone's own camera app: no permission prompt, works over plain http on a
    // LAN, and returns a real photo.
    if (mobileModeActive() || isTouch()) { this.#pickFile(true); return }
    void this.#startViewfinder('environment')
  }

  async #startViewfinder(facing: 'environment' | 'user'): Promise<void> {
    const stage = this.#stage?.el
    if (!stage) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } })
    } catch {
      this.#service?.setError(t('editor.camera-unavailable', 'The camera is not available.'))
      return
    }
    if (!this.#panel) { stream.getTracks().forEach(track => track.stop()); return }
    this.#stopCamera()
    const root = make('div', 'te-camera')
    // The viewfinder fills the tile: cut by the model's mask, whatever it is.
    root.style.clipPath = `path('${this.#geometry().mask}')`
    const video = make('video')
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    const bar = make('div', 'te-camera-bar')
    const close = iconButton('close', t('editor.close-camera', 'close camera'), 'camera-close')
    close.addEventListener('click', () => this.#stopCamera())
    const shutter = make('button', 'te-shutter')
    shutter.type = 'button'
    shutter.dataset['action'] = 'shutter'
    shutter.setAttribute('aria-label', t('editor.shutter', 'take picture'))
    shutter.addEventListener('click', () => void this.#shoot(video))
    const flip = iconButton('cameraswitch', t('editor.switch-camera', 'switch camera'), 'camera-switch')
    flip.addEventListener('click', () => void this.#startViewfinder(facing === 'environment' ? 'user' : 'environment'))
    bar.append(close, shutter, flip)
    root.append(video, bar)
    stage.append(root)
    this.#camera = { stream, root, facing }
    document.addEventListener('visibilitychange', this.#onVisibility)
    window.addEventListener('pagehide', this.#stopCameraHandler)
    this.#schedule()
  }

  async #shoot(video: HTMLVideoElement): Promise<void> {
    if (!video.videoWidth || !video.videoHeight) return
    // The whole frame, once — the framing happens in the editor, never in the
    // bytes of the original.
    const canvas = make('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.92))
    this.#stopCamera()
    if (blob) this.#take(blob)
  }

  #onVisibility = (): void => { if (document.hidden) this.#stopCamera() }
  #stopCameraHandler = (): void => this.#stopCamera()

  #stopCamera(): void {
    const camera = this.#camera
    if (!camera) return
    camera.stream.getTracks().forEach(track => track.stop())
    camera.root.remove()
    this.#camera = null
    document.removeEventListener('visibilitychange', this.#onVisibility)
    window.removeEventListener('pagehide', this.#stopCameraHandler)
    this.#schedule()
  }

  // ── the link ──────────────────────────────────────────────────

  /** Check the link as it stands. A deny clears it and says why; a warn keeps it.
   *  Save awaits the check in flight, so a deny can no longer race a save. */
  #checkLink(): Promise<void> {
    this.#linkBusy = true
    const run: Promise<void> = this.#runLinkCheck().finally(() => { if (this.#linkCheck === run) this.#linkBusy = false })
    this.#linkCheck = run
    return run
  }

  /** Before a save leaves: the link as it stands has been checked. True = go on;
   *  false = a deny stays on the desk with its reason, and nothing is written. */
  async #settleLink(): Promise<boolean> {
    const service = this.#service
    if (!service) return false
    if (this.#linkBusy) await this.#linkCheck
    const value = service.link.trim()
    let ran = false
    if (value && value !== this.#checkedLink) { await this.#checkLink(); ran = true }
    return !(ran && this.#verdict?.tone === 'alert')
  }

  async #runLinkCheck(): Promise<void> {
    const service = this.#service
    if (!service) return
    const value = service.link.trim()
    this.#verdict = null
    this.#notify()
    if (!value) return
    // An explicit scheme other than web or mail is refused here, before any
    // service is asked: with no model answering, the service allows everything.
    if (unsafeScheme(value)) {
      this.#checkedLink = value
      this.#verdict = { tone: 'alert', reason: t('editor.link-scheme', 'Only web and mail links can be saved.') }
      service.setLink('')
      this.#notify()
      return
    }
    const safety = ioc<LinkSafetyShape>(KEYS.safety)
    if (!safety) return
    const target = this.#target
    try {
      const verdict = await safety.check(value)
      // Moved to another tile, or typed on, while the check ran: it is not this one's.
      if (this.#target !== target || service.link.trim() !== value) return
      this.#checkedLink = value
      if (verdict.decision === 'deny') {
        this.#verdict = { tone: 'alert', reason: verdict.reason }
        service.setLink('')
      } else if (verdict.decision === 'warn') {
        this.#verdict = { tone: 'warn', reason: verdict.reason }
      }
    } catch { /* an unreadable verdict leaves the link as typed */ }
    this.#notify()
  }

  // ── questions ─────────────────────────────────────────────────

  #questions(): { id: string; question: string; answer?: string }[] {
    const service = this.#service
    if (!service || service.grouped) return []
    const notes = ioc<NotesShape>(KEYS.notes)?.notesFor?.(service.cell) ?? []
    const questions = new Map<string, string>()
    const answers = new Map<string, string>()
    for (const note of notes) {
      const text = String(note.text ?? '').trim()
      const q = Q_NOTE.exec(text)
      if (q) { questions.set(note.id, q[1].trim()); continue }
      const a = A_NOTE.exec(text)
      if (a) answers.set(a[1], a[2].trim())
    }
    return [...questions].map(([id, question]) => ({ id, question, answer: answers.get(id) }))
  }

  // ── a discarded draft ─────────────────────────────────────────

  async #restore(): Promise<void> {
    const service = this.#service
    const model = this.#images
    if (!service || !model) return
    const stash = service.stashFor(service.cell, service.targetSegments)
    if (!stash) return
    service.restoreProperties(stash.properties)
    if (stash.pictureRemoved) {
      model.removePicture()
    } else if (stash.picture) {
      const picture = stash.picture
      service.setLargeBlob(picture.source)
      await model.loadImage(picture.source)
      model.setLinked(picture.linked)
      model.setMode(picture.mode)
      const [first, second] = this.#model.variants.map(v => v.id as HexOrientation)
      model.setFraming(picture.point, first)
      if (!picture.linked && second) model.setFraming(picture.flat, second)
    }
    service.dropStash()
    this.#afterGesture()
  }

  // ── keys ──────────────────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if (e.key === 'Escape') {
      // The hive's keymap hears Escape first and the escape cascade has already
      // unwound one rung of this desk. A second unwind here would take the next
      // rung with it: a dismissed question would close the whole editor.
      if (e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      if (!this.dismissInner()) this.#cancel()
      return
    }
    if (e.key !== 'Enter') return
    if (this.#leaving) return
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); void this.#save(); return }
    if (target === this.#stage?.el) { e.preventDefault(); void this.#save(); return }
    if (target instanceof HTMLInputElement && !['color', 'range', 'file', 'checkbox'].includes(target.type) && target.closest('.te-vp')) {
      e.preventDefault()
      target.blur()
    }
  }

  // ── the phone keyboard ────────────────────────────────────────

  #watchKeyboard(panel: HTMLElement): void {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = (): void => {
      if (this.#panel !== panel) return
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      panel.style.setProperty('--te-kb', `${covered}px`)
      panel.dataset['keyboard'] = String(covered > 80)
      const active = document.activeElement
      if (covered > 80 && active instanceof HTMLElement && panel.contains(active)) active.scrollIntoView({ block: 'nearest' })
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    this.#openCleanup.push(() => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    })
    update()
  }
}

/** The view's IoC face, for the bee that registers it. */
export { facade as tileEditorViewFacade }

// tile-editor.drone.ts registers the facade and adds this element to the
// shell's surface registry (atomic-modules-plan.md): a dependency registers
// nothing.
