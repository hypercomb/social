// diamondcoreprocessor.com/tutorial/bee-tutorial.drone.ts
//
// THE COURSE RUNNER — a beeing flies the screen and teaches the hive.
//
// This drone owns none of the teaching. It owns the STAGE: the overlay bee, a
// disposable practice page, the geometry that turns a cell into a screen
// position, and a small set of verbs that all run through the SAME paths a real
// participant's action takes — `Lineage.explorerEnter` for movement, the
// command line's `search:prefill` + `command-line:remote-submit` for typing,
// `keymap:invoke` for bound actions, `cell:attach-resource` for covers. What
// the participant watches is exactly what will happen when they do it.
//
// The lessons live in `lessons/*.lessons.ts` — independent pieces, registered
// in the TutorialLessonRegistry, sorted by their `order` (most obvious and
// simplest first) and grouped into courses by `level`. A course is therefore
// DATA: adding a lesson is registering one, and any module can contribute.
//
// Run a course:  /tutorial            (starter)
//                /tutorial beginner | intermediate | expert
// Run one alone: /tutorial go-in
// Stop:          /tutorial stop, the Skip button, or Escape.

import { Drone, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { removeTilesAt } from '../commands/remove.queen.js'
import { readTutorialRecord, writeTutorialRecord, clearTutorialRecord, tutorialPlannerSig } from './tutorial-provenance.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { storeImageResources, type ImageResources } from '../editor/arm-resource.js'
import type { BeeTutorialOverlayElement, SayResult } from './tutorial-overlay.view.js'
import {
  tutorialLessons, courseMeaning, courseSignature,
  type TutorialLesson, type TutorialLevel,
} from './tutorial-lesson.js'
import type { CoverFactory, StageRect, TutorialStage } from './tutorial-stage.js'
// Registering the shipped courses is a side effect of loading them — the
// runner never names a lesson, so a course can grow without touching this file.
import './lessons/starter.lessons.js'
import './lessons/beginner.lessons.js'
import './lessons/intermediate.lessons.js'
import './lessons/expert.lessons.js'

type Pt = { x: number; y: number }
type Axial = { q: number; r: number }
type CellCountPayload = { count: number; labels?: string[]; coords?: Axial[]; branchLabels?: string[] }
type LineageApi = { explorerSegments(): readonly string[]; explorerEnter(name: string): void; explorerUp(): void }
type NavigationApi = { goRaw(segments: readonly string[]): void; segmentsRaw?(): readonly string[] }
type SelectionApi = { add(label: string): void; clear(): void; count: number }

const OVERLAY_KEY = '@diamondcoreprocessor.com/BeeTutorialOverlay'

class TutorialAborted extends Error {
  constructor() { super('tutorial aborted') }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Rendered labels are canonical slugs (every non-letter/number folds to '-',
 *  lowercase) — compare typed names against them in slug space only. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

export type TutorialRequest = { level?: string; lesson?: string }

export class BeeTutorialDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  public override description =
    'A beeing flies the screen and teaches the hive — a course of independent lessons per level: starter, beginner, intermediate, expert.'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    navigation: '@hypercomb.social/Navigation',
  }

  protected override listens = [
    'tutorial:start', 'tutorial:stop',
    'render:host-ready', 'render:mesh-offset', 'render:set-orientation',
    'render:geometry-changed', 'render:cell-count',
  ]
  protected override emits = [
    'search:prefill', 'command-line:remote-submit', 'cell:attach-resource',
    'keymap:invoke', 'mobile:input-visible', 'tile:action',
  ]

  // the tour is effect-driven, never pulse-driven
  protected override sense = (): boolean => false

  #canvas: HTMLCanvasElement | null = null
  #container: { toGlobal(p: Pt): Pt } | null = null
  #renderer: { screen?: { width: number; height: number } } | null = null
  #meshOffset: Pt = { x: 0, y: 0 }
  #flat = false
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #cells: CellCountPayload | null = null

  #running = false
  #cancelled = false

  /** Names pre-locked via `cell:attach-pending` so the substrate can never
   *  assign a default image before the tutorial's custom cover lands. */
  readonly #locked = new Set<string>()

  /** Cover resource sigs stored this run — written into the provenance record. */
  #coverSigs: string[] = []

  /** The disposable practice page opened this run — deleted at cleanup AND on
   *  abort; a crash leftover is reclaimed by the provenance GC next start. */
  #sandbox: { name: string; base: readonly string[] } | null = null

  /** The course being run, and its GROUP SIGNATURE — everything this run mints
   *  carries it, so a course's artifacts add and delete as one unit. */
  #level: TutorialLevel = 'starter'
  #groupSig = ''

  constructor() {
    super()

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#canvas = payload.canvas
      this.#container = payload.container as unknown as { toGlobal(p: Pt): Pt }
      this.#renderer = payload.renderer as unknown as { screen?: { width: number; height: number } }
    })
    this.onEffect<Pt>('render:mesh-offset', (offset) => { this.#meshOffset = offset })
    this.onEffect<{ flat: boolean }>('render:set-orientation', ({ flat }) => { this.#flat = !!flat })
    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => { this.#geo = geo })
    this.onEffect<CellCountPayload>('render:cell-count', (payload) => { this.#cells = payload })

    this.onEffect<TutorialRequest>('tutorial:start', (request) => { void this.#run(request ?? {}) })
    this.onEffect('tutorial:stop', () => { this.#stop() })
  }

  // -----------------------------------------------
  // run / stop
  // -----------------------------------------------

  #stop(): void {
    this.#cancelled = true
    this.#overlay()?.dismiss()
  }

  #overlay(): BeeTutorialOverlayElement | undefined {
    return window.ioc.get<BeeTutorialOverlayElement>(OVERLAY_KEY) ?? undefined
  }

  /** Which lessons this request means. A named lesson runs alone (in its own
   *  course's context); a level runs its whole course in curriculum order. */
  #resolveLessons(request: TutorialRequest): { level: TutorialLevel; lessons: TutorialLesson[] } {
    const named = request.lesson ? tutorialLessons.get(request.lesson) : undefined
    if (named) return { level: named.level, lessons: [named] }
    const level = (request.level ?? 'starter') as TutorialLevel
    const lessons = tutorialLessons.course(level)
    if (lessons.length > 0) return { level, lessons }
    return { level: 'starter', lessons: tutorialLessons.course('starter') }
  }

  async #run(request: TutorialRequest): Promise<void> {
    if (this.#running) return
    const overlay = await this.#awaitOverlay()
    if (!overlay) {
      console.warn('[tutorial] overlay surface unavailable — is the shell-surfaces host mounted?')
      return
    }

    const { level, lessons } = this.#resolveLessons(request)
    if (lessons.length === 0) {
      console.warn('[tutorial] no lessons available for', request)
      return
    }

    this.#running = true
    this.#cancelled = false
    this.#coverSigs = []
    this.#level = level
    this.#groupSig = await courseSignature(level).catch(() => '')
    overlay.onSkipRequested = () => { this.#cancelled = true }
    overlay.activate()

    try {
      await this.#course(overlay, level, lessons)
      await overlay.waggle()
    } catch (err) {
      if (!(err instanceof TutorialAborted)) console.warn('[tutorial] tour ended early', err)
    } finally {
      await this.#deleteSandbox() // the practice page is disposable by contract
      this.#unlockAll() // an aborted tour must never leave substrate locks behind
      overlay.hideBubble()
      overlay.highlight(null)
      try { await overlay.flyOff() } catch { /* window may be gone */ }
      overlay.deactivate()
      overlay.onSkipRequested = null
      this.#running = false
    }
  }

  #awaitOverlay(): Promise<BeeTutorialOverlayElement | undefined> {
    const now = this.#overlay()
    if (now) return Promise.resolve(now)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(this.#overlay()), 3000)
      window.ioc.whenReady?.(OVERLAY_KEY, (el: BeeTutorialOverlayElement) => {
        clearTimeout(timer)
        resolve(el)
      })
    })
  }

  /** Cancellation checkpoint — every step boundary passes through here. */
  #ck(): void {
    if (this.#cancelled) throw new TutorialAborted()
  }

  async #pause(ms: number): Promise<void> {
    await sleep(ms)
    this.#ck()
  }

  // -----------------------------------------------
  // the course
  // -----------------------------------------------

  async #course(overlay: BeeTutorialOverlayElement, level: TutorialLevel, lessons: TutorialLesson[]): Promise<void> {
    // A selection URL (`/…/[a,b]`) is a filter, not a place. Scripted
    // navigation must never stack a path on top of a bracket segment
    // (phantom-path self-heal is deliberately off) — start from the real
    // location with the selection dropped.
    const nav = this.resolve<NavigationApi>('navigation')
    const raw = nav?.segmentsRaw?.() ?? []
    if (raw.some(s => s.startsWith('['))) {
      window.ioc.get<SelectionApi>('@diamondcoreprocessor.com/SelectionService')?.clear()
      nav?.goRaw(raw.filter(s => !s.startsWith('[')))
      await this.#pause(400)
    }

    // a PRIOR run's untouched practice page is tour-owned scratch — GC it first
    // so every course runs on a clean stage
    await this.#gcPriorPractice()

    const center = this.#canvasCenter()

    // ---- welcome -------------------------------------------------------
    await overlay.flyTo(center.x - 120, Math.max(150, center.y * 0.55))
    const opening = await overlay.say({
      chip: this.#t(`tutorial.chip.welcome.${level}`, this.#t('tutorial.chip.welcome', 'Welcome')),
      text: this.#t(`tutorial.welcome.${level}`, this.#t('tutorial.welcome',
        'Hi — I’m a beeing! This is Hypercomb, a world made of hexagonal tiles. Let me fly you around and show you how everything works.')),
      continueLabel: this.#t('tutorial.btn.start', 'Let’s go'),
      skipLabel: this.#t('tutorial.btn.not-now', 'Not now'),
    })
    if (opening !== 'continue') throw new TutorialAborted()
    this.#ck()

    // ---- open the empty practice page — every lesson happens inside it ---
    const practice = await this.#openPractice(overlay)
    const stage = this.#stage(overlay, level, practice)

    // ---- the lessons ----------------------------------------------------
    let recorded = false
    for (const lesson of lessons) {
      this.#ck()
      if (lesson.requires?.() === false) continue
      try {
        await lesson.run(stage)
      } catch (err) {
        if (err instanceof TutorialAborted) throw err
        // One lesson failing must never take the course down — the bee moves
        // on and the participant still gets the rest.
        console.warn(`[tutorial] lesson "${lesson.id}" ended early`, err)
        overlay.highlight(null)
      }
      // Every lesson leaves the stage as it found it: back at the practice
      // page's own level, nothing selected, no ring left burning.
      await this.#returnToPractice(practice)
      window.ioc.get<SelectionApi>('@diamondcoreprocessor.com/SelectionService')?.clear()
      overlay.highlight(null)

      // An EMPTY page has not materialized yet, so the record written when it
      // opened carries a null sig. Re-write it once the first lesson has put
      // something on it — from here a crash leaves a leftover the GC can find
      // AND a merkle sig it can compare.
      if (!recorded && (this.#cells?.labels?.length ?? 0) > 0) {
        recorded = true
        await this.#writePracticeRecord(practice.base, practice.name)
      }
    }

    // ---- tidy the practice page away ------------------------------------
    await this.#cleanupPractice(overlay, practice)

    // ---- recap ----------------------------------------------------------
    const recapCenter = this.#canvasCenter()
    await overlay.flyTo(recapCenter.x, recapCenter.y - 60)
    await this.#speak(overlay, `done.${level}`, this.#t('tutorial.chip.done', 'All set'),
      this.#t('tutorial.done',
        'That’s the basics! Click to go in · Shift+click to go out · type a name to create · wheel zooms · Space drags · Home resets. Type /help whenever you want more. Happy building!'),
      this.#t('tutorial.btn.finish', 'Finish'))
  }

  // -----------------------------------------------
  // the stage handed to every lesson
  // -----------------------------------------------

  #stage(overlay: BeeTutorialOverlayElement, level: TutorialLevel, practice: { name: string; base: readonly string[] }): TutorialStage {
    const selection = (): SelectionApi | undefined =>
      window.ioc.get<SelectionApi>('@diamondcoreprocessor.com/SelectionService')

    return {
      level,
      practice,

      say: (chip, chipFallback, text, opts) =>
        this.#speak(overlay, chip, chipFallback, text, opts?.continueLabel, opts?.key, opts?.params),
      t: (key, fallback, params) => this.#t(key, fallback, params),

      flyTo: (x, y) => overlay.flyTo(x, y),
      flyToCell: (label) => this.#hoverCell(overlay, label),
      flyToRect: async (rect) => {
        if (!rect) {
          const c = this.#canvasCenter()
          await overlay.flyTo(c.x, Math.max(120, c.y - 90))
          return
        }
        // Below a top strip, above a bottom one — never on top of the thing.
        const below = rect.top < window.innerHeight / 2
        await overlay.flyTo(
          rect.left + rect.width / 2,
          below ? rect.top + rect.height + 46 : rect.top - 46,
        )
        overlay.highlight(rect)
      },
      highlight: (target) => overlay.highlight(target),
      ghostClick: (x, y, opts) => overlay.ghostClick(x, y, opts ?? {}),

      enterCell: async (label) => {
        const point = this.#cellClientPoint(label) ?? this.#canvasCenter()
        await overlay.ghostClick(point.x, point.y)
        await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(label))
        await this.#pause(400)
      },
      leave: async () => {
        const c = this.#canvasCenter()
        await overlay.ghostClick(c.x - 120, c.y + 80, { shift: true })
        // The REAL gesture rides window.history.back(); the scripted tour uses
        // explorerUp() — same destination, but synchronous and incapable of
        // walking the browser out of the app when tab history is shallow.
        await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerUp())
        await this.#pause(400)
      },
      leaveTo: async (depth) => {
        const lineage = this.resolve<LineageApi>('lineage')
        let guard = 0
        while ((lineage?.explorerSegments?.() ?? []).length > depth && guard++ < 12) {
          await this.#navigate(() => lineage?.explorerUp())
        }
      },
      goHome: async () => {
        await this.#navigate(() => this.resolve<NavigationApi>('navigation')?.goRaw([]))
        await this.#pause(400)
      },
      depth: () => (this.resolve<LineageApi>('lineage')?.explorerSegments?.() ?? []).length,

      typeAndSubmit: (text, slow = true) => this.#typeAndSubmit(text, slow),
      invoke: (cmd) => { this.emitEffect('keymap:invoke', { cmd, binding: null, event: null }) },
      emit: (effect, payload) => { this.emitEffect(effect, payload) },

      create: (name, cover) => this.#create(name, cover),
      createMany: (names, cover) => this.#createMany(names, cover),
      editCell: async (label) => {
        const cells = this.#cells
        const wanted = slug(label)
        const index = (cells?.labels ?? []).findIndex(l => slug(l) === wanted)
        const axial = index >= 0 ? cells?.coords?.[index] : undefined
        if (index < 0 || !axial) return
        // Same payload the pencil icon sends — TileEditorDrone opens from here.
        this.emitEffect('tile:action', { action: 'edit', q: axial.q, r: axial.r, index, label: cells?.labels?.[index] ?? label })
        await this.#pause(300)
      },

      select: (labels) => {
        const sel = selection()
        for (const label of labels) {
          const rendered = this.#renderedLabel(label)
          if (rendered) sel?.add(rendered)
        }
      },
      clearSelection: () => { selection()?.clear() },
      selectionCount: () => selection()?.count ?? 0,

      labels: () => this.#cells?.labels ?? [],
      point: (label) => this.#cellClientPoint(label),
      radius: () => this.#cellClientRadius(),
      center: () => this.#canvasCenter(),
      chrome: (key) => this.#buttonRect(key),
      commandInput: () => this.#commandInputRect(),
      breadcrumb: () => this.#breadcrumbRect(),
      element: (selector) => this.#elementRect(selector),

      wait: (ms) => this.#pause(ms),
      waitForLabel: (name) => this.#waitForLabel(name),
      waitForCells: (pred, timeoutMs = 8000) =>
        this.#waitForCells(p => pred((p?.labels ?? []).map(l => String(l))), timeoutMs),
      check: () => this.#ck(),
    }
  }

  /** The label as RENDERED (canonical slug) for a name a lesson knows. */
  #renderedLabel(name: string): string | null {
    const wanted = slug(name)
    return this.#cells?.labels?.find(l => slug(l) === wanted) ?? null
  }

  // -----------------------------------------------
  // the practice page
  // -----------------------------------------------

  /** Open a clean practice page (a transient tile at the participant's
   *  location) — every lesson happens inside it, and it is tidied away at the
   *  end, on abort, and by the provenance GC after a crash. */
  async #openPractice(overlay: BeeTutorialOverlayElement): Promise<{ name: string; base: readonly string[] }> {
    await this.#speak(overlay, 'practice', 'Practice page',
      'First, let me open a clean practice page — nothing on your pages will change, and I’ll tidy it away when we’re done.')

    const base = [...(this.resolve<LineageApi>('lineage')?.explorerSegments?.() ?? [])]
    const name = this.#freeName(this.#t('tutorial.name.sandbox', 'Bee Tutorial'))
    this.#lock(name) // the materialized page tile must never get a substrate image
    this.#sandbox = { name, base }
    await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(name))
    await this.#pause(400)

    // Record it in the sign('tutorial:artifacts') pool STAMPED WITH THE COURSE'S
    // GROUP SIGNATURE, so a crashed run's leftover is reclaimed at the next
    // start and every artifact of this course is addressable as one group.
    await this.#writePracticeRecord(base, name)
    return { name, base }
  }

  async #writePracticeRecord(base: readonly string[], name: string): Promise<void> {
    try {
      await writeTutorialRecord({
        label: slug(name),
        segments: base,
        plannerSig: await tutorialPlannerSig(base, slug(name)),
        coverSigs: this.#coverSigs,
        updatedAt: Date.now(),
        transient: true,
        groupSig: this.#groupSig,
        groupMeaning: courseMeaning(this.#level),
      })
    } catch (err) { console.warn('[tutorial] provenance record failed', err) }
  }

  /** Back to the practice page's own level after a lesson wandered off. */
  async #returnToPractice(practice: { name: string; base: readonly string[] }): Promise<void> {
    const lineage = this.resolve<LineageApi>('lineage')
    const want = practice.base.length + 1
    const here = (lineage?.explorerSegments?.() ?? []).length
    if (here === want) return
    if (here > want) {
      let guard = 0
      while ((lineage?.explorerSegments?.() ?? []).length > want && guard++ < 12) {
        await this.#navigate(() => lineage?.explorerUp())
      }
      return
    }
    // A lesson went Home (or above the page) — walk straight back to it.
    const nav = this.resolve<NavigationApi>('navigation')
    await this.#navigate(() => nav?.goRaw([...practice.base, practice.name]))
    await this.#pause(300)
  }

  /** The practice page is disposable by contract — step out to where it was
   *  minted, show it once, then tidy it away for real. */
  async #cleanupPractice(overlay: BeeTutorialOverlayElement, practice: { name: string; base: readonly string[] }): Promise<void> {
    this.#ck()
    const nav = this.resolve<NavigationApi>('navigation')
    await this.#navigate(() => nav?.goRaw([...practice.base]))
    await this.#pause(350)

    const target = this.#renderedLabel(practice.name) ?? slug(practice.name)
    const point = this.#cellClientPoint(target)
    if (point) {
      await overlay.flyTo(point.x, point.y - this.#cellClientRadius() - 22)
      overlay.highlight({ x: point.x, y: point.y, r: this.#cellClientRadius() + 8 })
    }
    await this.#speak(overlay, 'practice', 'Practice page',
      'That was our practice page — watch me tidy it away. Build the real thing on any page: you know how now.',
      undefined, 'tutorial.cleanup')
    overlay.highlight(null)

    if (point) await overlay.ghostClick(point.x, point.y)
    const before = this.#cells
    await this.#deleteSandbox()
    await this.#waitForCells(p => p !== before, 6000)
    await this.#pause(400)
  }

  /** Remove the practice page (idempotent — also runs on the abort path). */
  async #deleteSandbox(): Promise<void> {
    const practice = this.#sandbox
    if (!practice) return
    this.#sandbox = null
    try {
      const target = this.#renderedLabel(practice.name) ?? slug(practice.name)
      await removeTilesAt(practice.base, [target])
      await clearTutorialRecord(practice.base)
      await new hypercomb().act()
    } catch (err) {
      console.warn('[tutorial] practice cleanup failed', err)
    }
  }

  /** Provenance-gated GC of a PRIOR run's leftover at this location. The
   *  transient practice page (advertised as tidied-away) is reclaimed
   *  unconditionally; anything recorded WITHOUT the transient flag stays
   *  merkle-sig-gated — diverged means adopted, theirs forever. */
  async #gcPriorPractice(): Promise<void> {
    try {
      const segments = [...(this.resolve<LineageApi>('lineage')?.explorerSegments?.() ?? [])]
      const record = await readTutorialRecord(segments)
      if (!record) return
      const current = await tutorialPlannerSig(segments, record.label)
      if (!current) { await clearTutorialRecord(segments); return } // already gone
      if (!record.transient && (!record.plannerSig || current !== record.plannerSig)) return // adopted
      const removed = await removeTilesAt(segments, [record.label])
      if (!removed) return
      await clearTutorialRecord(segments)
      await new hypercomb().act()
      const wanted = slug(record.label)
      await this.#waitForCells(p => !p?.labels?.some(l => slug(l) === wanted), 4000)
    } catch (err) {
      console.warn('[tutorial] practice GC skipped', err)
    }
  }

  // -----------------------------------------------
  // demonstrated actions — always the real paths
  // -----------------------------------------------

  async #typeAndSubmit(name: string, slow: boolean): Promise<void> {
    if (window.matchMedia('(max-width: 599px), (max-height: 599px)').matches) {
      this.emitEffect('mobile:input-visible', { visible: true, mobile: true })
    }
    this.emitEffect('keymap:invoke', { cmd: 'ui.commandLineToggle' })

    if (slow) {
      const per = name.length > 30 ? 14 : 36 // long lines type brisker
      for (let i = 1; i <= name.length; i++) {
        this.#ck()
        this.emitEffect('search:prefill', { value: name.slice(0, i) })
        await sleep(per + ((i * 13) % 3) * (per / 2))
      }
      await this.#pause(280)
    } else {
      this.emitEffect('search:prefill', { value: name })
      await this.#pause(170)
    }
    this.emitEffect('command-line:remote-submit', { text: name })
  }

  /** One tile, created the way a participant creates one, with its cover baked
   *  while the bee is still talking so the attach at reveal is instant. */
  async #create(name: string, cover?: CoverFactory): Promise<string> {
    const free = this.#freeName(name)
    const ready = cover ? this.#storeCover(cover()) : Promise.resolve(null)
    this.#lock(free)
    await this.#typeAndSubmit(free, true)
    await this.#waitForLabel(free)
    this.#attachStored(free, await ready)
    await this.#pause(500)
    return this.#renderedLabel(free) ?? free
  }

  /** Several tiles in ONE bracket commit — the atomic path `[a, b, c]`. */
  async #createMany(names: readonly string[], cover?: (index: number) => Promise<Blob>): Promise<string[]> {
    const free = names.map(n => this.#freeName(n))
    const ready = free.map((_, i) => (cover ? this.#storeCover(cover(i)) : Promise.resolve(null)))
    for (const name of free) this.#lock(name)

    await this.#typeAndSubmit(`[${free.join(', ')}]`, true)
    // Only TOP-LEVEL names land on this page — a bracket item carrying a path
    // creates at depth, and its leaf never renders here.
    const tops = free.map(n => slug(n.split('/')[0] ?? n))
    const ok = await this.#waitForCells(
      p => tops.every(w => !!p?.labels?.some(l => slug(l) === w)), 12000)
    if (!ok) console.warn('[tutorial] not all bracket tiles appeared in time')
    this.#ck()

    // the bracket leaves the newborns selected — tidy the stage
    window.ioc.get<SelectionApi>('@diamondcoreprocessor.com/SelectionService')?.clear()

    const stored = await Promise.all(ready)
    free.forEach((name, i) => {
      if (name.includes('/')) { this.#unlock(name); return } // lives a level down
      this.#attachStored(name, stored[i])
    })
    await this.#pause(600)
    return free.map(n => this.#renderedLabel(n) ?? n)
  }

  /** Substrate lock — no default image may ever appear on a tutorial tile.
   *  ResourceAttachDrone releases the lock itself after the cover's canonical
   *  write; #unlockAll covers aborted tours. */
  #lock(cell: string): void {
    this.#locked.add(cell)
    this.emitEffect('cell:attach-pending', { cell, pending: true })
  }

  #unlock(cell: string): void {
    this.#locked.delete(cell)
    this.emitEffect('cell:attach-pending', { cell, pending: false })
  }

  #unlockAll(): void {
    for (const cell of [...this.#locked]) this.#unlock(cell)
    this.#locked.clear()
  }

  /** Pre-store a cover's resources so the attach at reveal time is instant. */
  async #storeCover(blobPromise: Promise<Blob>): Promise<ImageResources | null> {
    try {
      const res = await storeImageResources(await blobPromise)
      if (res) { try { URL.revokeObjectURL(res.previewUrl) } catch { /* never shown */ } }
      return res
    } catch (err) {
      console.warn('[tutorial] cover generation failed', err)
      return null
    }
  }

  #attachStored(cell: string, res: ImageResources | null): void {
    this.#locked.delete(cell) // the attach path releases the pending lock itself
    if (!res) {
      this.emitEffect('cell:attach-pending', { cell, pending: false })
      return
    }
    this.#coverSigs.push(res.largeSig)
    if (res.smallPointSig) this.#coverSigs.push(res.smallPointSig)
    if (res.smallFlatSig) this.#coverSigs.push(res.smallFlatSig)
    this.emitEffect('cell:attach-resource', {
      cell,
      largeSig: res.largeSig,
      smallPointSig: res.smallPointSig,
      smallFlatSig: res.smallFlatSig,
      url: null,
      type: 'image',
    })
  }

  /** Run a navigation and wait for the renderer to publish the new level. */
  async #navigate(go: () => void): Promise<void> {
    const before = this.#cells
    go()
    await this.#waitForCells(p => p !== before, 4500)
    this.#ck()
  }

  // -----------------------------------------------
  // waiting on the renderer
  // -----------------------------------------------

  #waitForCells(pred: (p: CellCountPayload | null) => boolean, timeoutMs: number): Promise<boolean> {
    if (pred(this.#cells)) return Promise.resolve(true)
    return new Promise(resolve => {
      let unsub: (() => void) | null = null
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsub?.()
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      unsub = EffectBus.on<CellCountPayload>('render:cell-count', p => {
        if (pred(p)) finish(true)
      })
      if (settled) unsub()
    })
  }

  async #waitForLabel(name: string): Promise<void> {
    const wanted = slug(name)
    // generous — during a bracket speed-run renders arrive in bursts
    const ok = await this.#waitForCells(p => !!p?.labels?.some(l => slug(l) === wanted), 12000)
    if (!ok) console.warn('[tutorial] tile did not appear in time:', name)
    this.#ck()
  }

  #freeName(base: string): string {
    const taken = new Set((this.#cells?.labels ?? []).map(slug))
    if (!taken.has(slug(base))) return base
    for (let k = 2; k < 50; k++) {
      const candidate = `${base} ${k}`
      if (!taken.has(slug(candidate))) return candidate
    }
    return `${base} ${Date.now() % 1000}`
  }

  // -----------------------------------------------
  // geometry: cell → client pixels
  // -----------------------------------------------

  #axialToWorld(q: number, r: number): Pt {
    const s = this.#geo.spacing
    return this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: 1.5 * s * r }
  }

  #worldToClient(w: Pt): Pt | null {
    if (!this.#container || !this.#canvas) return null
    const global = this.#container.toGlobal({ x: w.x + this.#meshOffset.x, y: w.y + this.#meshOffset.y })
    const rect = this.#canvas.getBoundingClientRect()
    const screen = this.#renderer?.screen
    const sx = screen?.width ? rect.width / screen.width : 1
    const sy = screen?.height ? rect.height / screen.height : 1
    return { x: rect.left + global.x * sx, y: rect.top + global.y * sy }
  }

  #cellClientPoint(label: string): Pt | null {
    const cells = this.#cells
    if (!cells?.labels || !cells.coords) return null
    const wanted = slug(label)
    const index = cells.labels.findIndex(l => slug(l) === wanted)
    if (index < 0) return null
    const axial = cells.coords[index]
    if (!axial) return null
    return this.#worldToClient(this.#axialToWorld(axial.q, axial.r))
  }

  /** Hex circumradius in client pixels (for highlight rings). */
  #cellClientRadius(): number {
    const a = this.#worldToClient({ x: 0, y: 0 })
    const b = this.#worldToClient({ x: this.#geo.circumRadiusPx, y: 0 })
    if (!a || !b) return 40
    return Math.max(18, Math.hypot(b.x - a.x, b.y - a.y))
  }

  #canvasCenter(): Pt {
    const rect = this.#canvas?.getBoundingClientRect()
    if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  // -----------------------------------------------
  // chrome targets
  // -----------------------------------------------

  #elementRect(selector: string): StageRect | null {
    const node = document.querySelector<HTMLElement>(selector)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    return rect.width > 4 && rect.height > 4 ? rect : null
  }

  #commandInputRect(): StageRect | null {
    return this.#elementRect('hc-command-line input.command-input')
  }

  /** The address bar — the breadcrumb strip in the controls bar (desktop). */
  #breadcrumbRect(): StageRect | null {
    return this.#elementRect('hc-controls-bar .breadcrumb-top')
  }

  /** Locate a controls-bar button by its localized aria-label. */
  #buttonRect(i18nKey: string): StageRect | null {
    const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
    const label = i18n?.t(i18nKey)
    if (!label || label === i18nKey) return null
    const nodes = document.querySelectorAll<HTMLElement>(`button[aria-label="${CSS.escape(label)}"]`)
    for (const node of Array.from(nodes)) {
      const rect = node.getBoundingClientRect()
      if (rect.width > 4 && rect.height > 4) return rect
    }
    return null
  }

  // -----------------------------------------------
  // speech
  // -----------------------------------------------

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
    const resolved = i18n?.t(key, params)
    if (resolved && resolved !== key) return resolved
    return fallback.replace(/\{(\w+)\}/g, (_, token) => String(params?.[token] ?? `{${token}}`))
  }

  /** One Continue-gated bubble. `skip` result aborts the course. */
  async #speak(
    overlay: BeeTutorialOverlayElement,
    chipId: string,
    chipFallback: string,
    fallbackText: string,
    continueLabel?: string,
    textKey?: string,
    params?: Record<string, string | number>,
  ): Promise<void> {
    this.#ck()
    const result: SayResult = await overlay.say({
      chip: this.#t(`tutorial.chip.${chipId}`, chipFallback),
      text: this.#t(textKey ?? `tutorial.${chipId}`, fallbackText, params),
      continueLabel: continueLabel ?? this.#t('tutorial.btn.continue', 'Continue'),
      skipLabel: this.#t('tutorial.btn.skip', 'Skip tour'),
    })
    if (result === 'skip') throw new TutorialAborted()
    this.#ck()
  }

  async #hoverCell(overlay: BeeTutorialOverlayElement, label: string): Promise<void> {
    const point = this.#cellClientPoint(label)
    if (!point) {
      const c = this.#canvasCenter()
      await overlay.flyTo(c.x, c.y - 60)
      return
    }
    const r = this.#cellClientRadius()
    await overlay.flyTo(point.x, point.y - r - 24)
    overlay.highlight({ x: point.x, y: point.y, r: r + 8 })
  }
}

const _beeTutorial = new BeeTutorialDrone()
window.ioc.register('@diamondcoreprocessor.com/BeeTutorialDrone', _beeTutorial)
