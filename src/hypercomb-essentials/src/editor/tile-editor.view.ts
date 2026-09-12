// editor/tile-editor.view.ts
//
// THE TILE EDITOR — a surface that fits INTO the view.
//
// On a screen with room it docks to the right of the hive: a window in the
// right-hand lane like every other tool window, reserving its edge so the hive
// re-fits beside it and the tile being edited stays in view. On a phone (and
// on a screen too narrow to spare a usable hive) it is a full-height page above
// the control bar. It is never a popup — there is no scrim and the hive is
// never blacked out, because a crop, a rim colour and a name are judged
// against the tiles around them.
//
// Top to bottom: the tile's name (it IS the heading — edit it in place); the
// picture, framed under the tile's own look; Fill / Fit, zoom and reset; the
// two orientations as live thumbnails of the bytes a save will write, linked or
// framed apart; where the picture comes from; the rim colour, whether the name
// shows, the fill behind a Fit picture; the link; open questions; Save.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// — never an Angular class, never a tag in app.html. It holds no state of its
// own that matters: the session lives in TileEditorService, the picture and
// its framing in ImageEditorService, and the save in TileEditorDrone. So a
// rebuild (a window narrowed past the dock, a phone rotated) loses nothing.

import {
  EffectBus,
  I18N_IOC_KEY,
  SignatureService,
  attachDockedPanel,
  holdWindow,
  type DockedPanel,
  type I18nProvider,
  type WindowSession,
} from '@hypercomb/core'
import { CropStage } from './crop-stage.js'
import { EMPTY_TILE_GROUND } from './tile-look-overlay.js'
import { editorSurface, dockWidthFor, mobileModeActive, DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from './editor-surface.js'
import { parseHexColour } from './hex-capture.js'
import { scaleLimits, scaleOfSlider, sliderOf, zoomPercent, zoomToward, type HexOrientation } from './crop-math.js'
import { installTileEditorStyles, TILE_EDITOR_SURFACE } from './tile-editor.styles.js'
import type { EditorSurfaceKind, TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

const OWNER = '@diamondcoreprocessor.com/TileEditorView'
const WINDOW_ID = 'tile-editor'
const INSET_OWNER = 'tile-editor'
const DEFAULT_BORDER = '#c8975a'
const SLIDER_STEPS = 1000

type DroneShape = {
  saveAndComplete?(): Promise<void>
  cancelEditing?(): void
  switchTo?(label: string, options?: { save?: boolean }): Promise<boolean>
}
type NotesShape = { notesFor?(cell: string): readonly { id: string; text?: string }[] }
type DecorationsShape = {
  titleOf?(segments: readonly string[], locale?: string): Promise<string>
  setTitle?(segments: readonly string[], text: string, locale?: string): Promise<string>
}
type LinkSafetyShape = { check(url: string): Promise<{ decision: 'allow' | 'warn' | 'deny'; reason: string }> }
type BackGestureShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type LineageShape = { explorerSegments?(): readonly string[] }

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

const glyph = (name: string): HTMLSpanElement => {
  const span = document.createElement('span')
  span.className = 'mat-sym'
  span.setAttribute('aria-hidden', 'true')
  span.textContent = name
  return span
}

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

const iconButton = (name: string, label: string, action: string): HTMLButtonElement => {
  const btn = make('button', 'te-icon-btn')
  btn.type = 'button'
  btn.dataset['action'] = action
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.appendChild(glyph(name))
  return btn
}

const isTouch = (): boolean => {
  try { return matchMedia('(pointer: coarse)').matches } catch { return false }
}

/** The view's IoC face. The element is created by the shell's surface host, so
 *  the registered object forwards to whichever element is mounted. */
const facade = {
  current: null as TileEditorElement | null,
  dismissInner(): boolean { return facade.current?.dismissInner() ?? false },
}

export class TileEditorElement extends HTMLElement {

  #service: TileEditorService | undefined
  #model: ImageEditorService | undefined
  #panel: HTMLElement | null = null
  #surface: EditorSurfaceKind = 'dock'
  #stage: CropStage | null = null
  #dock: DockedPanel | null = null
  #releaseWindow: (() => void) | null = null
  #releaseBack: (() => void) | null = null
  #cleanup: (() => void)[] = []
  #openCleanup: (() => void)[] = []
  #refs = new Map<string, HTMLElement>()

  #storedTitle = ''
  #titleFor = ''
  #verdict: { tone: 'warn' | 'alert'; reason: string } | null = null
  #twinUrls: Partial<Record<HexOrientation, string>> = {}
  #twinTimer = 0
  #twinGeneration = 0
  #suppressed = false
  #hasCamera = false
  #camera: { stream: MediaStream; root: HTMLElement; facing: 'environment' | 'user' } | null = null
  #answerDrafts = new Map<string, string>()

  // The live preview in the hive: the small pictures a save would write right
  // now (the twins' captures, signed), and the tile the preview is painted on.
  #previewPictures: { point?: { sig: string; blob: Blob }; flat?: { sig: string; blob: Blob } } = {}
  #previewLabel = ''

  // Moving to another tile while docked. `#target` is the tile the panel is
  // built for; `#leaving` is a tile clicked while this one has unsaved changes
  // (the footer asks); `#switchingTo` is a move in flight, during which the
  // preview stands down so neither tile is painted with the other's look.
  #target = ''
  #leaving = ''
  #switchingTo = ''

  // What this window reserves of the right edge — see #reserve.
  #insetObserver: ResizeObserver | null = null
  #offPoll: (() => void) | null = null
  #insetFrame = 0
  #insetTimer = 0

  readonly #session: WindowSession = {
    // Put away by the shell (another window, a lane, the installer): the
    // editor does not survive hidden — a hidden editor would keep holding the
    // hive's input gate and paste routing. Its changed draft is kept.
    park: () => this.#cancel(),
    unpark: () => { /* reopening a tile offers the kept draft back */ },
    dismiss: () => this.dismissInner(),
    close: () => this.#cancel(),
  }

  // ── lifecycle ─────────────────────────────────────────────────

  connectedCallback(): void {
    installTileEditorStyles()
    facade.current = this
    this.#service = ioc<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    this.#model = ioc<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    this.#service?.addEventListener('change', this.#onServiceChange)
    this.#model?.addEventListener('change', this.#onModelChange)
    window.addEventListener('resize', this.#onResize)
    this.#cleanup.push(
      () => this.#service?.removeEventListener('change', this.#onServiceChange),
      () => this.#model?.removeEventListener('change', this.#onModelChange),
      () => window.removeEventListener('resize', this.#onResize),
      EffectBus.on('notes:changed', () => this.#renderQuestions()),
      EffectBus.on<{ label?: unknown }>('editor:switch-request', this.#onSwitchRequest),
    )
    this.#onServiceChange()
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup.splice(0)) off()
    if (this.#panel) {
      // Taken off the page mid-edit: close the session too, or the hive's
      // input gate stays locked behind an editor nobody can see.
      this.#teardown()
      ioc<DroneShape>('@diamondcoreprocessor.com/TileEditorDrone')?.cancelEditing?.()
    }
    if (facade.current === this) facade.current = null
  }

  /** Unwind ONE level of the editor's own state. True = the press was used. */
  dismissInner(): boolean {
    const panel = this.#panel
    if (!panel) return false
    if (this.#leaving) { this.#setLeaving(''); return true }
    if (this.#camera) { this.#stopCamera(); return true }
    const title = this.#ref<HTMLInputElement>('title')
    if (title && document.activeElement === title) {
      if (title.value !== this.#storedTitle) title.value = this.#storedTitle
      title.removeAttribute('aria-invalid')
      this.#setTitleHint('')
      title.blur()
      return true
    }
    if (this.#verdict) { this.#verdict = null; this.#renderVerdict(); return true }
    const active = document.activeElement
    if (active instanceof HTMLElement && panel.contains(active) && active.matches('input, textarea')) {
      active.blur()
      return true
    }
    return false
  }

  // ── session ───────────────────────────────────────────────────

  #onServiceChange = (): void => {
    const service = this.#service
    if (!service) return
    const editing = service.mode === 'editing'
    if (editing && !this.#panel) this.#open()
    else if (!editing && this.#panel) this.#teardown()
    else if (editing && this.#targetKey() !== this.#target) this.#retarget()
    else if (editing) this.#syncFields()
  }

  #targetKey(): string {
    const service = this.#service
    return service ? `${service.cell}|${service.targetSegments.join('/')}` : ''
  }

  #onModelChange = (): void => {
    if (!this.#panel) return
    this.#stage?.render()
    this.#syncPicture()
    this.#syncActions()
    this.#scheduleTwins()
  }

  #onResize = (): void => {
    if (!this.#panel || !this.#service) return
    const next = editorSurface()
    if (next === this.#surface) return
    // Crossed between dock and page. Everything that matters lives in the
    // services, so a rebuild is safe; carry the half-typed name across.
    const title = this.#ref<HTMLInputElement>('title')?.value
    this.#service.setSurface(next)
    this.#teardown()
    this.#open()
    const fresh = this.#ref<HTMLInputElement>('title')
    if (fresh && title !== undefined) fresh.value = title
  }

  #cancel(): void {
    ioc<DroneShape>('@diamondcoreprocessor.com/TileEditorDrone')?.cancelEditing?.()
  }

  #save(): void {
    const service = this.#service
    if (!service || service.saving) return
    const title = this.#ref<HTMLInputElement>('title')
    if (title && document.activeElement === title) this.#commitTitle()
    const link = this.#ref<HTMLInputElement>('link')
    if (link) service.setLink(link.value.trim())
    void ioc<DroneShape>('@diamondcoreprocessor.com/TileEditorDrone')?.saveAndComplete?.()
  }

  // ── another tile ──────────────────────────────────────────────
  //
  // Docked, the hive beside the editor stays live for one gesture: a click on
  // another tile moves the editor there. Nothing changed, it just moves. With
  // changes, the footer asks — save them and open, open without saving (the
  // draft is kept and offered back, as a cancel keeps it), or keep editing.
  // The press itself is the tile overlay's (`editor:switch-request`); on a
  // phone the page covers the hive, so the request never comes.

  #onSwitchRequest = (payload: { label?: unknown } | undefined): void => {
    const service = this.#service
    const label = typeof payload?.label === 'string' ? payload.label : ''
    if (!label || !service || !this.#panel || this.#surface !== 'dock') return
    if (service.mode !== 'editing' || service.saving || this.#switchingTo) return
    if (label === service.cell) return
    if (this.#dirty()) { this.#setLeaving(label); return }
    void this.#switchTo(label, false)
  }

  #dirty(): boolean {
    const service = this.#service
    const model = this.#model
    if (!service || !model) return false
    return service.dirty || model.pictureChanged || model.framingChanged
  }

  async #switchTo(label: string, save: boolean): Promise<void> {
    const service = this.#service
    const drone = ioc<DroneShape>('@diamondcoreprocessor.com/TileEditorDrone')
    if (!label || !service || !drone?.switchTo || this.#switchingTo) return
    const from = this.#target
    this.#setLeaving('')
    // The name is written the moment it is let go of, draft or not.
    const title = this.#ref<HTMLInputElement>('title')
    if (title && document.activeElement === title) this.#commitTitle()
    if (save) {
      const link = this.#ref<HTMLInputElement>('link')
      if (link) service.setLink(link.value.trim())
    }
    // The preview stays painted — a save's own render replaces it with the
    // same pixels — but nothing new is emitted until the editor has arrived.
    this.#switchingTo = label
    try {
      await drone.switchTo(label, { save })
    } finally {
      if (this.#switchingTo === label) this.#switchingTo = ''
      // Still on the first tile (the save failed, or the tile could not be
      // read): it goes on showing the edit.
      if (this.#panel && this.#target === from) this.#emitPreview()
    }
  }

  #setLeaving(label: string): void {
    this.#leaving = label
    const leave = this.#ref('leave')
    if (!leave) return
    const question = this.#ref('leave-question')
    if (question && label) {
      question.textContent = t('editor.leave-question', 'Save your changes before opening “{name}”?', { name: label })
    }
    const hadFocus = leave.contains(document.activeElement)
    leave.hidden = !label
    leave.parentElement?.toggleAttribute('data-leaving', !!label)
    for (const name of ['cancel', 'primary']) {
      const btn = this.#ref(name)
      if (btn) btn.hidden = !!label
    }
    if (label) this.#ref<HTMLButtonElement>('leave-save')?.focus({ preventScroll: true })
    else if (hadFocus) this.#panel?.focus({ preventScroll: true })
  }

  /** The session moved to another tile under an open panel. The window, its
   *  width and the hive's reserved edge stay exactly where they are; what
   *  belonged to the last tile goes. */
  #retarget(): void {
    this.#target = this.#targetKey()
    this.#switchingTo = ''
    this.#setLeaving('')
    this.#endPreview()
    this.#stopCamera()
    if (this.#twinTimer) clearTimeout(this.#twinTimer)
    this.#twinTimer = 0
    this.#twinGeneration++
    for (const orientation of ['point-top', 'flat-top'] as const) this.#setTwin(orientation, '')
    this.#verdict = null
    this.#renderVerdict()
    this.#answerDrafts.clear()
    // Empty the name BEFORE letting go of it: its blur commits, and the
    // session already names the new tile.
    this.#storedTitle = ''
    const title = this.#ref<HTMLInputElement>('title')
    if (title) {
      title.value = ''
      title.removeAttribute('aria-invalid')
      if (document.activeElement === title) title.blur()
    }
    this.#setTitleHint('')
    const body = this.#panel?.querySelector<HTMLElement>('.te-body')
    if (body) body.scrollTop = 0
    this.#renderQuestions()
    this.#renderRestore()
    this.#stage?.render()
    this.#syncFields()
  }

  // ── building ──────────────────────────────────────────────────

  #open(): void {
    const service = this.#service
    const model = this.#model
    if (!service || !model) return
    this.#surface = service.surface ?? editorSurface()

    const panel = make('aside', 'te-panel')
    panel.dataset['surface'] = this.#surface
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('editor.title', 'tile editor'))
    panel.setAttribute('data-hc-tile-editor', '')
    panel.setAttribute('data-consumes-wheel', '')
    panel.tabIndex = -1
    this.#panel = panel
    this.#target = this.#targetKey()

    this.#stage = new CropStage(model, () => this.#afterGesture())

    panel.append(this.#buildHead())
    const body = make('div', 'te-body')
    body.setAttribute('data-role', 'editor-body')
    // Two columns that dissolve (display: contents) everywhere except a
    // landscape phone, where the stage stays put beside a scrolling column.
    const [picture, tools] = this.#buildPicture()
    const stageColumn = make('div', 'te-col te-col-stage')
    stageColumn.append(picture)
    const fieldColumn = make('div', 'te-col te-col-fields')
    fieldColumn.append(this.#buildNotes(), tools, this.#buildLook(), this.#buildLink(), this.#buildQuestions())
    body.append(stageColumn, fieldColumn)
    panel.append(body)
    if (this.#surface === 'dock') panel.append(this.#buildActions())
    this.appendChild(panel)

    panel.addEventListener('keydown', this.#onKeyDown)
    panel.addEventListener('focusin', this.#onFocusIn)
    panel.addEventListener('focusout', this.#onFocusOut)
    this.#openCleanup.push(() => {
      panel.removeEventListener('keydown', this.#onKeyDown)
      panel.removeEventListener('focusin', this.#onFocusIn)
      panel.removeEventListener('focusout', this.#onFocusOut)
    })

    if (this.#surface === 'dock') {
      this.#dock = attachDockedPanel(panel, {
        id: WINDOW_ID,
        dockSide: 'right',
        defaultWidth: dockWidthFor(),
        minWidth: DOCK_MIN_WIDTH,
        maxWidth: DOCK_MAX_WIDTH,
        hcSession: this.#session,
        onClose: () => this.#cancel(),
      })
      this.#reserve()
    } else {
      this.#releaseWindow = holdWindow(WINDOW_ID, this.#session, () => this.#panel)
      this.#watchKeyboard()
    }

    const back = ioc<BackGestureShape>('@diamondcoreprocessor.com/BackGesture')
    this.#releaseBack = back?.register({
      owner: 'tile-editor',
      active: () => this.#panel !== null,
      back: () => this.#cancel(),
    }) ?? null

    this.#probeCamera()
    this.#loadTitle()
    this.#syncFields()
    this.#syncPicture()
    this.#syncActions()
    this.#renderQuestions()
    this.#renderRestore()
    this.#stage.render()
    this.#scheduleTwins()
    requestAnimationFrame(() => {
      if (this.#panel !== panel) return
      this.#stage?.render()
      panel.focus({ preventScroll: true })
    })
  }

  #teardown(): void {
    this.#endPreview()
    this.#stopCamera()
    if (this.#twinTimer) clearTimeout(this.#twinTimer)
    this.#twinTimer = 0
    this.#twinGeneration++
    for (const url of Object.values(this.#twinUrls)) if (url) URL.revokeObjectURL(url)
    this.#twinUrls = {}
    for (const off of this.#openCleanup.splice(0)) off()
    this.#stage?.dispose()
    this.#stage = null
    this.#dock?.dispose()
    this.#dock = null
    this.#release()
    this.#releaseWindow?.()
    this.#releaseWindow = null
    this.#releaseBack?.()
    this.#releaseBack = null
    this.#unsuppress()
    this.#panel?.remove()
    this.#panel = null
    this.#refs.clear()
    this.#verdict = null
    this.#titleFor = ''
    this.#answerDrafts.clear()
    this.#target = ''
    this.#leaving = ''
    this.#switchingTo = ''
  }

  #ref<T extends HTMLElement>(name: string): T | null {
    return (this.#refs.get(name) as T | undefined) ?? null
  }

  #keep<T extends HTMLElement>(name: string, node: T): T {
    this.#refs.set(name, node)
    return node
  }

  #buildHead(): HTMLElement {
    const head = make('header', 'te-head')
    const page = this.#surface === 'page'

    if (page) {
      const back = iconButton('arrow_back', t('editor.cancel', 'cancel'), 'cancel')
      back.addEventListener('click', () => this.#cancel())
      head.append(back)
    }

    const title = this.#keep('title', make('input', 'te-title'))
    title.type = 'text'
    title.name = 'tile-name'
    title.autocomplete = 'off'
    title.spellcheck = false
    title.setAttribute('enterkeyhint', 'done')
    title.setAttribute('aria-label', t('editor.name', 'name'))
    title.title = t('editor.name-hint', 'How this tile reads in your language.')
    title.placeholder = this.#service?.cell ?? ''
    title.addEventListener('input', () => {
      title.removeAttribute('aria-invalid')
      this.#setTitleHint('')
      this.#syncLook()
    })
    title.addEventListener('blur', () => this.#commitTitle())
    head.append(title)

    const portal = this.#keep('portal', make('span', 'te-portal'))
    portal.append(glyph('link'), make('span', '', t('editor.portal-target', 'edits the original')))
    portal.hidden = true
    head.append(portal)

    if (page) {
      const save = this.#keep('primary', make('button', 'te-btn te-btn-primary'))
      save.type = 'button'
      save.dataset['action'] = 'save'
      save.addEventListener('click', () => this.#save())
      head.append(save)
    } else {
      const close = iconButton('close', t('editor.cancel', 'cancel'), 'cancel')
      close.classList.add('close')
      close.addEventListener('click', () => this.#cancel())
      head.append(close)
    }
    return head
  }

  #buildNotes(): HTMLElement {
    const wrap = make('div', 'te-notes')

    const titleHint = this.#keep('title-hint', make('p', 'te-hint'))
    titleHint.dataset['tone'] = 'alert'
    titleHint.hidden = true

    const restore = this.#keep('restore', make('div', 'te-note'))
    restore.hidden = true
    restore.setAttribute('role', 'status')
    const restoreText = make('span', '', t('editor.restore-hint', 'You left changes here unsaved.'))
    const restoreBtn = make('button', 'te-chip')
    restoreBtn.type = 'button'
    restoreBtn.dataset['action'] = 'restore'
    restoreBtn.append(glyph('undo'), document.createTextNode(` ${t('editor.restore', 'restore')}`))
    restoreBtn.addEventListener('click', () => void this.#restore())
    const restoreClose = iconButton('close', t('editor.cancel', 'cancel'), 'dismiss-restore')
    restoreClose.addEventListener('click', () => { this.#service?.dropStash(); restore.hidden = true })
    restore.append(restoreText, restoreBtn, restoreClose)

    const error = this.#keep('error', make('div', 'te-note'))
    error.dataset['tone'] = 'alert'
    error.setAttribute('role', 'alert')
    error.hidden = true

    wrap.append(titleHint, restore, error)
    return wrap
  }

  #buildPicture(): [HTMLElement, HTMLElement] {
    const model = this.#model!
    const section = make('section', 'te-picture')
    section.setAttribute('aria-label', t('editor.picture', 'picture'))
    const stage = this.#stage!.el

    // Empty: the tile's own ground, a way to give it a picture.
    const empty = this.#keep('empty', make('div', 'te-empty'))
    empty.setAttribute('data-hc-ground', EMPTY_TILE_GROUND)
    const mark = glyph('add_photo_alternate')
    mark.classList.add('te-empty-mark')
    const tools = make('div', 'te-empty-tools')
    tools.append(make('p', '', t('editor.drop-or-choose', 'drop a picture, or choose one')))
    const row = make('div')
    const upload = make('button', 'te-empty-btn')
    upload.type = 'button'
    upload.dataset['action'] = 'upload'
    upload.append(glyph(this.#surface === 'page' ? 'photo_library' : 'upload'),
      document.createTextNode(this.#surface === 'page' ? t('editor.library', 'library') : t('editor.upload', 'upload')))
    upload.addEventListener('click', () => this.#pickFile(false))
    const camera = this.#keep('empty-camera', make('button', 'te-empty-btn'))
    camera.type = 'button'
    camera.dataset['action'] = 'camera'
    camera.append(glyph('photo_camera'), document.createTextNode(t('editor.camera', 'camera')))
    camera.addEventListener('click', () => this.#openCamera())
    row.append(upload, camera)
    tools.append(row)
    empty.append(mark, make('span'), tools)
    stage.append(empty)

    stage.addEventListener('dragover', this.#onDragOver)
    stage.addEventListener('dragleave', this.#onDragLeave)
    stage.addEventListener('drop', this.#onDrop)

    // Fill | Fit · zoom · reset
    const toolbar = make('div', 'te-toolbar')
    const segment = this.#keep('mode', make('div', 'te-segment'))
    segment.setAttribute('role', 'radiogroup')
    segment.setAttribute('aria-label', t('editor.framing', 'framing'))
    for (const [mode, icon, key, fallback] of [['fill', 'crop_free', 'editor.fill', 'fill'], ['fit', 'fit_screen', 'editor.fit', 'fit']] as const) {
      const btn = make('button')
      btn.type = 'button'
      btn.setAttribute('role', 'radio')
      btn.dataset['mode'] = mode
      btn.append(glyph(icon), document.createTextNode(t(key, fallback)))
      btn.addEventListener('click', () => { model.setMode(mode); this.#afterGesture() })
      segment.append(btn)
    }
    const zoom = make('div', 'te-zoom')
    const zoomOut = iconButton('zoom_out', t('editor.zoom-out', 'zoom out'), 'zoom-out')
    zoomOut.addEventListener('click', () => this.#zoomBy(1 / 1.25))
    const slider = this.#keep('zoom', make('input'))
    slider.type = 'range'
    slider.min = '0'
    slider.max = String(SLIDER_STEPS)
    slider.step = '1'
    slider.setAttribute('aria-label', t('editor.zoom', 'zoom'))
    slider.addEventListener('input', () => this.#zoomTo(Number(slider.value) / SLIDER_STEPS))
    slider.addEventListener('change', () => this.#afterGesture())
    const zoomIn = iconButton('zoom_in', t('editor.zoom-in', 'zoom in'), 'zoom-in')
    zoomIn.addEventListener('click', () => this.#zoomBy(1.25))
    const readout = this.#keep('readout', make('span', 'te-readout'))
    zoom.append(zoomOut, slider, zoomIn, readout)
    const reset = this.#keep('reset', iconButton('center_focus_strong', t('editor.reset', 'reset framing'), 'reset'))
    reset.addEventListener('click', () => { model.resetFraming(); this.#afterGesture() })
    this.#keep('zoom-out', zoomOut)
    this.#keep('zoom-in', zoomIn)
    toolbar.append(segment, zoom, reset)

    // The two orientations · where the picture comes from
    const row2 = make('div', 'te-row')
    const shapes = make('div', 'te-shapes')
    shapes.setAttribute('aria-label', t('editor.shape', 'shape'))
    const twin = (orientation: HexOrientation, key: string, fallback: string): HTMLButtonElement => {
      const btn = this.#keep(`twin-${orientation}`, make('button', 'te-twin'))
      btn.type = 'button'
      btn.dataset['orientation'] = orientation
      btn.append(make('span', 'te-twin-hex'), make('span', '', t(key, fallback)))
      btn.addEventListener('click', () => { void model.setOrientation(orientation); this.#stage?.el.focus({ preventScroll: true }) })
      return btn
    }
    const link = this.#keep('linked', iconButton('link', t('editor.frame-apart', 'frame each shape apart'), 'link'))
    link.addEventListener('click', () => { model.setLinked(!model.linked); this.#afterGesture() })
    shapes.append(twin('point-top', 'editor.point-top', 'point-top'), link, twin('flat-top', 'editor.flat-top', 'flat-top'))

    const sources = make('div', 'te-sources')
    const pick = iconButton(this.#surface === 'page' ? 'photo_library' : 'upload',
      this.#surface === 'page' ? t('editor.library', 'library') : t('editor.upload', 'upload'), 'upload')
    pick.addEventListener('click', () => this.#pickFile(false))
    const cam = this.#keep('camera', iconButton('photo_camera', t('editor.camera', 'camera'), 'camera'))
    cam.addEventListener('click', () => this.#openCamera())
    const search = iconButton('search', t('editor.search-google', 'search images'), 'search')
    search.addEventListener('click', () => {
      const q = this.#ref<HTMLInputElement>('title')?.value.trim() || this.#service?.cell || ''
      if (q) window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank', 'noopener')
    })
    const remove = this.#keep('remove', iconButton('hide_image', t('editor.remove-picture', 'remove picture'), 'remove'))
    remove.addEventListener('click', () => model.removePicture())
    sources.append(pick, cam, search, remove)
    row2.append(shapes, sources)

    const noOriginal = this.#keep('no-original', make('p', 'te-hint',
      t('editor.no-original', "This picture has no original here, so it can't be re-framed. Choose a picture to frame it.")))
    noOriginal.hidden = true

    section.append(stage)
    const pictureTools = make('div', 'te-picture-tools')
    pictureTools.append(toolbar, row2, noOriginal)
    return [section, pictureTools]
  }

  #buildLook(): HTMLElement {
    const service = this.#service!
    const section = make('section', 'te-section')
    section.append(make('h4', 'te-section-head', t('editor.look', 'look')))

    // Rim colour
    const border = this.#colourField('border', 'border_color', t('editor.border', 'border'), DEFAULT_BORDER,
      value => service.setBorderColor(value), t('editor.default', 'default'))
    section.append(border)

    // Show the name over the picture
    const nameRow = make('div', 'te-field')
    const nameLabel = make('span', 'te-label')
    nameLabel.append(glyph('text_fields'), document.createTextNode(t('editor.show-name', 'name')))
    const toggle = this.#keep('show-name', make('button', 'te-switch'))
    toggle.type = 'button'
    toggle.setAttribute('role', 'switch')
    const track = make('span', 'te-switch-track')
    track.append(make('span', 'te-switch-knob'))
    const state = this.#keep('show-name-state', make('span'))
    toggle.append(track, state)
    toggle.addEventListener('click', () => service.setHideText(!service.hideText))
    const nameControl = make('div', 'te-control')
    nameControl.append(toggle)
    nameRow.append(nameLabel, nameControl)
    section.append(nameRow)

    // Fill behind a picture set to Fit
    const fill = this.#colourField('background', 'palette', t('editor.fill-behind', 'fill behind'), '',
      value => service.setBackgroundColor(value), t('editor.none', 'none'))
    this.#keep('background-row', fill)
    section.append(fill)
    return section
  }

  /** A colour row: swatch (the native picker under it), the hex text, and a
   *  chip that clears the value. An unset value shows its default as a
   *  placeholder and is never written. */
  #colourField(name: string, icon: string, label: string, fallback: string, write: (value: string) => void, clearLabel: string): HTMLElement {
    const row = make('div', 'te-field')
    const text = make('span', 'te-label')
    text.append(glyph(icon), document.createTextNode(label))
    const control = make('div', 'te-control')

    const swatch = this.#keep(`${name}-swatch`, make('label', 'te-swatch'))
    const picker = this.#keep(`${name}-picker`, make('input'))
    picker.type = 'color'
    picker.setAttribute('aria-label', label)
    picker.addEventListener('input', () => write(picker.value))
    swatch.append(picker)

    const hex = this.#keep(`${name}-hex`, make('input', 'te-input te-hex'))
    hex.type = 'text'
    hex.maxLength = 7
    hex.spellcheck = false
    hex.autocomplete = 'off'
    hex.setAttribute('autocapitalize', 'off')
    hex.setAttribute('aria-label', label)
    hex.placeholder = fallback
    hex.addEventListener('input', () => {
      const value = hex.value.trim()
      if (!value) { hex.removeAttribute('aria-invalid'); return }
      const parsed = parseHexColour(value)
      if (parsed && /^#?[0-9a-f]{6}$/i.test(value)) { hex.removeAttribute('aria-invalid'); write(parsed) }
    })
    hex.addEventListener('blur', () => {
      const value = hex.value.trim()
      const parsed = parseHexColour(value)
      if (!value) write('')
      else if (parsed) write(parsed)
      else hex.setAttribute('aria-invalid', 'true')
      this.#syncFields()
    })

    const clear = this.#keep(`${name}-clear`, make('button', 'te-chip', clearLabel))
    clear.type = 'button'
    clear.addEventListener('click', () => write(''))

    control.append(swatch, hex, clear)
    row.append(text, control)
    return row
  }

  #buildLink(): HTMLElement {
    const service = this.#service!
    const section = make('section', 'te-section')
    section.append(make('h4', 'te-section-head', t('editor.link', 'link')))
    const input = this.#keep('link', make('input', 'te-input te-link'))
    input.type = 'url'
    input.name = 'tile-link'
    input.inputMode = 'url'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('enterkeyhint', 'done')
    input.setAttribute('aria-label', t('editor.link', 'link'))
    input.placeholder = t('editor.link-placeholder', 'https://...')
    input.addEventListener('input', () => {
      if (this.#verdict) { this.#verdict = null; this.#renderVerdict() }
      service.setLink(input.value.trim())
    })
    input.addEventListener('blur', () => void this.#checkLink())
    const verdict = this.#keep('verdict', make('p', 'te-hint'))
    verdict.hidden = true
    verdict.setAttribute('role', 'status')
    section.append(input, verdict)
    return section
  }

  #buildQuestions(): HTMLElement {
    const section = this.#keep('questions', make('section', 'te-section'))
    section.hidden = true
    return section
  }

  #buildActions(): HTMLElement {
    const bar = make('footer', 'te-actions')
    const cancel = this.#keep('cancel', make('button', 'te-btn', t('editor.cancel', 'cancel')))
    cancel.type = 'button'
    cancel.dataset['action'] = 'cancel'
    cancel.addEventListener('click', () => this.#cancel())
    const save = this.#keep('primary', make('button', 'te-btn te-btn-primary'))
    save.type = 'button'
    save.dataset['action'] = 'save'
    save.title = 'Ctrl+Enter'
    save.addEventListener('click', () => this.#save())

    // Asked when another tile is clicked while this one has unsaved changes —
    // in place of Cancel and Save, where the eye already goes to finish.
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
    choices.append(
      choice('leave-stay', 'editor.leave-stay', 'keep editing', false, () => this.#setLeaving('')),
      choice('leave-discard', 'editor.leave-discard', 'don’t save', false, () => void this.#switchTo(this.#leaving, false)),
      choice('leave-save', 'editor.leave-save', 'save and open', true, () => void this.#switchTo(this.#leaving, true)),
    )
    leave.append(question, choices)

    bar.append(leave, cancel, save)
    return bar
  }

  // ── syncing from the services ─────────────────────────────────

  #syncFields(): void {
    const service = this.#service
    if (!service || !this.#panel) return

    const cell = service.cell
    const title = this.#ref<HTMLInputElement>('title')
    if (title) title.placeholder = cell
    if (this.#titleFor !== `${cell}|${this.#segments().join('/')}`) this.#loadTitle()

    this.#syncColour('border', service.borderColor, DEFAULT_BORDER)
    this.#syncColour('background', service.backgroundColor, null)

    const link = this.#ref<HTMLInputElement>('link')
    if (link && document.activeElement !== link && link.value.trim() !== service.link) link.value = service.link

    const portal = this.#ref('portal')
    if (portal) portal.hidden = !this.#throughPortal()

    const error = this.#ref('error')
    if (error) {
      error.hidden = !service.error
      error.textContent = service.error
    }

    this.#syncLook()
    this.#syncPicture()
    this.#syncActions()
    this.#emitPreview()
  }

  /** `fallback` is what an unset value MEANS (the rim's default gold), shown
   *  in the swatch but never written; null when unset means "nothing". */
  #syncColour(name: string, value: string, fallback: string | null): void {
    const hex = this.#ref<HTMLInputElement>(`${name}-hex`)
    const picker = this.#ref<HTMLInputElement>(`${name}-picker`)
    const swatch = this.#ref(`${name}-swatch`)
    const clear = this.#ref(`${name}-clear`)
    const parsed = parseHexColour(value)
    if (hex && document.activeElement !== hex) { hex.value = value; hex.removeAttribute('aria-invalid') }
    if (picker && document.activeElement !== picker) picker.value = parsed ?? fallback ?? '#000000'
    swatch?.style.setProperty('--te-swatch', parsed ?? fallback ?? 'transparent')
    if (swatch) swatch.dataset['unset'] = String(!parsed)
    if (clear) clear.hidden = !value
  }

  #syncLook(): void {
    const service = this.#service
    if (!service || !this.#stage) return
    const name = this.#ref<HTMLInputElement>('title')?.value.trim() || service.cell
    this.#stage.setLook({
      border: parseHexColour(service.borderColor) ?? DEFAULT_BORDER,
      name,
      showName: !service.hideText,
    })
  }

  #syncPicture(): void {
    const model = this.#model
    const service = this.#service
    if (!model || !service || !this.#panel) return
    const has = model.hasImage
    const natural = model.natural

    const empty = this.#ref('empty')
    if (empty) empty.hidden = has

    for (const btn of this.#ref('mode')?.querySelectorAll<HTMLButtonElement>('button') ?? []) {
      btn.setAttribute('aria-checked', String(btn.dataset['mode'] === model.mode))
      btn.disabled = !has
    }
    const slider = this.#ref<HTMLInputElement>('zoom')
    const readout = this.#ref('readout')
    if (slider && readout) {
      if (has && natural) {
        const framing = model.framingFor()
        const limits = scaleLimits(natural, model.boxFor(), model.mode)
        if (document.activeElement !== slider) slider.value = String(Math.round(sliderOf(framing.scale, limits) * SLIDER_STEPS))
        readout.textContent = `${zoomPercent(framing.scale, natural, model.boxFor())}%`
      } else {
        slider.value = '0'
        readout.textContent = ''
      }
      slider.disabled = !has
    }
    for (const name of ['zoom-in', 'zoom-out', 'reset', 'remove', 'linked']) {
      const btn = this.#ref<HTMLButtonElement>(name)
      if (btn) btn.disabled = !has
    }
    const linked = this.#ref<HTMLButtonElement>('linked')
    if (linked) {
      linked.setAttribute('aria-pressed', String(model.linked))
      const g = linked.querySelector('.mat-sym')
      if (g) g.textContent = model.linked ? 'link' : 'link_off'
      const label = model.linked
        ? t('editor.frame-apart', 'frame each shape apart')
        : t('editor.frame-together', 'frame both shapes together')
      linked.setAttribute('aria-label', label)
      linked.title = label
    }
    for (const orientation of ['point-top', 'flat-top'] as const) {
      this.#ref(`twin-${orientation}`)?.setAttribute('aria-pressed', String(model.orientation === orientation))
    }

    const toggle = this.#ref<HTMLButtonElement>('show-name')
    const state = this.#ref('show-name-state')
    if (toggle && state) {
      const shows = !service.hideText || !has
      toggle.setAttribute('aria-checked', String(shows))
      toggle.disabled = !has
      state.textContent = has
        ? (shows ? t('editor.name-shown', 'shown over the picture') : t('editor.name-hidden', 'hidden over the picture'))
        : t('editor.show-name-hint', 'always shown without a picture')
    }

    const fill = this.#ref('background-row')
    if (fill) fill.hidden = !(has && model.mode === 'fit')

    const props = service.properties as { small?: { image?: unknown }; flat?: { small?: { image?: unknown } } }
    const hasCapture = typeof props.small?.image === 'string' || typeof props.flat?.small?.image === 'string'
    const noOriginal = this.#ref('no-original')
    if (noOriginal) noOriginal.hidden = has || model.loading || model.removed || !hasCapture

    const camera = this.#ref('camera')
    const emptyCamera = this.#ref('empty-camera')
    const cameraShown = this.#cameraAvailable()
    if (camera) camera.hidden = !cameraShown
    if (emptyCamera) emptyCamera.hidden = !cameraShown
  }

  #syncActions(): void {
    const service = this.#service
    const model = this.#model
    const primary = this.#ref<HTMLButtonElement>('primary')
    if (!service || !model || !primary) return
    const dirty = service.dirty || model.pictureChanged || model.framingChanged
    primary.disabled = service.saving
    primary.replaceChildren(document.createTextNode(
      service.saving ? t('editor.saving', 'saving…') : dirty ? t('editor.save', 'save') : t('editor.done', 'done'),
    ))
    this.#panel?.setAttribute('aria-busy', String(service.saving))
  }

  // ── the name ──────────────────────────────────────────────────

  #segments(): string[] {
    const service = this.#service
    if (!service) return []
    if (service.targetSegments.length > 0) return [...service.targetSegments]
    const here = (ioc<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    return service.cell ? [...here, service.cell] : []
  }

  #throughPortal(): boolean {
    const service = this.#service
    if (!service || service.targetSegments.length === 0) return false
    const here = (ioc<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    return service.targetSegments.join('/') !== [...here, service.cell].join('/')
  }

  #loadTitle(): void {
    const service = this.#service
    const segments = this.#segments()
    const token = `${service?.cell ?? ''}|${segments.join('/')}`
    this.#titleFor = token
    this.#storedTitle = ''
    const title = this.#ref<HTMLInputElement>('title')
    if (title && document.activeElement !== title) title.value = ''
    const decorations = ioc<DecorationsShape>('@diamondcoreprocessor.com/DecorationService')
    if (!decorations?.titleOf || segments.length === 0) { this.#syncLook(); return }
    void decorations.titleOf(segments).then(text => {
      if (this.#titleFor !== token) return
      this.#storedTitle = text ?? ''
      const field = this.#ref<HTMLInputElement>('title')
      if (field && document.activeElement !== field && !field.value) field.value = this.#storedTitle
      this.#syncLook()
    }).catch(() => { /* no title is a normal state */ })
  }

  #commitTitle(): void {
    const title = this.#ref<HTMLInputElement>('title')
    if (!title) return
    const text = title.value.trim()
    if (text === this.#storedTitle) return
    const decorations = ioc<DecorationsShape>('@diamondcoreprocessor.com/DecorationService')
    const segments = this.#segments()
    if (!decorations?.setTitle || segments.length === 0) return
    const token = this.#titleFor
    void decorations.setTitle(segments, text).then(outcome => {
      if (this.#titleFor !== token) return
      if (outcome === 'duplicate') {
        title.setAttribute('aria-invalid', 'true')
        this.#setTitleHint(t('editor.name-taken', 'Another tile here already reads that way.'))
        return
      }
      this.#storedTitle = text
      title.removeAttribute('aria-invalid')
      this.#setTitleHint('')
    }).catch((err: unknown) => console.warn('[tile-editor] title failed', err))
  }

  #setTitleHint(text: string): void {
    const hint = this.#ref('title-hint')
    if (!hint) return
    hint.textContent = text
    hint.hidden = !text
  }

  // ── the picture ───────────────────────────────────────────────

  #afterGesture(): void {
    this.#syncPicture()
    this.#syncActions()
    this.#scheduleTwins()
  }

  #zoomTo(t01: number): void {
    const model = this.#model
    const natural = model?.natural
    if (!model || !natural) return
    const limits = scaleLimits(natural, model.boxFor(), model.mode)
    const current = model.framingFor()
    model.setFraming(zoomToward(current, scaleOfSlider(t01, limits), { x: 0, y: 0 }, natural, model.boxFor(), model.mode))
  }

  #zoomBy(factor: number): void {
    const model = this.#model
    const natural = model?.natural
    if (!model || !natural) return
    const current = model.framingFor()
    model.setFraming(zoomToward(current, current.scale * factor, { x: 0, y: 0 }, natural, model.boxFor(), model.mode))
    this.#afterGesture()
  }

  /** The twins show the bytes a save would write — captured from the original
   *  a moment after a gesture settles. */
  #scheduleTwins(): void {
    if (this.#twinTimer) clearTimeout(this.#twinTimer)
    this.#twinTimer = 0
    const model = this.#model
    if (!this.#panel || !model) return
    if (!model.hasImage) {
      this.#twinGeneration++
      for (const o of ['point-top', 'flat-top'] as const) this.#setTwin(o, '')
      this.#previewPictures = {}
      this.#emitPreview()
      return
    }
    if (this.#stage?.gesturing) return
    this.#twinTimer = window.setTimeout(() => { this.#twinTimer = 0; void this.#renderTwins() }, 160)
  }

  async #renderTwins(): Promise<void> {
    const model = this.#model
    const service = this.#service
    if (!model?.hasImage || !service) return
    const generation = ++this.#twinGeneration
    const fill = parseHexColour(service.backgroundColor)
    const pictures: { point?: { sig: string; blob: Blob }; flat?: { sig: string; blob: Blob } } = {}
    for (const orientation of ['point-top', 'flat-top'] as const) {
      try {
        const blob = await model.capture(orientation, fill)
        if (generation !== this.#twinGeneration || !this.#panel) return
        this.#setTwin(orientation, URL.createObjectURL(blob))
        // Signed like the store signs it: the saved tile will ask the atlas for
        // exactly this signature, and find it already there.
        const sig = await SignatureService.sign(await blob.arrayBuffer())
        if (generation !== this.#twinGeneration || !this.#panel) return
        pictures[orientation === 'point-top' ? 'point' : 'flat'] = { sig, blob }
      } catch { return }
    }
    this.#previewPictures = pictures
    this.#emitPreview()
  }

  /** Paint the edit onto its tile in the hive. Nothing is written: the
   *  renderer draws it over the tile's stored look until the editor closes
   *  (see "LIVE PREVIEW" in presentation/tiles/show-cell.drone.ts). */
  #emitPreview(): void {
    const service = this.#service
    const model = this.#model
    if (!this.#panel || !service || !model || service.mode !== 'editing' || !service.cell) return
    if (this.#switchingTo) return
    const page =(ioc<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean).join('/')
    const picturePending = model.hasImage && !this.#previewPictures.point && !this.#previewPictures.flat
    this.#previewLabel = service.cell
    EffectBus.emitTransient('tile:preview', {
      label: service.cell,
      page,
      // Until the first capture lands, leave the tile's stored picture up.
      point: picturePending ? null : this.#previewPictures.point ?? null,
      flat: picturePending ? null : this.#previewPictures.flat ?? null,
      removed: model.removed,
      border: parseHexColour(service.borderColor),
      hideText: service.hideText,
    })
  }

  #endPreview(): void {
    if (!this.#previewLabel) return
    EffectBus.emitTransient('tile:preview', { label: this.#previewLabel, clear: true })
    this.#previewLabel = ''
    this.#previewPictures = {}
  }

  #setTwin(orientation: HexOrientation, url: string): void {
    const previous = this.#twinUrls[orientation]
    if (previous) URL.revokeObjectURL(previous)
    this.#twinUrls[orientation] = url || undefined
    const hex = this.#ref(`twin-${orientation}`)?.querySelector('.te-twin-hex') as HTMLElement | null
    if (hex) hex.style.backgroundImage = url ? `url("${url}")` : ''
  }

  #take(blob: Blob): void {
    this.#service?.setLargeBlob(blob)
    void this.#model?.loadImage(blob)
    this.#stage?.el.focus({ preventScroll: true })
  }

  #pickFile(capture: boolean): void {
    const panel = this.#panel
    if (!panel) return
    const input = make('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (capture) input.setAttribute('capture', 'environment')
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      input.remove()
      if (file && file.type.startsWith('image/')) this.#take(file)
      else if (file) this.#take(file)
    })
    panel.appendChild(input)
    input.click()
  }

  #onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (this.#stage) this.#stage.el.dataset['drop'] = 'true'
  }

  #onDragLeave = (): void => {
    if (this.#stage) delete this.#stage.el.dataset['drop']
  }

  #onDrop = (e: DragEvent): void => {
    this.#onDragLeave()
    const files = e.dataTransfer?.files
    if (!files?.length) return
    const image = [...files].find(file => file.type.startsWith('image/'))
    if (!image) return
    e.preventDefault()
    e.stopPropagation()
    this.#take(image)
  }

  // ── the camera ────────────────────────────────────────────────

  #cameraAvailable(): boolean {
    if (this.#surface === 'page' || mobileModeActive() || isTouch()) return true
    return this.#hasCamera
  }

  #probeCamera(): void {
    const devices = navigator.mediaDevices
    if (!window.isSecureContext || !devices?.enumerateDevices || !devices.getUserMedia) return
    void devices.enumerateDevices().then(list => {
      this.#hasCamera = list.some(device => device.kind === 'videoinput')
      this.#syncPicture()
    }).catch(() => { /* no camera to offer */ })
  }

  #openCamera(): void {
    // A phone's own camera app: no permission prompt, works over plain http on
    // a LAN, and returns a real photo.
    if (this.#surface === 'page' || mobileModeActive() || isTouch()) { this.#pickFile(true); return }
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
  }

  // ── the link ──────────────────────────────────────────────────

  async #checkLink(): Promise<void> {
    const service = this.#service
    const input = this.#ref<HTMLInputElement>('link')
    if (!service || !input) return
    const value = input.value.trim()
    this.#verdict = null
    this.#renderVerdict()
    if (!value) { service.setLink(''); return }
    const safety = ioc<LinkSafetyShape>('@diamondcoreprocessor.com/LinkSafetyService')
    if (!safety) { service.setLink(value); return }
    const target = this.#target
    try {
      const verdict = await safety.check(value)
      // Moved to another tile while the check ran: the verdict is not its.
      if (this.#target !== target) return
      if (input.value.trim() !== value) return
      if (verdict.decision === 'deny') {
        this.#verdict = { tone: 'alert', reason: verdict.reason }
        service.setLink('')
        input.value = ''
      } else {
        if (verdict.decision === 'warn') this.#verdict = { tone: 'warn', reason: verdict.reason }
        service.setLink(value)
      }
    } catch {
      if (this.#target !== target) return
      service.setLink(value)
    }
    this.#renderVerdict()
  }

  #renderVerdict(): void {
    const node = this.#ref('verdict')
    const input = this.#ref('link')
    if (!node) return
    node.hidden = !this.#verdict
    node.textContent = this.#verdict?.reason ?? ''
    if (this.#verdict) node.dataset['tone'] = this.#verdict.tone
    if (this.#verdict?.tone === 'alert') input?.setAttribute('aria-invalid', 'true')
    else input?.removeAttribute('aria-invalid')
  }

  // ── questions ─────────────────────────────────────────────────

  #renderQuestions(): void {
    const section = this.#ref('questions')
    const service = this.#service
    if (!section || !service) return
    const notes = ioc<NotesShape>('@diamondcoreprocessor.com/NotesService')?.notesFor?.(service.cell) ?? []
    const questions = new Map<string, string>()
    const answers = new Map<string, string>()
    for (const note of notes) {
      const text = String(note.text ?? '').trim()
      const q = Q_NOTE.exec(text)
      if (q) { questions.set(note.id, q[1].trim()); continue }
      const a = A_NOTE.exec(text)
      if (a) answers.set(a[1], a[2].trim())
    }
    section.replaceChildren()
    section.hidden = questions.size === 0
    if (questions.size === 0) return
    section.append(make('h4', 'te-section-head', t('editor.qa.title', 'questions')))
    for (const [qId, question] of questions) {
      const item = make('div', 'te-question')
      item.append(make('p', '', question))
      const answer = answers.get(qId)
      if (answer) {
        item.append(make('p', 'te-answer', answer))
      } else {
        const field = make('textarea', 'te-input te-textarea')
        field.rows = 2
        field.placeholder = t('editor.qa.answer-placeholder', 'type your answer…')
        field.value = this.#answerDrafts.get(qId) ?? ''
        field.addEventListener('input', () => this.#answerDrafts.set(qId, field.value))
        const row = make('div', 'te-row')
        const reply = make('button', 'te-btn', t('editor.qa.reply', 'reply'))
        reply.type = 'button'
        reply.addEventListener('click', () => {
          const text = field.value.trim()
          if (!text) return
          EffectBus.emit('note:commit', { cellLabel: service.cell, text: `[A:${qId}] ${text}` })
          this.#answerDrafts.delete(qId)
          window.setTimeout(() => this.#renderQuestions(), 300)
        })
        row.append(reply)
        item.append(field, row)
      }
      section.append(item)
    }
  }

  // ── a discarded draft ─────────────────────────────────────────

  #renderRestore(): void {
    const service = this.#service
    const strip = this.#ref('restore')
    if (!service || !strip) return
    strip.hidden = !service.stashFor(service.cell, service.targetSegments)
  }

  async #restore(): Promise<void> {
    const service = this.#service
    const model = this.#model
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
      model.setFraming(picture.point, 'point-top')
      if (!picture.linked) model.setFraming(picture.flat, 'flat-top')
    }
    service.dropStash()
    const strip = this.#ref('restore')
    if (strip) strip.hidden = true
    this.#afterGesture()
  }

  // ── keys and focus ────────────────────────────────────────────

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229) return
    const target = e.target as HTMLElement
    if (e.key === 'Escape') {
      // The hive's keymap hears Escape first (window, capture — Escape pierces
      // its suppression) and the escape cascade has already unwound one level
      // of this editor. A second unwind here would take the next level with it:
      // a dismissed question, or a name let go of, would close the editor.
      if (e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      if (!this.dismissInner()) this.#cancel()
      return
    }
    if (e.key !== 'Enter') return
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.#save(); return }
    if (target === this.#stage?.el) { e.preventDefault(); this.#save(); return }
    if (target instanceof HTMLInputElement && !['color', 'range', 'file'].includes(target.type)) {
      e.preventDefault()
      target.blur()
    }
  }

  /** While the focus is in the editor the hive's keyboard shortcuts stand
   *  down — Enter must not also paste, an arrow must not also walk the hive.
   *  The editor answers Escape itself while it holds the keys. */
  #onFocusIn = (): void => {
    if (this.#suppressed) return
    this.#suppressed = true
    EffectBus.emit('keymap:suppress', { reason: 'tile-editor' })
  }

  #onFocusOut = (e: FocusEvent): void => {
    const next = e.relatedTarget as Node | null
    if (next && this.#panel?.contains(next)) return
    this.#unsuppress()
  }

  #unsuppress(): void {
    if (!this.#suppressed) return
    this.#suppressed = false
    EffectBus.emit('keymap:unsuppress', { reason: 'tile-editor' })
  }

  // ── the phone keyboard ────────────────────────────────────────

  #watchKeyboard(): void {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = (): void => {
      const panel = this.#panel
      if (!panel) return
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      panel.style.setProperty('--te-kb', `${covered}px`)
      panel.dataset['keyboard'] = String(covered > 80)
      const active = document.activeElement
      if (covered > 80 && active instanceof HTMLElement && panel.contains(active)) {
        active.scrollIntoView({ block: 'nearest' })
      }
    }
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    this.#openCleanup.push(() => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    })
    update()
  }

  // ── the edge this window reserves ─────────────────────────────
  //
  // What `hcDockInset` does for the Angular windows, which a module cannot
  // import: say how much of the right edge the dock takes, so the hive's
  // canvas shrinks to the rest and re-fits beside it. A timer races the frame
  // (a document that is not rendering still reserves), and a box that spans
  // the viewport reserves nothing.

  #reserve(): void {
    const panel = this.#panel
    if (!panel) return
    if (typeof ResizeObserver !== 'undefined') {
      this.#insetObserver = new ResizeObserver(this.#scheduleInset)
      this.#insetObserver.observe(panel)
    }
    window.addEventListener('resize', this.#scheduleInset)
    this.#offPoll = EffectBus.on('viewport:inset-poll', this.#scheduleInset)
    this.#scheduleInset()
  }

  readonly #scheduleInset = (): void => {
    if (this.#insetFrame || this.#insetTimer) return
    this.#insetFrame = requestAnimationFrame(this.#measureInset)
    this.#insetTimer = window.setTimeout(this.#measureInset, 60)
  }

  readonly #measureInset = (): void => {
    if (this.#insetFrame) { cancelAnimationFrame(this.#insetFrame); this.#insetFrame = 0 }
    if (this.#insetTimer) { clearTimeout(this.#insetTimer); this.#insetTimer = 0 }
    const rect = this.#panel?.getBoundingClientRect()
    const spans = !rect || rect.width <= 0 || (rect.left <= 1 && rect.right >= window.innerWidth - 1)
    const size = !rect || spans || this.#surface !== 'dock' ? 0 : Math.max(0, Math.round(window.innerWidth - rect.left))
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'right', size })
  }

  #release(): void {
    const wasReserving = this.#insetObserver !== null || this.#offPoll !== null
    this.#insetObserver?.disconnect()
    this.#insetObserver = null
    window.removeEventListener('resize', this.#scheduleInset)
    this.#offPoll?.()
    this.#offPoll = null
    if (this.#insetFrame) cancelAnimationFrame(this.#insetFrame)
    if (this.#insetTimer) clearTimeout(this.#insetTimer)
    this.#insetFrame = 0
    this.#insetTimer = 0
    if (wasReserving) EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'right', size: 0 })
  }
}

window.ioc.register(OWNER, facade)

// Contribute the surface the doctrine way: define the element, then add it to
// the registry — never a tag in either app.html, never an Angular class.
;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void; all?(): { name: string; component?: unknown }[] }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    // An older shell still carrying the Angular editor keeps it: two
    // presenters for one session would fight over the same picture.
    if (registry.all?.().some(surface => surface.name === TILE_EDITOR_SURFACE && surface.component)) return
    if (!customElements.get(TILE_EDITOR_SURFACE)) customElements.define(TILE_EDITOR_SURFACE, TileEditorElement)
    try {
      registry.add({ name: TILE_EDITOR_SURFACE, owner: OWNER, element: TILE_EDITOR_SURFACE, order: 220 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
