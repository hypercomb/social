// comfy-desk/desk/comfy-desk.view.ts
//
// THE COMFY DESK: ONE FULL-SCREEN DESK, a picture in the middle. The same box as
// the tile editor: its own slim header, a list on the left, and a labelled
// drawing. Here the drawing is the picture being made and the list is what has
// been made. Generate fills the shelf and lands nowhere. A picture goes on the
// screen later, from its own card, by its signature.
//
// This file is the piecing together and nothing else. It holds the session and
// what is chosen right now; the data side is the ComfyDrone (`comfy:render` out,
// intents in), and every word, length and record belongs to a part (../parts.ts).

import {
  EffectBus,
  I18N_IOC_KEY,
  attachDockedPanel,
  type DockedPanel,
  type I18nProvider,
  type WindowSession,
} from '@hypercomb/core'
import type { ComfyRenderPayload } from '../../comfy/comfy.drone.js'
import { installDiagramStyles } from '../../editor/diagram/diagram.styles.js'
import { GAP, MARGIN } from '../../editor/diagram/layout.js'
import { assetsPart } from '../assets/assets.js'
import { calloutsPart, TAB_WIDTH } from '../callouts/callouts.js'
import { chunksPart } from '../chunks/chunks.js'
import { directionPart } from '../direction/direction.js'
import { formPart } from '../form/form.js'
import { fitBox, framePart } from '../frame/frame.js'
import { ideasPart } from '../ideas/ideas.js'
import { libraryPart } from '../library/library.js'
import { machinePart } from '../machine/machine.js'
import { negativePart } from '../negative/negative.js'
import { knobsPart } from '../knobs/knobs.js'
import { placePart } from '../place/place.js'
import { promptPart } from '../prompt/prompt.js'
import { recipePart } from '../recipe/recipe.js'
import { shelfPart } from '../shelf/shelf.js'
import { workflowPart } from '../workflow/workflow.js'
import {
  fillParts, make,
  type Asset, type CalloutsHandle, type CardContext, type CardHandle, type CardPart, type ChunksHandle, type DeskParts,
  type DeskState, type FormHandle, type FrameHandle, type FrameShown, type Idea, type IdeaAction, type IdeasHandle,
  type Lit, type RecipeRow, type Say, type ShelfHandle,
} from '../parts.js'
import { installComfyDeskStyles } from './comfy-desk.styles.js'

const DESK = 'comfy-desk'
const KEYS = {
  modes: '@diamondcoreprocessor.com/ModeRegistry',
  back: '@diamondcoreprocessor.com/BackGesture',
  gate: '@diamondcoreprocessor.com/InputGate',
  rail: '@diamondcoreprocessor.com/AgentTilesRailFactory',
  decorations: '@diamondcoreprocessor.com/DecorationService',
} as const

/** The concealment scope: this list's rows and no other's. */
const ASSET_SCOPE = 'comfy-asset'
/** The drawing never grows past this on a side: a larger desk gets margin. */
const MAX_STAGE = 820
const MIN_STAGE = 260
const NARROW_STAGE = 360
/** Room kept above the picture for the tag, and below it for the size mark. */
const KEEP_EM = 3.2
const NARROW_EM = 56.25

type ModesShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void; releaseOwner?(owner: string): void }
type BackShape = { register(entry: { owner: string; back: () => void; active?: () => boolean }): () => void }
type GateShape = { lock(reason: string): void; unlock(reason: string): void }
type ReadingShape = { readingAt?(segments: readonly string[], locale?: string): string }
type RailRow = { readonly name: string; readonly segments: readonly string[] }
type RailShape = {
  mount(host: HTMLElement): void
  dispose(): void
  refresh(): void
  onSubjectChanged: (subject: { name: string; path: readonly string[] } | null) => void
}
type RailFactoryShape = { create(profile: Record<string, unknown>): RailShape }
type Hidden = { sig: string; scope: string; label: string }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const t: Say = (key, fallback, params) => {
  const fill = (text: string): string =>
    params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : fill(fallback)
  } catch { return fill(fallback) }
}

const OWN: DeskParts = {
  form: formPart,
  assets: assetsPart,
  recipe: recipePart,
  frame: framePart,
  callouts: calloutsPart,
  shelf: shelfPart,
  prompt: promptPart,
  negative: negativePart,
  knobs: knobsPart,
  workflow: workflowPart,
  machine: machinePart,
  library: libraryPart,
  place: placePart,
  chunks: chunksPart,
  ideas: ideasPart,
  direction: directionPart,
}

/** The prompt grows a chunk at a time while the ideas are open. */
interface Suggesting {
  chunks: string[]
  ideas: readonly Idea[]
  source: 'agents' | 'words' | ''
  open: string | null
  reading: string | null
  busy: boolean
  abort: AbortController
}

const cardWord = (id: string): keyof DeskParts | null =>
  id === 'prompt' || id === 'negative' || id === 'knobs' || id === 'workflow'
    || id === 'machine' || id === 'library' || id === 'place' ? id : null

export class ComfyDeskElement extends HTMLElement {

  #parts: DeskParts = OWN
  #form: FormHandle | null = null
  #payload: ComfyRenderPayload | null = null
  #off: (() => void)[] = []

  #panel: HTMLElement | null = null
  #vp: HTMLElement | null = null
  #dock: DockedPanel | null = null
  #modes: ModesShape | null = null
  #releaseBack: (() => void) | null = null
  #openCleanup: (() => void)[] = []

  #frame: FrameHandle | null = null
  #callouts: CalloutsHandle | null = null
  #shelf: ShelfHandle | null = null
  #cards = new Map<string, { part: CardPart; card: CardHandle }>()
  #refs = new Map<string, HTMLElement>()

  #assets: readonly Asset[] = []
  #hidden: readonly Hidden[] = []
  #asset: Asset | null = null
  #url: string | null = null
  #size = { width: 0, height: 0 }
  #lastRun = ''
  #jobWas = ''
  #looking = false
  #choosing: ((tile: { name: string; parent: readonly string[] }) => void) | null = null
  #rail: RailShape | null = null
  #parked = false
  #frameId = 0
  #suggesting: Suggesting | null = null
  #chunksUi: ChunksHandle | null = null
  #ideasUi: IdeasHandle | null = null

  readonly #session: WindowSession = {
    park: () => { this.#parked = true; EffectBus.emit('comfy:close', {}) },
    unpark: () => { if (this.#parked) { this.#parked = false; EffectBus.emit('comfy:reopen', {}) } },
    dismiss: () => this.dismissInner(),
    close: () => this.#close(),
  }

  connectedCallback(): void {
    installComfyDeskStyles()
    installDiagramStyles()
    this.#parts = fillParts(OWN, key => ioc(key))
    this.#form = this.#parts.form.create((effect, payload) => EffectBus.emit(effect, payload ?? {}))
    // The render replays its last value, so an open that came first is heard here.
    this.#off.push(
      EffectBus.on<ComfyRenderPayload>('comfy:render', payload => { if (payload) this.#render(payload) }),
      EffectBus.on<{ items?: Hidden[] }>('hidden:render', payload => {
        this.#hidden = (payload?.items ?? []).filter(item => item.scope === ASSET_SCOPE)
        this.#paintShelf()
      }),
    )
  }

  disconnectedCallback(): void {
    if (this.#panel) this.#teardown()
    for (const off of this.#off.splice(0)) off()
    this.#form?.dispose()
    this.#form = null
  }

  /** Unwind one level: what is in hand first, then the desk. */
  dismissInner(): boolean {
    if (this.#looking) { this.#look(false); return true }
    if (this.#choosing) { this.#choose(null); return true }
    if (this.#suggesting?.open) { this.#suggesting.open = null; this.#paintIdeas(); return true }
    if (this.#suggesting) { this.#stopSuggesting(); return true }
    return this.#callouts?.dismiss() ?? false
  }

  // ── the render ────────────────────────────────────────────────

  #render(payload: ComfyRenderPayload): void {
    this.#payload = payload
    this.#form?.read(payload)
    if (payload.open && !this.#panel) this.#build()
    else if (!payload.open && this.#panel) this.#teardown()
    if (!this.#panel) return

    // A placement finishes a job too, and two in a row are both news.
    const job = `${payload.job?.state ?? 'idle'} ${payload.job?.message ?? ''}`
    const newest = payload.results?.[0]?.sig ?? ''
    const finished = job !== this.#jobWas && payload.job?.state === 'done'
    this.#jobWas = job
    if (finished) void this.#refreshAssets(newest && newest !== this.#lastRun ? newest : '')
    this.#lastRun = newest || this.#lastRun
    this.#paint()
  }

  async #refreshAssets(choose = ''): Promise<void> {
    const assets = await this.#parts.assets.list()
    if (!this.#panel) return
    this.#assets = assets
    if (choose) await this.#show(assets.find(asset => asset.sig === choose) ?? null)
    else if (this.#asset) this.#asset = assets.find(asset => asset.sig === this.#asset!.sig) ?? this.#asset
    this.#paintShelf()
    this.#paint()
  }

  // ── the session ───────────────────────────────────────────────

  #build(): void {
    const parts = this.#parts
    const panel = make('div', 'cd-panel')
    panel.tabIndex = -1
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', t('comfy.title', 'ComfyUI'))
    panel.dataset['hcSheet'] = 'full'
    this.#panel = panel

    const shelf = parts.shelf.create({
      onPick: asset => { void this.#show(asset); this.#paintShelf(); this.#paint() },
      onHide: asset => this.#hide(asset),
      onReveal: sig => EffectBus.emit('hidden:reveal', { sig }),
      onKeep: index => EffectBus.emit('comfy:keep', { index }),
      urlOf: sig => parts.assets.url(sig),
      nameOf: asset => parts.assets.nameOf(asset),
    }, t)
    this.#shelf = shelf
    const rail = make('div', 'cd-rail')
    this.#refs.set('rail', rail)
    const list = make('div', 'cd-list')
    list.append(shelf.el, rail)

    const frame = parts.frame.create({
      onEnter: part => this.#callouts?.enter(part),
      onLeave: part => this.#callouts?.leave(part),
      onPick: part => this.#callouts?.open(part),
      onLook: () => this.#look(true),
      onSize: (width, height) => {
        this.#form?.setNumber('width', String(width))
        this.#form?.setNumber('height', String(height))
        this.#paint()
      },
    }, t)
    this.#frame = frame
    const chunks = parts.chunks.create({ onRemove: index => this.#removeChunk(index) }, t)
    chunks.el.hidden = true
    this.#chunksUi = chunks
    const ideas = parts.ideas.create({
      onHover: id => { if (this.#suggesting && this.#suggesting.reading !== id) { this.#suggesting.reading = id; this.#paintIdeas() } },
      onOpen: id => { if (this.#suggesting) { this.#suggesting.open = id; this.#paintIdeas() } },
      onAct: (id, action) => { void this.#act(id, action) },
    }, t)
    ideas.el.hidden = true
    this.#ideasUi = ideas
    const callouts = parts.callouts.create({
      onLit: lit => this.#light(lit),
      onOpen: id => { if (id) this.#cards.get(id)?.card.focus?.() },
    })
    this.#callouts = callouts

    const tag = make('div', 'cd-tag')
    tag.setAttribute('aria-live', 'polite')
    this.#refs.set('tag', tag)
    const notices = make('div', 'cd-notices')
    this.#refs.set('notices', notices)
    const vp = make('div', 'cd-vp')
    vp.setAttribute('data-consumes-wheel', '')
    vp.append(tag, notices, chunks.el, frame.el, callouts.el, ideas.el)
    this.#vp = vp

    const body = make('div', 'cd-body')
    body.append(list, vp)
    const live = make('div', 'cd-live')
    live.setAttribute('role', 'status')
    this.#refs.set('live', live)
    panel.append(this.#buildHeader(), body, live)
    this.appendChild(panel)

    this.#dock = attachDockedPanel(panel, {
      id: DESK,
      dockSide: 'right',
      dockExclusive: false,
      ownsSize: false,
      sizeOwner: { panelWidth: () => 400, setPanelWidth: () => undefined },
      defaultText: 1,
      launcherControlId: 'comfy',
      hcSession: this.#session,
      onClose: () => this.#close(),
    })

    this.#claimModes(panel)
    EffectBus.emit('keymap:suppress', { reason: DESK })
    ioc<GateShape>(KEYS.gate)?.lock(DESK)
    this.#releaseBack = ioc<BackShape>(KEYS.back)?.register({
      owner: DESK,
      active: () => this.#panel !== null,
      back: () => { if (!this.dismissInner()) this.#close() },
    }) ?? null

    // On the window and capturing: Escape here unwinds this desk, not the hive's.
    window.addEventListener('keydown', this.#onKeyDown, { capture: true })
    this.#openCleanup.push(() => window.removeEventListener('keydown', this.#onKeyDown, { capture: true }))
    // Escape unwinds the window the focus is inside, and takes everything when
    // it is inside none. A field that lets go hands the focus back to the desk.
    panel.addEventListener('focusout', event => {
      if (event.relatedTarget) return
      requestAnimationFrame(() => {
        if (this.#panel === panel && document.activeElement === document.body) panel.focus({ preventScroll: true })
      })
    })
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.#schedule())
      observer.observe(vp)
      this.#openCleanup.push(() => observer.disconnect())
    }

    this.#jobWas = `${this.#payload?.job?.state ?? 'idle'} ${this.#payload?.job?.message ?? ''}`
    void this.#refreshAssets()
    EffectBus.emit('hidden:refresh', {})
    this.#paintShelf()
    requestAnimationFrame(() => {
      if (this.#panel !== panel) return
      this.#schedule()
      panel.focus({ preventScroll: true })
    })
  }

  #buildHeader(): HTMLElement {
    // The header IS the actions row: its last child is the close button, which
    // is where the docked-panel chrome puts the text-size gear beside.
    const head = make('header', 'cd-head cd-actions')
    const reading = make('span', 'cd-reading', t('comfy.title', 'ComfyUI'))
    const address = make('span', 'cd-address')
    this.#refs.set('address', address)
    const state = make('span', 'cd-state')
    this.#refs.set('state', state)

    const suggest = make('button', 'cd-btn', t('comfy.suggest', 'Suggest'))
    suggest.type = 'button'
    suggest.title = t('comfy.suggest-hint', 'Ideas for where the prompt could go, as tiles')
    suggest.addEventListener('click', () => { if (this.#suggesting) this.#stopSuggesting(); else this.#startSuggesting() })
    this.#refs.set('suggest', suggest)

    const run = make('button', 'cd-btn cd-btn-primary', t('comfy.generate', 'Generate'))
    run.type = 'button'
    run.addEventListener('click', () => {
      const job = this.#payload?.job?.state
      if (job === 'queued' || job === 'running') EffectBus.emit('comfy:cancel', {})
      else if (this.#form) EffectBus.emit('comfy:generate', this.#form.params())
    })
    this.#refs.set('run', run)

    const close = make('button', 'cd-icon-btn close')
    close.type = 'button'
    close.setAttribute('aria-label', t('panel.close', 'close'))
    close.title = t('panel.close', 'close')
    const glyph = make('span', 'mat-sym', 'close')
    glyph.setAttribute('aria-hidden', 'true')
    close.append(glyph)
    close.addEventListener('click', () => this.#close())

    head.append(reading, address, make('span', 'cd-grow'), state, suggest, run, close)
    return head
  }

  #close(): void {
    this.#parked = false
    EffectBus.emit('comfy:close', {})
  }

  #teardown(): void {
    const attempt = (what: () => void): void => {
      try { what() } catch (error) { console.warn('[comfy-desk] teardown step failed', error) }
    }
    if (this.#frameId) cancelAnimationFrame(this.#frameId)
    this.#frameId = 0
    attempt(() => this.#form?.flush())
    attempt(() => this.#releaseModes())
    attempt(() => EffectBus.emit('keymap:unsuppress', { reason: DESK }))
    attempt(() => ioc<GateShape>(KEYS.gate)?.unlock(DESK))
    attempt(() => this.#releaseBack?.())
    this.#releaseBack = null
    for (const off of this.#openCleanup.splice(0)) attempt(() => off?.())
    attempt(() => this.#rail?.dispose())
    this.#rail = null
    attempt(() => this.#suggesting?.abort.abort())
    this.#suggesting = null
    attempt(() => this.#ideasUi?.dispose())
    this.#ideasUi = null
    this.#chunksUi = null
    attempt(() => this.#callouts?.dispose())
    attempt(() => this.#shelf?.dispose())
    attempt(() => this.#dock?.dispose?.())
    this.#dock = null
    this.#panel?.remove()
    this.#panel = this.#vp = null
    this.#frame = null
    this.#callouts = null
    this.#shelf = null
    this.#cards.clear()
    this.#refs.clear()
    this.#setUrl(null)
    this.#asset = null
    this.#looking = false
    this.#choosing = null
  }

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
    if (modes.releaseOwner) { modes.releaseOwner(DESK); return }
    modes.exit('view:active', DESK)
    modes.exit('view:keeps-controls', DESK)
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
    // The hive's keymap hears it first and unwinds one rung through the session.
    if (event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.target
    if (target instanceof HTMLElement && target.closest('input, textarea, select')) target.blur()
    else if (!this.dismissInner()) this.#close()
  }

  // ── what is on the stage ──────────────────────────────────────

  async #show(asset: Asset | null): Promise<void> {
    this.#asset = asset
    this.#look(false)
    const url = asset ? await this.#parts.assets.url(asset.sig) : null
    if (this.#asset !== asset) { if (url) URL.revokeObjectURL(url); return }
    if (url) {
      const image = new Image()
      image.src = url
      try {
        await image.decode()
        this.#size = { width: image.naturalWidth, height: image.naturalHeight }
      } catch { this.#size = { width: asset?.record.width ?? 0, height: asset?.record.height ?? 0 } }
      if (this.#asset !== asset) { URL.revokeObjectURL(url); return }
    }
    this.#setUrl(url)
    this.#paint()
  }

  #setUrl(url: string | null): void {
    if (this.#url) { try { URL.revokeObjectURL(this.#url) } catch { /* already gone */ } }
    this.#url = url
  }

  #hide(asset: Asset): void {
    EffectBus.emit('hidden:conceal', {
      sig: asset.sig,
      scope: ASSET_SCOPE,
      label: this.#parts.assets.nameOf(asset),
      from: 'comfy',
    })
    if (this.#asset?.sig === asset.sig) void this.#show(null)
  }

  #look(on: boolean): void {
    this.#looking = on && !!this.#url
    this.#refs.get('look')?.remove()
    this.#refs.delete('look')
    if (!this.#looking || !this.#vp || !this.#url) return
    const cover = make('div', 'cd-look')
    const image = make('img')
    image.src = this.#url
    image.alt = this.#asset ? this.#parts.assets.nameOf(this.#asset) : ''
    cover.append(image)
    cover.addEventListener('click', () => this.#look(false))
    this.#refs.set('look', cover)
    this.#vp.append(cover)
  }

  /** The list turns to the tiles until one is chosen. */
  #choose(chosen: ((tile: { name: string; parent: readonly string[] }) => void) | null): void {
    this.#choosing = chosen
    this.#panel?.toggleAttribute('data-choosing', !!chosen)
    this.#paintTag()
    if (!chosen) return
    if (this.#rail) { this.#rail.refresh(); return }
    const panel = this.#panel
    const host = this.#refs.get('rail')
    ;(window as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
      ?.whenReady?.(KEYS.rail, value => {
        if (this.#panel !== panel || this.#rail || !host) return
        const rail = (value as RailFactoryShape).create({
          walk: true,
          chats: false,
          choose: false,
          badge: () => 0,
          labelOf: (row: RailRow) => ioc<ReadingShape>(KEYS.decorations)?.readingAt?.(row.segments) || row.name,
          findLabel: t('editor.find-tiles', 'find tiles'),
          clickLabel: t('comfy.place-here', 'put the picture here'),
        })
        rail.onSubjectChanged = pick => {
          if (!pick) return
          const landing = this.#choosing
          this.#choose(null)
          landing?.({ name: pick.name, parent: pick.path })
        }
        rail.mount(host)
        this.#rail = rail
      })
  }

  // ── paint ─────────────────────────────────────────────────────

  #state(): DeskState | null {
    return this.#payload && this.#form ? { payload: this.#payload, form: this.#form, asset: this.#asset } : null
  }

  #context(): CardContext {
    return {
      say: t,
      intent: (effect, payload) => EffectBus.emit(effect, payload ?? {}),
      form: this.#form!,
      changed: () => this.#paint(),
      chooseTile: chosen => this.#choose(chosen),
      suggest: () => this.#startSuggesting(),
    }
  }

  // ── suggesting ────────────────────────────────────────────────

  /** The words so far become pieces, and the ideas open where the picture is. */
  #startSuggesting(): void {
    if (!this.#form || this.#suggesting) return
    this.#callouts?.open(null)
    this.#suggesting = {
      chunks: [...this.#parts.chunks.split(this.#form.values.positive)],
      ideas: [], source: '', open: null, reading: null, busy: false,
      abort: new AbortController(),
    }
    this.#paint()
    void this.#refreshIdeas()
  }

  #stopSuggesting(): void {
    const held = this.#suggesting
    if (!held) return
    held.abort.abort()
    this.#suggesting = null
    this.#paint()
    this.#panel?.focus({ preventScroll: true })
  }

  /** Speculative on the prompt so far: every change to the pieces asks again. */
  async #refreshIdeas(): Promise<void> {
    const held = this.#suggesting
    if (!held) return
    held.abort.abort()
    held.abort = new AbortController()
    const { signal } = held.abort
    held.busy = true
    held.open = null
    held.reading = null
    this.#paintIdeas()
    try {
      const found = await this.#parts.direction.ideas(this.#parts.chunks.join(held.chunks), signal)
      if (signal.aborted || this.#suggesting !== held) return
      held.ideas = found.ideas
      held.source = found.source
    } catch {
      if (signal.aborted || this.#suggesting !== held) return
    } finally {
      if (this.#suggesting === held && !signal.aborted) { held.busy = false; this.#paintIdeas() }
    }
  }

  /** A seat of the quick menu. Taking a direction adds one piece and asks again. */
  async #act(id: string, action: IdeaAction): Promise<void> {
    const held = this.#suggesting
    const idea = held?.ideas.find(one => one.id === id)
    if (!held || !idea) return
    switch (action) {
      case 'back': held.open = null; this.#paintIdeas(); return
      case 'read': held.reading = id; this.#paintIdeas(); return
      case 'shuffle': void this.#refreshIdeas(); return
      default: break
    }
    held.busy = true
    this.#paintIdeas()
    const { signal } = held.abort
    let chunk = ''
    try {
      chunk = await this.#parts.direction.unfold(
        this.#parts.chunks.join(held.chunks), idea, action, this.#form?.values.reviewers ?? 3, signal,
      )
    } catch { chunk = '' }
    if (signal.aborted || this.#suggesting !== held) return
    if (chunk && !held.chunks.some(piece => piece.toLowerCase() === chunk.toLowerCase())) held.chunks.push(chunk)
    this.#syncChunks()
    void this.#refreshIdeas()
  }

  #removeChunk(index: number): void {
    const held = this.#suggesting
    if (!held || index < 0 || index >= held.chunks.length) return
    held.chunks.splice(index, 1)
    this.#syncChunks()
    void this.#refreshIdeas()
  }

  /** The pieces ARE the prompt: the form follows them. */
  #syncChunks(): void {
    const held = this.#suggesting
    if (!held || !this.#form) return
    this.#form.set({ positive: this.#parts.chunks.join(held.chunks) })
    this.#paint()
  }

  #paintIdeas(): void {
    const held = this.#suggesting
    const ideas = this.#ideasUi
    const chunks = this.#chunksUi
    if (!ideas || !chunks) return
    ideas.el.hidden = chunks.el.hidden = !held
    if (!held) return
    chunks.show(held.chunks, held.busy)
    const subject = held.chunks[0] ?? t('comfy.prompt-tab', 'prompt')
    ideas.show({
      subject: subject.length > 28 ? `${subject.slice(0, 26).trim()}…` : subject,
      ideas: held.ideas, open: held.open, reading: held.reading, busy: held.busy, source: held.source,
    })
  }

  #cardOf(id: string): HTMLElement | null {
    const word = cardWord(id)
    if (!word) return null
    const held = this.#cards.get(id)
    if (held) return held.card.el
    const part = this.#parts[word] as CardPart
    const card = part.create(this.#context())
    this.#cards.set(id, { part, card })
    return card.el
  }

  #rows(): readonly RecipeRow[] {
    return (this.#payload ? this.#parts.recipe.rows(this.#payload.knobs ?? [], this.#asset) : [])
      .map(row => ({ ...row, label: t(row.labelKey, row.label) }))
  }

  #paint(): void {
    const state = this.#state()
    if (!state || !this.#panel) return
    const p = state.payload
    const rows = this.#rows()
    this.#callouts?.rows(rows, id => this.#cardOf(id))
    for (const { card } of this.#cards.values()) card.paint(state)
    this.#callouts?.values(id => {
      const held = this.#cards.get(id)
      return {
        text: held?.part.value(state, t) ?? '',
        alert: held?.part.alert?.(state) ?? false,
      }
    })

    const job = p.job?.state ?? 'idle'
    const busy = job === 'queued' || job === 'running'
    const run = this.#refs.get('run')
    if (run) run.textContent = busy ? t('comfy.stop', 'Stop') : t('comfy.generate', 'Generate')
    const address = this.#refs.get('address')
    if (address) address.textContent = [p.activeLabel, p.endpoint].filter(Boolean).join(' · ')
    const said = this.#refs.get('state')
    if (said) said.textContent = job === 'error' ? '' : (p.job?.message ?? '')

    const notices = this.#refs.get('notices')
    if (notices) {
      const trouble = job === 'error' ? (p.job?.message ?? '') : ''
      notices.replaceChildren(...(trouble ? [make('div', 'cd-note-bar', trouble)] : []))
    }
    this.#schedule()
    this.#paintTag()
    this.#paintFolder(p)
    // While the ideas are open they stand where the picture does.
    const suggesting = !!this.#suggesting
    if (this.#frame) this.#frame.el.hidden = suggesting
    if (this.#callouts) this.#callouts.el.hidden = suggesting
    this.#refs.get('suggest')?.setAttribute('aria-pressed', String(suggesting))
    this.#panel?.toggleAttribute('data-suggesting', suggesting)
    this.#paintIdeas()
  }

  #paintFolder(p: ComfyRenderPayload): void {
    this.#shelf?.folder(p.browsing ? p.folderPictures : [])
  }

  #paintShelf(): void {
    if (!this.#shelf) return
    const hidden = new Set(this.#hidden.map(item => item.sig))
    this.#shelf.show(
      this.#assets.filter(asset => !hidden.has(asset.sig)).map(asset => ({ asset, chosen: asset.sig === this.#asset?.sig })),
      !this.#asset,
    )
    this.#shelf.hidden(this.#hidden)
  }

  #paintTag(): void {
    const tag = this.#refs.get('tag')
    if (!tag) return
    if (this.#choosing) { tag.textContent = t('comfy.place-pick', 'Choose the tile this picture goes on'); return }
    if (this.#suggesting) { tag.textContent = t('comfy.suggesting', 'Where the prompt could go. Take a piece out with ×. Generate when it is complete.'); return }
    const record = this.#asset?.record
    tag.textContent = record
      ? [record.label, record.model, record.seed !== undefined ? `${t('comfy.seed', 'seed')} ${record.seed}` : ''].filter(Boolean).join(' · ')
      : ''
  }

  #shown(): FrameShown {
    const job = this.#payload?.job
    const numbers = this.#form?.values.numbers ?? {}
    const width = Number(numbers['width'])
    const height = Number(numbers['height'])
    const held = this.#url ? this.#size : { width, height }
    return {
      url: this.#url,
      width: held.width > 0 ? held.width : 1024,
      height: held.height > 0 ? held.height : 1024,
      progress: typeof job?.fraction === 'number' ? job.fraction : null,
      busy: job?.state === 'queued' || job?.state === 'running',
      words: this.#form?.values.positive ?? '',
      placeholder: t('comfy.prompt', 'What should the picture be?'),
    }
  }

  #schedule(): void {
    if (this.#frameId) return
    this.#frameId = requestAnimationFrame(() => {
      this.#frameId = 0
      this.#layout()
    })
  }

  /** The picture's box, from the viewport and the picture's own shape. The
   *  tabs keep a column each side; an open card takes the gutter it finds,
   *  so opening one never moves the picture. */
  #layout(): void {
    const vp = this.#vp
    const frame = this.#frame
    const callouts = this.#callouts
    if (!vp || !frame || !callouts) return
    const em = parseFloat(getComputedStyle(vp).fontSize) || 16
    const U = em / 16
    const width = vp.clientWidth
    const height = vp.clientHeight
    const shown = this.#shown()
    const column = (TAB_WIDTH + GAP + MARGIN) * U
    const room = {
      w: Math.min(width - 2 * column, MAX_STAGE * U),
      h: Math.min(height - 2 * KEEP_EM * em, MAX_STAGE * U),
    }
    const narrow = window.innerWidth / em < NARROW_EM || Math.min(room.w, room.h) < MIN_STAGE * U
    const fit = narrow
      ? fitBox({ w: Math.min(width - 32, NARROW_STAGE * U), h: NARROW_STAGE * U }, shown.width, shown.height)
      : fitBox(room, shown.width, shown.height)
    const box = {
      x: narrow ? 0 : Math.round((width - fit.w) / 2),
      y: narrow ? 0 : Math.round((height - fit.h) / 2),
      w: fit.w,
      h: fit.h,
    }
    this.#panel?.setAttribute('data-layout', narrow ? 'narrow' : 'wide')
    frame.el.style.left = narrow ? '' : `${box.x}px`
    frame.el.style.top = narrow ? '' : `${box.y}px`
    frame.show(box, shown, this.#rows())
    callouts.place({ picture: box, viewport: { width, height }, unit: U, narrow })
  }

  #light(lit: ReadonlyMap<string, Lit>): void {
    this.#frame?.light(lit)
  }
}
