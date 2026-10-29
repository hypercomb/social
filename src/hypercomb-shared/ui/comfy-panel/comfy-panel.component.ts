// hypercomb-shared/ui/comfy-panel/comfy-panel.component.ts
//
// COMFYUI — right-docked, `/comfy` opens it.
//
// Four things stacked in the order a person needs them:
//
//   THE MACHINE   — is ComfyUI answering, and at what address. First, because
//                   nothing below it means anything until this is green, and
//                   the two failures that matter (a missing CORS flag, an
//                   https page reaching plain http) are named rather than
//                   reported as "unreachable".
//   THE FOLDER    — ComfyUI's own directory, linked once from the Windows
//                   picker. With it, pictures are read where they lie and the
//                   whole output folder can be browsed with NOTHING copied.
//   THE RECIPE    — which workflow, and the knobs that workflow actually
//                   offers. One control per seam, so a workflow with no
//                   negative prompt shows no negative field.
//   THE PICTURES  — what the last run made. A click opens that picture large,
//                   in the middle of the screen.
//
// Shell UI, so it must NOT import essentials. Everything arrives on
// `comfy:render` (ComfyDrone owns the host, the folder and the workflow pool)
// and leaves as intents. Nothing here knows what a seam is.
//
// THE FORM IS LOCAL, DELIBERATELY. A textarea whose value round-trips through
// the bus on every keystroke fights the typist and loses the caret. The
// payload carries the SEED — what the active workflow's seams hold — and the
// panel takes that seed the first time a model and its LoRAs are used. After
// that, moving away remembers the form and moving back continues from it.
// The whole set goes back once, with `comfy:generate`.

import { registerShellSurface } from '@hypercomb/runtime/shell-surface-registry'
import { Component, computed, effect, ElementRef, inject, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'

/** One picture the panel can show without anything being copied — an object
 *  URL over a file that already exists on disk or on the host. */
interface ComfyPicture {
  url: string
  filename: string
  subfolder: string
  type: string
  size: number
  seed: number
  /** The participant already named this one onto a tile. */
  placed?: boolean
}

/** What the panel may set. Mirrors ComfyParams in essentials. */
interface ComfyParams {
  positive?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  fromTile?: boolean
  reviewers?: number
}

/** Mirrors ComfyRenderPayload in essentials/comfy/comfy.drone.ts — shared
 *  cannot import essentials, so the shape is kept field-for-field by hand. */
interface ComfyPanelPayload {
  open?: boolean
  reveal?: string
  endpoint?: string
  reachOk?: boolean
  reachReason?: string
  reachAsking?: boolean
  folderSupported?: boolean
  folderLinked?: boolean
  folderLabel?: string
  browsing?: boolean
  folderPictures?: ComfyPicture[]
  workflows?: { id: string; label: string }[]
  active?: string
  activeLabel?: string
  knobs?: string[]
  seeds?: ComfyParams
  job?: { state?: string; fraction?: number; message?: string }
  results?: ComfyPicture[]
  target?: string
  targets?: string[]
  /** The pictures are waiting for a name before they become tiles. */
  nameResults?: boolean
  importError?: string
  weights?: ComfyWeightRow[]
  /** Kept prompts. The list draws `text` only. */
  prompts?: ComfyPromptRow[]
  /** Present on the one render that loads a kept state into the form. */
  applyPrompt?: ComfyPromptRow
  /** Present on the one render that loads a history generation into the form. */
  generation?: ComfyGenerationRestore
  /** Present on the one render that replaces the prompt text. */
  rolled?: string
  /** The continuation read for the active model and LoRAs has finished. */
  draftReady?: boolean
  /** The form last left on that combination. */
  resume?: ComfyContinuation
}

interface ComfyGenerationRestore {
  positive?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  workflow?: string
  label?: string
  model?: string
}

/** One kept state. Mirrors ComfyPromptSaved; shared cannot import essentials. */
interface ComfyPromptRow {
  sig: string
  text: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  width?: number
  height?: number
  batch?: number
  workflow?: string
  label?: string
  model?: string
  fromTile?: boolean
  reviewers?: number
}

/** One model or LoRA. Mirrors ComfyWeightRow in the drone. */
interface ComfyWeightRow {
  file: string
  kind: string
  label: string
  active: boolean
  ms?: number
  cached?: boolean
  loading?: boolean
  since?: number
}

/** The number fields, in the order they read across the row. */
const NUMBER_KNOBS = ['width', 'height', 'steps', 'cfg', 'batch'] as const
type NumberKnob = typeof NUMBER_KNOBS[number]

/** The form remembered for one model and its LoRAs. Mirrors ComfyDraft. */
interface ComfyContinuation {
  positive: string
  negative: string
  seed: string
  width: string
  height: string
  steps: string
  cfg: string
  batch: string
  fromTile: boolean
  reviewers: number
}

/**
 * Same combination as essentials/comfy/comfy-draft.ts `continuationKey`.
 * Model files, then LoRA files. Text encoders and VAEs do not count.
 */
const continuationKey = (
  rows: readonly { file?: string; kind?: string; active?: boolean }[],
): string => {
  const files = (kind: string): string[] => {
    const found = new Set<string>()
    for (const row of rows) {
      if (row.kind !== kind || row.active === false) continue
      const file = String(row.file ?? '').trim()
      if (file) found.add(file)
    }
    return [...found].sort()
  }
  const models = files('model')
  const loras = files('lora')
  if (!models.length && !loras.length) return ''
  return `${models.join('\n')}\n\n${loras.join('\n')}`
}

@Component({
  selector: 'hc-comfy-panel',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './comfy-panel.component.html',
  styleUrls: ['./comfy-panel.component.scss'],
})
export class ComfyPanelComponent implements OnDestroy {

  readonly visible = signal(false)

  /**
   * Put away while the hive is covered, brought back on the way home.
   *
   * IT ANNOUNCES, and that is not optional here. The drone holds the open
   * state — `/comfy` toggles it — so a park that only set `visible` would
   * leave the two disagreeing: the panel gone from the screen, the drone
   * still believing it is up, and the next `/comfy` toggling it CLOSED. The
   * gesture would do nothing, twice, and read as a broken command.
   *
   * Both directions, and both idempotent on the far side: park says closed,
   * unpark says open, neither is a toggle.
   */
  readonly session = signalSession(
    this.visible,
    (open) => { EffectBus.emit(open ? 'comfy:reopen' : 'comfy:close', {}) },
    // Escape unwinds ONE level. The large picture is that level: the press
    // that leaves it must not park the window it was opened from.
    { dismiss: () => this.#dismissOne(), close: () => this.close() },
  )

  readonly endpoint = signal('')
  readonly reachOk = signal(false)
  readonly reachReason = signal('')
  readonly reachAsking = signal(false)

  readonly folderSupported = signal(true)
  readonly folderLinked = signal(false)
  readonly folderLabel = signal('')
  readonly browsing = signal(false)
  readonly folderPictures = signal<ComfyPicture[]>([])

  readonly workflows = signal<{ id: string; label: string }[]>([])
  readonly active = signal('')
  readonly knobs = signal<string[]>([])

  readonly jobState = signal('idle')
  readonly jobFraction = signal<number | null>(null)
  readonly jobMessage = signal('')
  readonly results = signal<ComfyPicture[]>([])
  /** New pictures stay here until each one is given a name. */
  readonly nameResults = signal(false)
  readonly target = signal('')
  /** Selected tiles that will receive a picture. Empty means new tiles. */
  readonly targets = signal<string[]>([])
  readonly importError = signal('')
  /** The picture opened large over the hive. Null when the lightbox is shut. */
  readonly looking = signal<ComfyPicture | null>(null)
  /** The large picture is being carried onto a tile. The cover hides so the
   *  hive can take the drop; the element stays, or the drag dies with it. */
  readonly carrying = signal(false)
  /** Models and LoRAs the recipes use, with which ones this workflow loads. */
  readonly weights = signal<ComfyWeightRow[]>([])
  /** Ticks while a loader is running so the seconds on that row move. */
  readonly now = signal(0)

  /** The paste fold. Closed until asked for — a workflow is added rarely and
   *  a textarea of JSON is not what this window is about. */
  readonly pasteOpen = signal(false)

  // ── the form, held locally ────────────────────────────────────────────────
  readonly positive = signal('')
  readonly negative = signal('')
  readonly seed = signal('')
  readonly numbers = signal<Record<string, string>>({})
  /** The tile's picture and properties help the prompt. Reviewers write
   *  options; Jev picks. Held here so a keystroke in the prompt is not a
   *  round trip. */
  readonly fromTile = signal(false)
  readonly reviewers = signal(3)
  /** The library is a click away whenever the window is open. */
  readonly libraryOpen = signal(false)
  readonly libraryNote = signal(false)
  readonly prompts = signal<ComfyPromptRow[]>([])
  readonly selectedPrompt = signal('')
  readonly chosen = computed(() =>
    this.prompts().find(row => row.sig === this.selectedPrompt()) ?? null)

  /** Which model and LoRAs the form currently belongs to. */
  readonly #heldKey = signal('')
  /** A continuation read has landed, or the participant has edited. Until
   *  then a save would replace a stored form with the recipe defaults. */
  readonly #settled = signal(false)
  /** The participant changed the form after it was filled. A late read must
   *  not write over that. */
  #touched = false
  readonly #memory = new Map<string, ComfyContinuation>()
  readonly #saved = new Map<string, string>()
  #saveTimer: ReturnType<typeof setTimeout> | null = null
  readonly #onHide = (): void => {
    if (document.visibilityState === 'hidden') this.#flushNow()
  }

  readonly busy = computed(() => this.jobState() === 'queued' || this.jobState() === 'running')
  readonly numberKnobs = computed(() =>
    NUMBER_KNOBS.filter(knob => this.knobs().includes(knob)) as readonly NumberKnob[])

  #cleanups: (() => void)[] = []
  #tick: ReturnType<typeof setInterval> | null = null
  readonly #el = inject(ElementRef<HTMLElement>)

  constructor() {
    this.#cleanups.push(EffectBus.on<ComfyPanelPayload>('comfy:render', (p) => this.#read(p)))
    const watch = effect(() => {
      const key = this.#heldKey()
      const settled = this.#settled()
      const draft = this.#capture()
      if (!key || !settled) return
      this.#armSave(key, draft)
    })
    this.#cleanups.push(() => watch.destroy())
    document.addEventListener('visibilitychange', this.#onHide)
  }

  #read(p: ComfyPanelPayload): void {
    const wasOpen = this.visible()
    this.visible.set(!!p?.open)
    this.endpoint.set(String(p?.endpoint ?? ''))
    this.reachOk.set(!!p?.reachOk)
    this.reachReason.set(String(p?.reachReason ?? ''))
    this.reachAsking.set(!!p?.reachAsking)
    this.folderSupported.set(p?.folderSupported !== false)
    this.folderLinked.set(!!p?.folderLinked)
    this.folderLabel.set(String(p?.folderLabel ?? ''))
    this.browsing.set(!!p?.browsing)
    this.folderPictures.set(Array.isArray(p?.folderPictures) ? p.folderPictures : [])
    this.workflows.set(Array.isArray(p?.workflows) ? p.workflows : [])
    this.active.set(String(p?.active ?? ''))
    this.knobs.set(Array.isArray(p?.knobs) ? p.knobs : [])
    this.jobState.set(String(p?.job?.state ?? 'idle'))
    this.jobFraction.set(typeof p?.job?.fraction === 'number' ? p.job.fraction : null)
    this.jobMessage.set(String(p?.job?.message ?? ''))
    this.results.set(Array.isArray(p?.results) ? p.results : [])
    this.nameResults.set(!!p?.nameResults)
    if (p?.nameResults && (p.results ?? []).some(picture => !picture.placed)) this.#askForName()
    const open = this.looking()
    if (open && !this.results().some(picture => picture.url === open.url)) this.looking.set(null)
    this.target.set(String(p?.target ?? ''))
    this.targets.set(Array.isArray(p?.targets) ? p.targets.filter(name => !!name) : [])
    this.importError.set(String(p?.importError ?? ''))
    if (this.importError()) this.pasteOpen.set(true)
    this.weights.set(Array.isArray(p?.weights) ? p.weights : [])
    this.#syncClock()

    // A different model or LoRA set continues from the last time it was used.
    // The same set keeps what is on screen, even when the workflow name changes.
    const key = continuationKey(this.weights())
    if (key && key !== this.#heldKey()) {
      const arriving = this.#heldKey() === '' && this.#touched
      if (this.#heldKey()) this.#flushNow()
      const known = this.#memory.get(key)
      if (!arriving) {
        if (known) this.#applyContinuation(known)
        else this.#applySeeds(p?.seeds)
        this.#touched = false
      } else {
        this.#memory.set(key, this.#capture())
      }
      this.#heldKey.set(key)
      this.#settled.set(!!known || arriving)
      this.pasteOpen.set(false)
    }
    if (p?.draftReady && key && key === this.#heldKey()) {
      if (p.resume && !this.#memory.has(key)) {
        const resumed = this.#continuation(p.resume)
        this.#memory.set(key, resumed)
        if (!this.#touched) this.#applyContinuation(resumed)
      }
      this.#settled.set(true)
    }

    const prompts = Array.isArray(p?.prompts) ? p.prompts : []
    this.prompts.set(prompts)
    if (this.selectedPrompt() && !prompts.some(row => row.sig === this.selectedPrompt())) {
      this.selectedPrompt.set('')
    }
    // After the continuation, so a kept state or a roll replaces it.
    if (p?.applyPrompt?.text) { this.#applySaved(p.applyPrompt); this.#touch() }
    if (p?.generation) { this.#applyGeneration(p.generation); this.#touch() }
    if (typeof p?.rolled === 'string' && p.rolled) { this.positive.set(p.rolled); this.#touch() }
    if (wasOpen && !p?.open) this.#flushNow()
  }

  /** The form, in the shape a continuation stores. */
  #capture(): ComfyContinuation {
    const numbers = this.numbers()
    return {
      positive: this.positive(),
      negative: this.negative(),
      seed: this.seed(),
      width: numbers['width'] ?? '',
      height: numbers['height'] ?? '',
      steps: numbers['steps'] ?? '',
      cfg: numbers['cfg'] ?? '',
      batch: numbers['batch'] ?? '',
      fromTile: this.fromTile(),
      reviewers: this.reviewers(),
    }
  }

  #continuation(row: ComfyContinuation): ComfyContinuation {
    const text = (value: unknown): string => value === undefined || value === null ? '' : String(value)
    const reviewers = Number(row?.reviewers)
    return {
      positive: text(row?.positive),
      negative: text(row?.negative),
      seed: text(row?.seed),
      width: text(row?.width),
      height: text(row?.height),
      steps: text(row?.steps),
      cfg: text(row?.cfg),
      batch: text(row?.batch),
      fromTile: row?.fromTile === true,
      reviewers: Number.isFinite(reviewers) ? reviewers : 3,
    }
  }

  /** The workflow's own defaults. The help switch stays as it is. */
  #applySeeds(seeds: ComfyPanelPayload['seeds']): void {
    const held = seeds ?? {}
    this.positive.set(String(held.positive ?? ''))
    this.negative.set(String(held.negative ?? ''))
    this.seed.set(held.seed === undefined ? '' : String(held.seed))
    const numbers: Record<string, string> = {}
    for (const knob of NUMBER_KNOBS) {
      const value = held[knob]
      if (value !== undefined) numbers[knob] = String(value)
    }
    this.numbers.set(numbers)
  }

  #applyContinuation(row: ComfyContinuation): void {
    this.positive.set(row.positive)
    this.negative.set(row.negative)
    this.seed.set(row.seed)
    this.numbers.set({
      width: row.width,
      height: row.height,
      steps: row.steps,
      cfg: row.cfg,
      batch: row.batch,
    })
    this.fromTile.set(row.fromTile)
    this.reviewers.set(row.reviewers)
    EffectBus.emit('comfy:set-help', { fromTile: row.fromTile, reviewers: row.reviewers })
  }

  #touch(): void {
    this.#touched = true
    this.#settled.set(true)
  }

  #armSave(key: string, draft: ComfyContinuation): void {
    const body = JSON.stringify(draft)
    if (this.#saved.get(key) === body) {
      if (this.#saveTimer !== null) { clearTimeout(this.#saveTimer); this.#saveTimer = null }
      return
    }
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null
      this.#remember(key, draft)
    }, 400)
  }

  /** An edit is worth keeping. An untouched recipe default is not: it would
   *  replace a continuation the read has not applied yet. */
  #flushNow(): void {
    const key = this.#heldKey()
    if (!key) return
    if (this.#saveTimer !== null) { clearTimeout(this.#saveTimer); this.#saveTimer = null }
    if (!this.#settled() && !this.#touched) return
    this.#remember(key, this.#capture())
  }

  #remember(key: string, draft: ComfyContinuation): void {
    const body = JSON.stringify(draft)
    this.#memory.set(key, draft)
    if (this.#saved.get(key) === body) return
    this.#saved.set(key, body)
    EffectBus.emit('comfy:remember', { key, draft })
  }

  ngOnDestroy(): void {
    if (this.#tick !== null) clearInterval(this.#tick)
    this.#tick = null
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer)
    this.#saveTimer = null
    document.removeEventListener('visibilitychange', this.#onHide)
    this.#flushNow()
    for (const c of this.#cleanups) c()
    this.#cleanups = []
  }

  /** A loader's seconds should move. The clock starts only while one is open. */
  #syncClock(): void {
    const loading = this.weights().some(row => row.loading)
    if (loading && this.#tick === null) {
      this.now.set(Date.now())
      this.#tick = setInterval(() => this.now.set(Date.now()), 200)
    }
    if (!loading && this.#tick !== null) {
      clearInterval(this.#tick)
      this.#tick = null
    }
  }

  close(): void { EffectBus.emit('comfy:close', {}) }

  // ── the machine ───────────────────────────────────────────────────────────

  setEndpoint(input: HTMLInputElement): void {
    const endpoint = input.value.trim()
    if (endpoint) EffectBus.emit('comfy:set-endpoint', { endpoint })
  }

  discover(): void { EffectBus.emit('comfy:discover', {}) }

  // ── the folder ────────────────────────────────────────────────────────────

  /** Straight from the click. `showDirectoryPicker` is only allowed inside
   *  the gesture, and EffectBus runs its handlers synchronously — so the
   *  activation survives the hop into essentials. */
  linkFolder(): void { EffectBus.emit('comfy:link-folder', {}) }

  browse(): void { EffectBus.emit('comfy:browse', { open: !this.browsing() }) }

  /** Keep one picture from the folder. The single moment bytes enter the
   *  hive, and the only one. */
  keep(index: number): void { EffectBus.emit('comfy:keep', { index }) }

  // ── the recipe ────────────────────────────────────────────────────────────

  pickWorkflow(select: HTMLSelectElement): void {
    EffectBus.emit('comfy:set-workflow', { id: select.value })
  }

  togglePaste(): void { this.pasteOpen.set(!this.pasteOpen()) }

  addWorkflow(area: HTMLTextAreaElement): void {
    const json = area.value.trim()
    if (!json) return
    EffectBus.emit('comfy:import-workflow', { json })
  }

  offers(knob: string): boolean { return this.knobs().includes(knob) }

  setPositive(value: string): void {
    this.positive.set(value)
    this.#touch()
  }

  setNegative(value: string): void {
    this.negative.set(value)
    this.#touch()
  }

  setSeed(value: string): void {
    this.seed.set(value)
    this.#touch()
  }

  setNumber(knob: string, input: HTMLInputElement): void {
    this.numbers.set({ ...this.numbers(), [knob]: input.value })
    this.#touch()
  }

  numberOf(knob: string): string { return this.numbers()[knob] ?? '' }

  setFromTile(on: boolean): void {
    this.fromTile.set(!!on)
    this.#touch()
    EffectBus.emit('comfy:set-help', { fromTile: this.fromTile(), reviewers: this.reviewers() })
  }

  /** A new prompt in the box. The picture waits for Generate. */
  rollPrompt(kind: 'tile' | 'words'): void {
    EffectBus.emit('comfy:roll', { kind })
  }

  setReviewers(input: HTMLInputElement): void {
    const n = Math.round(Number(input.value))
    const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3
    this.reviewers.set(clamped)
    input.value = String(clamped)
    this.#touch()
    EffectBus.emit('comfy:set-help', { fromTile: this.fromTile(), reviewers: clamped })
  }

  toggleLibrary(): void {
    const next = !this.libraryOpen()
    this.libraryOpen.set(next)
    this.libraryNote.set(false)
    if (next) EffectBus.emit('comfy:library', {})
  }

  pickPrompt(sig: string): void { this.selectedPrompt.set(sig) }

  /** Write the current form into the library. No words, no member. */
  keepPrompt(): void {
    if (!this.offers('positive') || !this.positive().trim()) {
      this.libraryOpen.set(true)
      this.libraryNote.set(true)
      return
    }
    this.libraryNote.set(false)
    this.libraryOpen.set(true)
    EffectBus.emit('comfy:save-prompt', this.#draft())
  }

  /** Put the selected state back into the form. Generate stays the participant's. */
  usePrompt(): void {
    const sig = this.selectedPrompt()
    if (!sig) return
    EffectBus.emit('comfy:use-prompt', { sig })
  }

  #draft(): ComfyParams {
    const params: ComfyParams = {
      positive: this.positive(),
      fromTile: this.fromTile(),
      reviewers: this.reviewers(),
    }
    if (this.offers('negative') && this.negative().trim()) params.negative = this.negative()
    const seed = Number(this.seed())
    if (this.offers('seed') && this.seed().trim() && Number.isFinite(seed)) params.seed = seed
    for (const knob of NUMBER_KNOBS) {
      if (!this.offers(knob)) continue
      const value = Number(this.numbers()[knob])
      if (Number.isFinite(value)) params[knob] = value
    }
    return params
  }

  /** A history generation, written over whatever the workflow just seeded.
   *  The library stays as it was. Generate is still a separate press. */
  #applyGeneration(row: ComfyGenerationRestore): void {
    if (row.positive !== undefined) this.positive.set(row.positive)
    if (row.negative !== undefined) this.negative.set(row.negative)
    if (row.seed !== undefined) this.seed.set(String(row.seed))
    const numbers = { ...this.numbers() }
    for (const knob of NUMBER_KNOBS) {
      const value = row[knob]
      if (typeof value === 'number') numbers[knob] = String(value)
    }
    this.numbers.set(numbers)
  }

  /** The kept state, written over whatever the workflow just seeded. */
  #applySaved(row: ComfyPromptRow): void {
    this.positive.set(row.text)
    this.negative.set(row.negative ?? '')
    this.seed.set(row.seed === undefined ? '' : String(row.seed))
    const numbers = { ...this.numbers() }
    for (const knob of NUMBER_KNOBS) {
      const value = row[knob]
      if (typeof value === 'number') numbers[knob] = String(value)
    }
    this.numbers.set(numbers)
    this.fromTile.set(row.fromTile === true)
    if (typeof row.reviewers === 'number') this.reviewers.set(row.reviewers)
    this.selectedPrompt.set(row.sig)
    this.libraryOpen.set(true)
    EffectBus.emit('comfy:set-help', { fromTile: this.fromTile(), reviewers: this.reviewers() })
  }

  /** The label a number field wears. Keys are `comfy.width` … so the catalog
   *  stays flat and no key is built out of two halves at runtime. */
  numberKey(knob: string): string { return `comfy.${knob}` }

  /** Kind labels are whole catalog keys. No key is built by joining a prefix. */
  kindKey(kind: string): string {
    switch (kind) {
      case 'text': return 'comfy.weight-text'
      case 'vae': return 'comfy.weight-vae'
      case 'lora': return 'comfy.weight-lora'
      default: return 'comfy.weight-model'
    }
  }

  /** Seconds for a row. Under ten seconds, one decimal. Reads `now` so the
   *  live loader keeps moving between payloads. */
  seconds(row: ComfyWeightRow): string {
    this.now()
    const ms = row.loading
      ? Math.max(0, Date.now() - (row.since ?? Date.now()))
      : (row.ms ?? 0)
    const seconds = ms / 1000
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`
  }

  // ── the run ───────────────────────────────────────────────────────────────

  run(): void {
    if (this.busy()) { EffectBus.emit('comfy:cancel', {}); return }
    const params: ComfyParams = {}
    if (this.offers('positive')) {
      params.positive = this.positive()
      params.fromTile = this.fromTile()
      params.reviewers = this.reviewers()
    }
    if (this.offers('negative')) params.negative = this.negative()
    // A blank seed means a new one every time — that is what blank IS here,
    // not a zero and not an error.
    const seed = Number(this.seed())
    if (this.seed().trim() && Number.isFinite(seed)) params.seed = seed
    for (const knob of NUMBER_KNOBS) {
      if (!this.offers(knob)) continue
      const value = Number(this.numbers()[knob])
      if (Number.isFinite(value)) params[knob] = value
    }
    EffectBus.emit('comfy:generate', params)
  }

  /** The picture, large, in the middle of the screen.
   *  Focus stays in the window, so Escape finds this level and not the sweep. */
  look(picture: ComfyPicture): void {
    this.looking.set(picture)
    const panel = this.#el.nativeElement.querySelector('.comfy-panel')
    if (panel instanceof HTMLElement) panel.focus()
  }

  closeLook(): void {
    this.carrying.set(false)
    this.looking.set(null)
  }

  /** A press on the picture must not move focus out of the window. A button
   *  still takes the press: the × is how a click leaves, and it is not Escape. */
  holdLookFocus(event: MouseEvent): void {
    const target = event.target
    if (target instanceof Element && target.closest('button')) return
    event.preventDefault()
  }

  /** The picture, then nothing else. False leaves the press for the sweep. */
  #dismissOne(): boolean {
    if (!this.looking()) return false
    this.closeLook()
    return true
  }

  /** Put a result on the tile. Drag still does this; a click looks. */
  attach(index: number): void { EffectBus.emit('comfy:attach', { index }) }

  /** The name under a new picture. Enter makes the tile. A blank name does not. */
  placeNamed(index: number, field: HTMLInputElement): void {
    const name = field.value.trim()
    if (!name) return
    EffectBus.emit('comfy:place', { index, name })
  }

  /** The name field is the prompt. Leave a field the participant is already typing in. */
  #askForName(): void {
    setTimeout(() => {
      const root = this.#el.nativeElement
      const active = document.activeElement
      if (active instanceof HTMLElement && root.contains(active)) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      }
      const field = root.querySelector('input.comfy-name-field')
      if (field instanceof HTMLInputElement) field.focus()
    }, 0)
  }

  /** Same gesture as `attach`, carried by a drag instead of a click — the
   *  custom MIME never collides with a real OS file drag over the canvas. */
  dragResult(event: DragEvent, index: number): void {
    event.dataTransfer?.setData('application/x-hc-comfy-result', String(index))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  /** The large picture, dragged onto a tile. The cover steps aside on the
   *  next frame so the browser can snapshot it as the drag image first. */
  dragLook(event: DragEvent, picture: ComfyPicture): void {
    const index = this.results().findIndex(one => one.url === picture.url)
    if (index < 0) { event.preventDefault(); return }
    this.dragResult(event, index)
    requestAnimationFrame(() => { if (this.looking()) this.carrying.set(true) })
  }

  endLookDrag(): void { this.closeLook() }

  dragFolderPicture(event: DragEvent, index: number): void {
    event.dataTransfer?.setData('application/x-hc-comfy-folder-picture', String(index))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  /** The percentage the bar is filled to, as a whole number. */
  percent(): number {
    return Math.round(Math.min(1, Math.max(0, this.jobFraction() ?? 0)) * 100)
  }

  megabytes(bytes: number): string { return `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts). 157 puts it just after the
// Backgrounds window (156): both windows are about pictures, and this is the
// one that makes them.
registerShellSurface({
  name: 'hc-comfy-panel',
  owner: '@hypercomb.shared/ComfyPanelComponent',
  component: ComfyPanelComponent,
  order: 157,
})
