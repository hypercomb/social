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
//   THE PICTURES  — what the last run made, and the one gesture that matters:
//                   keep this one, onto that tile.
//
// Shell UI, so it must NOT import essentials. Everything arrives on
// `comfy:render` (ComfyDrone owns the host, the folder and the workflow pool)
// and leaves as intents. Nothing here knows what a seam is.
//
// THE FORM IS LOCAL, DELIBERATELY. A textarea whose value round-trips through
// the bus on every keystroke fights the typist and loses the caret. The
// payload carries the SEED — what the active workflow's seams hold — and the
// panel re-seeds only when the workflow changes; the whole set goes back once,
// with `comfy:generate`.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
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
  importError?: string
}

/** The number fields, in the order they read across the row. */
const NUMBER_KNOBS = ['width', 'height', 'steps', 'cfg', 'batch'] as const
type NumberKnob = typeof NUMBER_KNOBS[number]

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
    { close: () => this.close() },
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
  readonly target = signal('')
  readonly importError = signal('')

  /** The paste fold. Closed until asked for — a workflow is added rarely and
   *  a textarea of JSON is not what this window is about. */
  readonly pasteOpen = signal(false)

  // ── the form, held locally ────────────────────────────────────────────────
  readonly positive = signal('')
  readonly negative = signal('')
  readonly seed = signal('')
  readonly numbers = signal<Record<string, string>>({})

  /** Which workflow the local form was seeded from. A change means re-seed;
   *  anything else must not touch what is being typed. */
  #seededFor = ''

  readonly busy = computed(() => this.jobState() === 'queued' || this.jobState() === 'running')
  readonly numberKnobs = computed(() =>
    NUMBER_KNOBS.filter(knob => this.knobs().includes(knob)) as readonly NumberKnob[])

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<ComfyPanelPayload>('comfy:render', (p) => this.#read(p)))
  }

  #read(p: ComfyPanelPayload): void {
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
    this.target.set(String(p?.target ?? ''))
    this.importError.set(String(p?.importError ?? ''))
    if (this.importError()) this.pasteOpen.set(true)

    // Re-seed ONLY on a workflow change — see the note at the top.
    const id = String(p?.active ?? '')
    if (id && id !== this.#seededFor) {
      this.#seededFor = id
      const seeds = p?.seeds ?? {}
      this.positive.set(String(seeds.positive ?? ''))
      this.negative.set(String(seeds.negative ?? ''))
      this.seed.set(seeds.seed === undefined ? '' : String(seeds.seed))
      const numbers: Record<string, string> = {}
      for (const knob of NUMBER_KNOBS) {
        const value = seeds[knob]
        if (value !== undefined) numbers[knob] = String(value)
      }
      this.numbers.set(numbers)
      this.pasteOpen.set(false)
    }
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#cleanups = []
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

  setNumber(knob: string, input: HTMLInputElement): void {
    this.numbers.set({ ...this.numbers(), [knob]: input.value })
  }

  numberOf(knob: string): string { return this.numbers()[knob] ?? '' }

  /** The label a number field wears. Keys are `comfy.width` … so the catalog
   *  stays flat and no key is built out of two halves at runtime. */
  numberKey(knob: string): string { return `comfy.${knob}` }

  // ── the run ───────────────────────────────────────────────────────────────

  run(): void {
    if (this.busy()) { EffectBus.emit('comfy:cancel', {}); return }
    const params: ComfyParams = {}
    if (this.offers('positive')) params.positive = this.positive()
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

  /** Put a result on the tile. */
  attach(index: number): void { EffectBus.emit('comfy:attach', { index }) }

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
