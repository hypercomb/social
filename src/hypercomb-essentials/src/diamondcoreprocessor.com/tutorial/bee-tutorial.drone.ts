// diamondcoreprocessor.com/tutorial/bee-tutorial.drone.ts
//
// A beeing gives complete beginners a guided tour: going into and out of
// tiles with the mouse, creating a tile from the command line, giving it
// seven children, travelling between them, zoom, pan, and Home. Every
// demonstrated action runs through the SAME paths a real user action takes —
// `Lineage.explorerEnter` / `Navigation.back()` for movement, the command
// line's `search:prefill` + `command-line:remote-submit` for creation, and
// `cell:attach-resource` for the professional cover images — so what the
// participant watches is exactly what will happen when they do it.
//
// The tour is Continue-gated: after each explanation the bee waits for the
// participant, so they can think about it, then continue. Escape or the
// Skip button ends it at any point. Start with /tutorial (alias /tour).

import { Drone, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { removeTilesAt } from '../commands/remove.queen.js'
import { readTutorialRecord, writeTutorialRecord, clearTutorialRecord, tutorialPlannerSig } from './tutorial-provenance.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { storeImageResources, type ImageResources } from '../editor/arm-resource.js'
import { plannerCoverImage, dayCoverImage } from './tutorial-images.js'
import type { BeeTutorialOverlayElement, SayResult } from './tutorial-overlay.view.js'

type Pt = { x: number; y: number }
type Axial = { q: number; r: number }
type CellCountPayload = { count: number; labels?: string[]; coords?: Axial[]; branchLabels?: string[] }
type LineageApi = { explorerSegments(): readonly string[]; explorerEnter(name: string): void; explorerUp(): void }
type NavigationApi = { goRaw(segments: readonly string[]): void; segmentsRaw?(): readonly string[] }

const OVERLAY_KEY = '@diamondcoreprocessor.com/BeeTutorialOverlay'

class TutorialAborted extends Error {
  constructor() { super('tutorial aborted') }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Rendered labels are canonical slugs (every non-letter/number folds to '-',
 *  lowercase) — compare typed names against them in slug space only. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

export class BeeTutorialDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  public override description =
    'A beeing flies the screen and teaches the basics: enter and leave tiles, create from the command line, children, travel, zoom, pan, Home.'

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
    'keymap:invoke', 'mobile:input-visible',
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

    this.onEffect('tutorial:start', () => { void this.#run() })
    this.onEffect('tutorial:stop', () => { this.#stop() })
  }

  // -----------------------------------------------
  // run / stop
  // -----------------------------------------------

  #stop(): void {
    this.#cancelled = true
    const overlay = this.#overlay()
    overlay?.dismiss()
  }

  #overlay(): BeeTutorialOverlayElement | undefined {
    return window.ioc.get<BeeTutorialOverlayElement>(OVERLAY_KEY) ?? undefined
  }

  async #run(): Promise<void> {
    if (this.#running) return
    const overlay = await this.#awaitOverlay()
    if (!overlay) {
      console.warn('[tutorial] overlay surface unavailable — is the shell-surfaces host mounted?')
      return
    }

    this.#running = true
    this.#cancelled = false
    this.#coverSigs = []
    overlay.onSkipRequested = () => { this.#cancelled = true }
    overlay.activate()

    try {
      await this.#script(overlay)
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
  // the script
  // -----------------------------------------------

  async #script(overlay: BeeTutorialOverlayElement): Promise<void> {
    // A selection URL (`/…/[a,b]`) is a filter, not a place. Scripted
    // navigation must never stack a path on top of a bracket segment
    // (phantom-path self-heal is deliberately off) — start from the real
    // location with the selection dropped.
    const nav = this.resolve<NavigationApi>('navigation')
    const raw = nav?.segmentsRaw?.() ?? []
    if (raw.some(s => s.startsWith('['))) {
      window.ioc.get<{ clear(): void }>('@diamondcoreprocessor.com/SelectionService')?.clear()
      nav?.goRaw(raw.filter(s => !s.startsWith('[')))
      await this.#pause(400)
    }

    // a PRIOR run's untouched practice planner is tour-owned scratch — GC it
    // first so every tour runs the full create arc on a clean stage
    await this.#gcPriorPractice()

    const center = this.#canvasCenter()

    // ---- welcome -------------------------------------------------------
    await overlay.flyTo(center.x - 120, Math.max(150, center.y * 0.55))
    const opening = await overlay.say({
      chip: this.#t('tutorial.chip.welcome', 'Welcome'),
      text: this.#t('tutorial.welcome', 'Hi — I’m a beeing! This is Hypercomb, a world made of hexagonal tiles. Let me fly you around and show you how everything works.'),
      continueLabel: this.#t('tutorial.btn.start', 'Let’s go'),
      skipLabel: this.#t('tutorial.btn.not-now', 'Not now'),
    })
    if (opening !== 'continue') throw new TutorialAborted()
    this.#ck()

    // ---- open the empty practice page — the whole tour happens there ----
    const practice = await this.#stepOpenPractice(overlay)

    // ---- create → go in → go out → children → travel, all on the stage --
    const plannerName = await this.#stepCreatePlanner(overlay)
    await this.#stepGoIn(overlay, plannerName)
    await this.#stepGoOut(overlay)
    const dayNames = await this.#stepChildren(overlay, plannerName)
    await this.#stepTravel(overlay, dayNames)

    // ---- zoom (the stage is nicely busy now) ----------------------------
    await overlay.flyTo(center.x + 40, center.y - 60)
    await this.#speak(overlay, 'zoom', 'Zoom',
      'Roll the mouse wheel to zoom in and out — pinch on a touch screen. A quick demo…')
    await this.#demoZoom()

    // ---- pan ------------------------------------------------------------
    await this.#speak(overlay, 'pan', 'Pan',
      'Hold the Space bar and drag to glide across the honeycomb. On touch screens, drag with two fingers.')

    // ---- tidy the practice page away ------------------------------------
    await this.#stepCleanup(overlay, practice)

    // ---- home -----------------------------------------------------------
    await this.#stepHome(overlay)

    // ---- recap ----------------------------------------------------------
    const recapCenter = this.#canvasCenter()
    await overlay.flyTo(recapCenter.x, recapCenter.y - 60)
    await this.#speak(overlay, 'done', 'All set',
      'That’s the basics! Click to go in · Shift+click to go out · type a name to create · wheel zooms · Space drags · Home resets. Type /help whenever you want more. Happy building!',
      this.#t('tutorial.btn.finish', 'Finish'))
  }

  // -----------------------------------------------
  // steps
  // -----------------------------------------------

  async #stepGoIn(overlay: BeeTutorialOverlayElement, label: string): Promise<void> {
    await this.#hoverCell(overlay, label)
    await this.#speak(overlay, 'go-in', 'Going in',
      'To go inside a tile, just left-click it. Watch me!')

    const point = this.#cellClientPoint(label) ?? this.#canvasCenter()
    overlay.highlight(null)
    await overlay.ghostClick(point.x, point.y)
    await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(label))
    await this.#pause(400)

    // point out the address (breadcrumb) while explaining where we are
    const crumb = this.#breadcrumbRect()
    if (crumb) {
      await overlay.flyTo(crumb.left - 44, crumb.top + crumb.height / 2 + 10)
      overlay.highlight(crumb)
    } else {
      const center = this.#canvasCenter()
      await overlay.flyTo(center.x, center.y - 50)
    }
    await this.#speak(overlay, 'inside', 'Inside',
      'We’re in! Everything here lives inside “{cell}”. The address up here always shows where you are.',
      undefined, undefined, { cell: label })
    overlay.highlight(null)
  }

  async #stepGoOut(overlay: BeeTutorialOverlayElement): Promise<void> {
    const backRect = this.#buttonRect('controls.go-back')
    if (backRect) {
      await overlay.flyTo(backRect.left - 40, backRect.top + backRect.height / 2)
      overlay.highlight(backRect)
    }
    await this.#speak(overlay, 'go-out', 'Going out',
      'Three ways back out: right-click anywhere, hold Shift and click, or press the Back button. I’ll use Back.')
    overlay.highlight(null)

    if (backRect) {
      await overlay.ghostClick(backRect.left + backRect.width / 2, backRect.top + backRect.height / 2)
    }
    // The REAL gestures ride window.history.back(); the scripted tour uses
    // explorerUp() — same destination, but synchronous and incapable of
    // walking the browser out of the app when the tab's history is shallow.
    await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerUp())
    await this.#pause(400)

    const center = this.#canvasCenter()
    await overlay.flyTo(center.x - 80, center.y - 40)
    await this.#speak(overlay, 'back', 'Back',
      'And we’re back where we started. In and out — that’s the heartbeat of Hypercomb.')
  }

  /** Open a clean practice page (a transient tile at the participant's
   *  location) — the whole lesson happens inside it, and it is tidied away
   *  at the end, on abort, and by the provenance GC after a crash. */
  async #stepOpenPractice(overlay: BeeTutorialOverlayElement): Promise<{ name: string; base: readonly string[] }> {
    await this.#speak(overlay, 'practice', 'Practice page',
      'First, let me open a clean practice page — nothing on your pages will change, and I’ll tidy it away when we’re done.')

    const base = [...(this.resolve<LineageApi>('lineage')?.explorerSegments?.() ?? [])]
    const name = this.#freeName(this.#t('tutorial.name.sandbox', 'Bee Tutorial'))
    this.#lock(name) // the materialized page tile must never get a substrate image
    this.#sandbox = { name, base }
    await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(name))
    await this.#pause(400)
    return { name, base }
  }

  async #stepCreatePlanner(overlay: BeeTutorialOverlayElement): Promise<string> {
    const name = this.#freeName(this.#t('tutorial.name.planner', 'Weekly Planner'))
    const coverReady = this.#storeCover(plannerCoverImage()) // bake while we talk

    const inputRect = this.#commandInputRect()
    if (inputRect) {
      await overlay.flyTo(inputRect.left + inputRect.width / 2, inputRect.bottom + 46)
      overlay.highlight(inputRect)
    } else {
      const c = this.#canvasCenter()
      await overlay.flyTo(c.x, 120)
    }
    await this.#speak(overlay, 'create', 'Create',
      'This is the command line — the fastest way to build. Type a name and press Enter, and a tile is born. I’ll make “{name}”.',
      undefined, undefined, { name })
    overlay.highlight(null)

    this.#lock(name)
    await this.#typeAndSubmit(name, true)
    await this.#waitForLabel(name)
    this.#attachStored(name, await coverReady)

    // the practice page just materialized in the parent layer — record it in
    // the sign('tutorial:artifacts') pool so a crashed tour's leftover is
    // reclaimed at the next start (transient: no sig gate)
    if (this.#sandbox) {
      const sandbox = this.#sandbox
      try {
        await writeTutorialRecord({
          label: slug(sandbox.name),
          segments: sandbox.base,
          plannerSig: await tutorialPlannerSig(sandbox.base, slug(sandbox.name)),
          coverSigs: [],
          updatedAt: Date.now(),
          transient: true,
        })
      } catch (err) { console.warn('[tutorial] provenance record failed', err) }
    }
    await this.#pause(700)

    const point = this.#cellClientPoint(name)
    if (point) {
      await overlay.flyTo(point.x, point.y - this.#cellClientRadius() - 22)
      overlay.highlight({ x: point.x, y: point.y, r: this.#cellClientRadius() + 8 })
    }
    await this.#speak(overlay, 'your-tile', 'Your tile',
      'Meet “{name}” — a brand-new tile with a proper cover image. Anything you can name, you can make.',
      undefined, undefined, { name })
    overlay.highlight(null)
    return name
  }

  async #stepChildren(overlay: BeeTutorialOverlayElement, plannerName: string): Promise<string[]> {
    await this.#speak(overlay, 'children', 'Children',
      'Tiles hold tiles. Let’s step inside and give it seven children — one for each day of the week.',
      undefined, 'tutorial.children-intro')

    const point = this.#cellClientPoint(plannerName) ?? this.#canvasCenter()
    await overlay.ghostClick(point.x, point.y)
    await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(plannerName))
    await this.#pause(400)

    const dayFallbacks = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const dayNames = dayFallbacks.map((fb, i) => this.#t(`tutorial.name.day${i}`, fb))
    // bake all seven covers while the bubble is up; lock before anything commits
    const coversReady = dayNames.map((_, i) => this.#storeCover(dayCoverImage(i)))
    for (const name of dayNames) this.#lock(name)

    const inputRect = this.#commandInputRect()
    if (inputRect) {
      await overlay.flyTo(inputRect.left + inputRect.width / 2, inputRect.bottom + 46)
      overlay.highlight(inputRect)
    }
    await this.#speak(overlay, 'brackets', 'One line',
      'A power move: square brackets create many tiles at once. One line, seven days — watch!')
    overlay.highlight(null)

    // one atomic bracket create — all seven days in a single commit
    await this.#typeAndSubmit(`[${dayNames.join(', ')}]`, true)
    const wanted = dayNames.map(slug)
    const ok = await this.#waitForCells(
      p => wanted.every(w => !!p?.labels?.some(l => slug(l) === w)), 12000)
    if (!ok) console.warn('[tutorial] not all day tiles appeared in time')
    this.#ck()

    // the bracket leaves the newborns selected — tidy the stage
    window.ioc.get<{ clear(): void }>('@diamondcoreprocessor.com/SelectionService')?.clear()

    const stored = await Promise.all(coversReady)
    dayNames.forEach((name, i) => this.#attachStored(name, stored[i]))
    await this.#pause(700)

    const c = this.#canvasCenter()
    await overlay.flyTo(c.x, c.y - 80)
    await this.#speak(overlay, 'children', 'Children',
      'Monday through Sunday — seven child tiles, each with its own cover. Your world grows tile by tile, as deep as you like.',
      undefined, 'tutorial.children-done')
    return dayNames
  }

  async #stepTravel(overlay: BeeTutorialOverlayElement, dayNames: string[]): Promise<void> {
    await this.#speak(overlay, 'travel', 'Travel',
      'Now let’s travel between them, exactly like before: click a tile to go in, Shift+click to come back out.')

    const visit = async (label: string): Promise<void> => {
      const point = this.#cellClientPoint(label) ?? this.#canvasCenter()
      await overlay.flyTo(point.x, point.y - this.#cellClientRadius() - 22)
      await overlay.ghostClick(point.x, point.y)
      await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerEnter(label))
      await this.#pause(650)

      const c = this.#canvasCenter()
      await overlay.ghostClick(c.x - 120, c.y + 80, { shift: true })
      await this.#navigate(() => this.resolve<LineageApi>('lineage')?.explorerUp())
      await this.#pause(450)
    }

    await visit(dayNames[0])
    await visit(dayNames[4])

    const c = this.#canvasCenter()
    await overlay.flyTo(c.x - 60, c.y - 60)
    await this.#speak(overlay, 'travel', 'Travel',
      'In, out, and across — you can wander anywhere. You can’t get lost: Back and Home always know the way.',
      undefined, 'tutorial.travel-done')
  }

  /** The practice page is disposable by contract — step out to where it was
   *  minted, show it once, then tidy it away for real. */
  async #stepCleanup(overlay: BeeTutorialOverlayElement, practice: { name: string; base: readonly string[] }): Promise<void> {
    this.#ck()
    const lineage = this.resolve<LineageApi>('lineage')
    while ((lineage?.explorerSegments?.() ?? []).length > practice.base.length) {
      await this.#navigate(() => lineage?.explorerUp())
      this.#ck()
    }
    await this.#pause(350)

    const wanted = slug(practice.name)
    const target = this.#cells?.labels?.find(l => slug(l) === wanted) ?? wanted
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
      const wanted = slug(practice.name)
      const target = this.#cells?.labels?.find(l => slug(l) === wanted) ?? wanted
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

  async #stepHome(overlay: BeeTutorialOverlayElement): Promise<void> {
    const homeRect = this.#buttonRect('controls.home')
    if (homeRect) {
      await overlay.flyTo(homeRect.left - 40, homeRect.top + homeRect.height / 2)
      overlay.highlight(homeRect)
    }
    await this.#speak(overlay, 'home', 'Home',
      'And whenever you’re done exploring, the Home button brings you straight back to your front door.')
    overlay.highlight(null)

    if (homeRect) {
      await overlay.ghostClick(homeRect.left + homeRect.width / 2, homeRect.top + homeRect.height / 2)
    }
    await this.#navigate(() => this.resolve<NavigationApi>('navigation')?.goRaw([]))
    await this.#pause(400)
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
      const per = name.length > 30 ? 14 : 36 // long bracket lines type brisker
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

  /** Substrate lock — no default image may ever appear on a tutorial tile.
   *  ResourceAttachDrone releases the lock itself after the cover's canonical
   *  write; #unlockAll covers aborted tours. */
  #lock(cell: string): void {
    this.#locked.add(cell)
    this.emitEffect('cell:attach-pending', { cell, pending: true })
  }

  #unlockAll(): void {
    for (const cell of this.#locked) {
      this.emitEffect('cell:attach-pending', { cell, pending: false })
    }
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

  async #demoZoom(): Promise<void> {
    const zoom = window.ioc.get<{ zoomByFactor?: (f: number, pivot: Pt) => void }>('@diamondcoreprocessor.com/ZoomDrone')
    if (!zoom?.zoomByFactor) return
    const pivot = this.#canvasCenter()
    zoom.zoomByFactor(0.8, pivot)
    await this.#pause(650)
    zoom.zoomByFactor(1.25, pivot)
    await this.#pause(450)
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
    // generous — during the seven-child speed-run renders arrive in bursts
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

  #commandInputRect(): DOMRect | null {
    const input = document.querySelector<HTMLElement>('hc-command-line input.command-input')
    if (!input) return null
    const rect = input.getBoundingClientRect()
    return rect.width > 4 && rect.height > 4 ? rect : null
  }

  /** The address bar — the breadcrumb strip in the controls bar (desktop). */
  #breadcrumbRect(): DOMRect | null {
    const crumb = document.querySelector<HTMLElement>('hc-controls-bar .breadcrumb-top')
    if (!crumb) return null
    const rect = crumb.getBoundingClientRect()
    return rect.width > 4 && rect.height > 4 ? rect : null
  }

  /** Locate a controls-bar button by its localized aria-label. */
  #buttonRect(i18nKey: string): DOMRect | null {
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

  /** One Continue-gated bubble. `skip` result aborts the tour. */
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
