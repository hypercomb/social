// presentation/tiles/lift-view.drone.ts
//
// THE LIFT VIEW — the page's tiles lifted off the grid into 3D, with the
// page's other layers stacked behind it like a slide deck (jwize 2026-11-07).
//
// Superimposition (documentation/superimposition.md): a participant's version
// of a page is a LAYER over yours, and so is every earlier version of your
// own. The 2D hive already reads this — the participant stack (tile-stack.ts)
// and the spotlight roll — but one tile at a time. Lifted, the whole deck is
// in view at once: the page as drawn at the front, each participant's version
// behind it, then the page's history, newest first. Every tile wears a mark —
// the same everywhere, a different picture somewhere, missing somewhere — and
// where a deeper layer lacks a tile the front has, a ghost outline says so:
// absence must say why.
//
// Two gestures on one wheel. Over empty space the wheel flips the WHOLE deck,
// so another layer comes to the front. Over a tile it rolls THAT tile through
// its versions across the deck and stages the one you stop on — changing
// parts. Nothing is written while you look: Apply carries the choice through
// the hive's existing doors only — the spotlight for a participant's whole
// layer (a view, as the 2D roll), `promoteToHead` for a history version (as
// the rewind window's Save), `adoptResolvedBranch` for a participant's tile
// (as the adopt gesture). And never while the hive is showing the past.
//
// Pixi's 3D is loaded only here, on mount (`await import('@pixi/3d')`), so no
// other lane ever pays for it; the renderer is made only after a WebGL probe
// (lift-scene.ts), and a hive without WebGL gets a notice, not a blank page.
// Tile names are DOM text over the scene, never canvas text.
//
// Leaving never repaints the hive: ShowCell does that on the mode flip back
// to 'hexagons'.

import {
  Drone, EffectBus, I18N_IOC_KEY, isMetaEnvelope, metaPayloadOf,
  childLayersOf, propsSigOf, resolveLevelLayer,
  type RosterHistory, type RosterLayer,
} from '@hypercomb/core'
import { referenceFaceForLabel, titleForLabel } from '../../commands/decoration-kind-index.js'
import { cellLocationSig, readTilePropertiesAt, recoverableTileImageSig } from '../../editor/tile-properties.js'
import { ORDER_SLOT, parseOrder } from '../../history/tile-order.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'
import { isLongPressMenu } from '../../navigation/browser-menu.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../grid/hex-geometry.js'
import { onPageCellsChanged, pageKeyOf, whenPageCells, type PageCell } from './page-cells.js'
import { stackFor } from './tile-stack.js'
import { readThumbnail, type ThumbnailStore } from './thumbnails.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import { LiftScene, type SceneDeck, type ScenePick } from './lift-scene.js'
import {
  LIFT_VIEW, EMPTY_COMPOSITION, agoLabel, axialToPixel, clearStaged, compositionWrites,
  currentLayerId, flipDeck, historyLayerId, layerApply, markDeck, participantLayerId,
  pictureCandidates, reconcileComposition, rollVariant, seatNames, shortKey, stageVariant, stagedIndex, variantsFor,
  type Composition, type DeckCell, type DeckLayer, type DeckMarks, type DeckVariant,
} from './lift-deck.js'

export { LIFT_VIEW }

const OWNER = 'lift'
/** One above #pixi-host (59989, body-reparented while the hive boots or
 *  loads), level with the tile close-up and the layer list (59990), which
 *  open later and so stack above it by DOM order. Below the history slider
 *  (59991), edit-actions (59995) and the bars (59999+). */
const Z_BASE = 59990
const SIG_RE = /^[0-9a-f]{64}$/
/** History versions shown behind the page. */
const HISTORY_CAP = 12
const REBUILD_MS = 400
/** Wheel travel (px) per step — a trackpad sends many small deltas. */
const WHEEL_STEP = 60
const WHEEL_COOLDOWN_MS = 110
const DRAG_SLOP = 4
const SWIPE_STEP = 70

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = EventTarget & { explorerSegments?: () => readonly string[] }
type I18nShape = { t(key: string, params?: Record<string, string | number>): string }
type ModeRegistryShape = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
  ownersOf(mode: string): readonly string[]
}
type StoreShape = ThumbnailStore & {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type HistoryShape = RosterHistory & {
  listLayers(locationSig: string): Promise<Array<{ layerSig: string; at: number; index: number }>>
  promoteToHead(locationSig: string, layerSig: string): Promise<string | null>
  readonly previewActive?: boolean
}
type CursorShape = {
  readonly state: { locationSig: string; rewound: boolean }
  load?(locationSig: string): Promise<void>
  jumpToLatest?(): void
}
type SpotlightShape = { set(pubkey: string | null): void }
type AdoptShape = {
  adoptResolvedBranch(
    branch: { layerSig: string; at: string[]; label: string },
    opts?: { silent?: boolean },
  ): Promise<string>
}
type AxialShape = { items?: Map<number, { q: number; r: number }> }
type SubstrateShape = {
  ensureLoaded?(): Promise<void>
  pickImageForLabel?(label: string): string | null
}
type CellCountPayload = {
  readonly locationKey?: string
  readonly labels?: readonly string[]
  readonly coords?: readonly { q: number; r: number }[]
  readonly settled?: boolean
}

type Mount = {
  host: HTMLDivElement
  stage: HTMLDivElement
  labels: HTMLDivElement
  hoverLine: HTMLDivElement
  notice: HTMLDivElement
  bar: HTMLDivElement
  layerName: HTMLSpanElement
  position: HTMLSpanElement
  staged: HTMLSpanElement
  apply: HTMLButtonElement
  reset: HTMLButtonElement
}

const get = <T,>(key: string): T | undefined => window.ioc?.get<T>(key)

export class LiftViewDrone extends Drone {
  /** THE VIEWS THIS BEE RENDERS, and nowhere else does it act: it sleeps
   *  until the view mode enters one of them (scripts/passive-queen.ts). */
  readonly renders: readonly string[] = ['lift']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Lift view renderer — the page lifted into 3D with its participant and history layers stacked behind it like a slide deck.'

  #bound = false
  #gen = 0
  #mount: Mount | null = null
  #scene: LiftScene | null = null
  #sceneFailed = false
  #segments: string[] = []
  #pageKey = ''
  #pageLocSig = ''
  #deck: DeckLayer[] = []
  #marks: DeckMarks = { marks: new Map(), ghosts: [] }
  #composition: Composition = EMPTY_COMPOSITION
  #flip = 0
  /** Where each front tile lives — under a flattening filter a cell can be a
   *  match from anywhere in the hive. */
  #cellSegments = new Map<string, readonly string[]>()
  /** The latest settled `render:cell-count`: the grid coordinates the 2D page
   *  drew each label at. */
  #coords = { key: '', byLabel: new Map<string, { q: number; r: number }>() }
  #geometry: HexGeometry = DEFAULT_HEX_GEOMETRY
  #flat = false
  /** image sig → object URL (null: unreadable), and the reads in flight. */
  #urls = new Map<string, string | null>()
  #urlReads = new Map<string, Promise<string | null>>()
  /** props sig → what it says, across every history version (shared sigs are read once). */
  #propsOf = new Map<string, { imageSig?: string; index?: number; candidates?: readonly string[] }>()
  /** Every picture a cell's props name, best first, by `layerId\nname` —
   *  walked when the first one does not decode. */
  #alternatives = new Map<string, readonly string[]>()
  /** The grid's stand-in picture per name (reference face, else substrate). */
  #standIns = new Map<string, string | undefined>()
  #substrate: SubstrateShape | undefined
  #labelEls = new Map<string, HTMLDivElement>()
  #hover: ScenePick | null = null
  #opened = false
  #applying = false
  #rebuildTimer: ReturnType<typeof setTimeout> | null = null
  #noticeTimer: ReturnType<typeof setTimeout> | null = null
  #backOff: (() => void) | null = null
  #pageCellsOff: (() => void) | null = null
  #wheelAcc = 0
  #wheelAt = 0
  #pointers = new Map<number, { x: number; y: number }>()
  #drag: { button: number; orbit: boolean; x: number; y: number; moved: boolean } | null = null
  #pinch: { distance: number; midY: number; swipe: number } | null = null
  #rightDragged = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      get<LineageShape>('@hypercomb.social/Lineage')?.addEventListener?.('change', this.#lineageChange)
      this.onEffect('global:escape', this.#escape)
      this.onEffect<CellCountPayload>('render:cell-count', this.#cellCount)
      this.onEffect<HexGeometry>('render:geometry-changed', geometry => {
        if (geometry && geometry.circumRadiusPx > 0) this.#geometry = geometry
      })
      this.onEffect<{ flat: boolean }>('render:set-orientation', payload => {
        const flat = payload?.flat === true
        if (flat === this.#flat) return
        this.#flat = flat
        this.#propsOf.clear()   // the picture a tile shows depends on orientation
        this.#scheduleRebuild()
      })
      this.onEffect('cell:added', this.#scheduleRebuild)
      this.onEffect('cell:removed', this.#scheduleRebuild)
      this.onEffect('content:wrote', this.#scheduleRebuild)
      this.onEffect('history:marker-wrote', this.#scheduleRebuild)
      this.#pageCellsOff = onPageCellsChanged(this.#scheduleRebuild)
      this.#backOff = get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: OWNER, back: () => this.#leave() }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    get<LineageShape>('@hypercomb.social/Lineage')?.removeEventListener?.('change', this.#lineageChange)
    this.#backOff?.()
    this.#backOff = null
    this.#pageCellsOff?.()
    this.#pageCellsOff = null
    this.#teardown()
  }

  // ── mode ─────────────────────────────────────────────────────────────

  readonly #change = (): void => { void this.#reconcile() }

  readonly #lineageChange = (): void => {
    if (!this.#mount) return
    // A new place is a new deck: what was staged belonged to the page we left.
    this.#composition = EMPTY_COMPOSITION
    this.#flip = 0
    this.#opened = false
    void this.#reconcile()
  }

  readonly #escape = (): void => {
    if (this.#vm()?.mode !== LIFT_VIEW) return
    const top = get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')?.ownersOf('view:active').at(-1)
    if (top && top !== OWNER) return
    this.#leave()
  }

  #vm(): ViewModeShape | undefined {
    return get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  #leave(): void {
    this.#composition = EMPTY_COMPOSITION
    this.#vm()?.setMode('hexagons')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === LIFT_VIEW) { await this.#open(gen); return }
    this.#teardown()
  }

  async #open(gen: number): Promise<void> {
    const segments = [...(get<LineageShape>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])].map(String)
    if (!this.#mount) {
      this.#mount = this.#build()
      document.body.appendChild(this.#mount.host)
      this.#setActive(true)
    }
    if (!this.#scene && !this.#sceneFailed) {
      let pixi3d: typeof import('@pixi/3d')
      try {
        pixi3d = await import('@pixi/3d')
      } catch (error) {
        console.warn('[lift-view] @pixi/3d could not be loaded:', error)
        if (gen !== this.#gen) return
        this.#sceneFailed = true
        this.#notice(this.#t('lift.webgl', 'The lift view needs WebGL, and this browser has none to give.'), true)
        return
      }
      if (gen !== this.#gen || !this.#mount) return
      const made = await LiftScene.create(pixi3d, this.#mount.stage)
      // The view may have been left, or reopened, while the renderer was made.
      if (gen !== this.#gen || !this.#mount) {
        if (made.ok) made.scene.dispose()
        return
      }
      if (!made.ok) {
        this.#sceneFailed = true
        this.#notice(this.#t('lift.webgl', 'The lift view needs WebGL, and this browser has none to give.'), true)
        return
      }
      this.#scene = made.scene
      // The scene sizes itself from the stage (its own ResizeObserver) and
      // reads the same CSS size for the names it projects.
      this.#scene.onFrame = this.#placeLabels
    }
    if (!this.#scene) return
    await this.#load(gen, segments)
  }

  #teardown(): void {
    if (this.#rebuildTimer) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = null
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer)
    this.#noticeTimer = null
    this.#scene?.dispose()
    this.#scene = null
    this.#sceneFailed = false
    this.#mount?.host.remove()
    this.#mount = null
    for (const url of this.#urls.values()) if (url) { try { URL.revokeObjectURL(url) } catch { /* gone */ } }
    this.#urls.clear()
    this.#urlReads.clear()
    this.#propsOf.clear()
    this.#alternatives.clear()
    this.#standIns.clear()
    this.#labelEls.clear()
    this.#deck = []
    this.#composition = EMPTY_COMPOSITION
    this.#flip = 0
    this.#hover = null
    this.#opened = false
    this.#pointers.clear()
    this.#drag = null
    this.#pinch = null
    this.#setActive(false)
  }

  #active = false
  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', OWNER)
    else modes?.exit('view:active', OWNER)
  }

  readonly #scheduleRebuild = (): void => {
    if (!this.#mount || !this.#scene || this.#applying) return
    if (this.#rebuildTimer) clearTimeout(this.#rebuildTimer)
    this.#rebuildTimer = setTimeout(() => {
      this.#rebuildTimer = null
      if (this.#vm()?.mode === LIFT_VIEW) void this.#reconcile()
    }, REBUILD_MS)
  }

  readonly #cellCount = (payload: CellCountPayload): void => {
    if (!payload || payload.settled === false) return
    const key = String(payload.locationKey ?? '')
    if (!key) return
    const labels = payload.labels ?? []
    const coords = payload.coords ?? []
    const byLabel = new Map<string, { q: number; r: number }>()
    labels.forEach((label, i) => {
      const c = coords[i]
      if (c && Number.isFinite(c.q) && Number.isFinite(c.r)) byLabel.set(label, { q: c.q, r: c.r })
    })
    this.#coords = { key, byLabel }
  }

  // ── the deck ─────────────────────────────────────────────────────────

  async #load(gen: number, segments: string[]): Promise<void> {
    const deck = await this.#buildDeck(segments)
    if (gen !== this.#gen || !this.#scene || this.#vm()?.mode !== LIFT_VIEW) return
    this.#segments = segments
    this.#deck = deck
    this.#marks = markDeck(deck)
    this.#composition = reconcileComposition(this.#composition, deck)
    this.#flip = Math.min(this.#flip, Math.max(0, deck.length - 1))
    this.#paint()
    if (!this.#opened) {
      this.#scene.open()
      this.#opened = true
    }
    this.#scene.flipTo(this.#flip)
    if (!deck[0]?.cells.size) this.#notice(this.#t('lift.empty', 'Nothing on this page to lift.'))
  }

  async #buildDeck(segments: string[]): Promise<DeckLayer[]> {
    this.#pageKey = pageKeyOf(segments)
    this.#alternatives = new Map()
    this.#standIns = new Map()
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreShape>('@hypercomb.social/Store')

    // FRONT — the page as drawn: its one answer (page-cells.ts), at the grid
    // coordinates the 2D page drew each label at.
    const page = await whenPageCells(segments)
    const pageCells: readonly PageCell[] = page?.cells
      ?? (await this.#rosterCells(segments, history, store))
    this.#cellSegments = new Map(pageCells.map(c => [c.label, c.segments]))
    const childSigByName = await this.#childSigs(segments, history, store)
    const drawn = this.#coords.key === this.#pageKey ? this.#coords.byLabel : new Map<string, { q: number; r: number }>()
    const front = new Map<string, DeckCell>()
    await Promise.all(pageCells.map(async (cell, position) => {
      const at = drawn.get(cell.label) ?? this.#axialAt(position)
      if (!at) return
      const mine = stackFor(cell.label).find(v => v.pubkey === '')
      let imageSig = mine?.imageSig && SIG_RE.test(mine.imageSig) ? mine.imageSig : undefined
      if (!imageSig) {
        const props = await readTilePropertiesAt(cell.segments.slice(0, -1), cell.label).catch(() => ({}))
        const candidates = pictureCandidates(props, this.#flat)
        this.#alternatives.set(`${currentLayerId()}\n${cell.label}`, candidates)
        imageSig = recoverableTileImageSig(props, this.#flat) ?? candidates[0]
      }
      const layerSig = mine?.layerSig ?? childSigByName.get(cell.label)
      front.set(cell.label, {
        name: cell.label, q: at.q, r: at.r,
        ...(imageSig ? { imageSig } : {}),
        ...(layerSig ? { layerSig } : {}),
        index: position,
      })
    }))
    // Keep the page's own order (the Promise.all above lands out of order).
    const ordered = new Map<string, DeckCell>()
    for (const cell of pageCells) { const c = front.get(cell.label); if (c) ordered.set(cell.label, c) }
    const deck: DeckLayer[] = [{
      id: currentLayerId(), source: 'current',
      label: this.#t('lift.layer.current', 'you'), cells: ordered,
    }]

    // PARTICIPANTS — one layer per publisher found in the page's stacks, in
    // the stack order (the order the 2D roll and the spotlight cycle use).
    // Their seats are their own: rolling onto a participant adopts their
    // arrangement, not yours with their pictures in it.
    const peers = new Map<string, Map<string, DeckCell>>()
    for (const cell of ordered.values()) {
      for (const variant of stackFor(cell.name)) {
        if (!variant.pubkey) continue
        let cells = peers.get(variant.pubkey)
        if (!cells) { cells = new Map(); peers.set(variant.pubkey, cells) }
        const seat = typeof variant.index === 'number' ? this.#axialAt(variant.index) : undefined
        const candidates = pictureCandidates(variant.properties, this.#flat)
        const imageSig = variant.imageSig && SIG_RE.test(variant.imageSig) ? variant.imageSig : candidates[0]
        if (candidates.length) this.#alternatives.set(`${participantLayerId(variant.pubkey)}\n${cell.name}`, candidates)
        cells.set(cell.name, {
          name: cell.name, q: seat?.q ?? cell.q, r: seat?.r ?? cell.r,
          ...(imageSig ? { imageSig } : {}),
          ...(variant.layerSig ? { layerSig: variant.layerSig } : {}),
          ...(typeof variant.index === 'number' ? { index: variant.index } : {}),
        })
      }
    }
    for (const [pubkey, cells] of peers) {
      deck.push({
        id: participantLayerId(pubkey), source: 'participant', pubkey,
        label: this.#t('lift.layer.participant', '{key}', { key: shortKey(pubkey) }), cells,
      })
    }

    // HISTORY — the page's own earlier versions, newest first. Read only:
    // listLayers + getLayerBySig never write (latestMarkerSigFor would).
    if (history && store) {
      const locSig = await history.sign({ explorerSegments: () => [...segments] }).catch(() => '')
        || get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')?.state.locationSig || ''
      this.#pageLocSig = locSig
      if (locSig) {
        const entries = await history.listLayers(locSig).catch(() => [])
        const head = entries.at(-1)?.layerSig
        const seen = new Set<string>(head ? [head] : [])
        const picked: Array<{ layerSig: string; at: number }> = []
        for (const entry of [...entries].reverse()) {
          if (picked.length >= HISTORY_CAP) break
          if (!SIG_RE.test(entry.layerSig) || seen.has(entry.layerSig)) continue
          seen.add(entry.layerSig)
          picked.push(entry)
        }
        const now = Date.now()
        const layers = await Promise.all(picked.map(entry => this.#historyLayer(entry, history, store, now)))
        for (const layer of layers) if (layer) deck.push(layer)
      }
    }
    return this.#withStandIns(deck)
  }

  /** NO IMAGELESS TILES, as on the grid. A tile whose layer names no picture
   *  (a fresh tile is just `{ name }`) is drawn by show-cell with its
   *  reference face, else the substrate's deterministic pick for its label
   *  (show-cell.drone.ts `loadDefaultImage`). The deck does the same, in every
   *  layer, so a stand-in is the same signature wherever the name stands —
   *  and the marks read it as the same picture. Display only: nothing here
   *  is written. */
  async #withStandIns(deck: DeckLayer[]): Promise<DeckLayer[]> {
    this.#substrate = get<SubstrateShape>('@diamondcoreprocessor.com/SubstrateService')
    try { await this.#substrate?.ensureLoaded?.() } catch { /* no substrate: tiles stay bare */ }
    const pick = (name: string): string | undefined => this.#standInFor(name)
    return deck.map(layer => {
      let cells: Map<string, DeckCell> | null = null
      for (const [name, cell] of layer.cells) {
        if (cell.imageSig) continue
        const imageSig = pick(name)
        if (!imageSig) continue
        cells ??= new Map(layer.cells)
        cells.set(name, { ...cell, imageSig })
      }
      return cells ? { ...layer, cells } : layer
    })
  }

  /** The stand-in the grid would paint for `name`: its reference face, else
   *  the substrate's deterministic pick (show-cell `loadDefaultImage`). */
  #standInFor(name: string): string | undefined {
    if (this.#standIns.has(name)) return this.#standIns.get(name)
    const face = referenceFaceForLabel(name)
    const sig = SIG_RE.test(face) ? face : this.#substrate?.pickImageForLabel?.(name) ?? ''
    const found = SIG_RE.test(sig) ? sig : undefined
    this.#standIns.set(name, found)
    return found
  }

  async #historyLayer(
    entry: { layerSig: string; at: number },
    history: HistoryShape,
    store: StoreShape,
    now: number,
  ): Promise<DeckLayer | null> {
    const parsed = await history.getLayerBySig(entry.layerSig).catch(() => null)
    if (!parsed) return null
    const children = await childLayersOf(parsed, history, store).catch(() => [])
    const order = await this.#orderOf(parsed, store)
    const facts = await Promise.all(children.map(child => this.#propsFacts(child.layer, store)))
    const legacy = new Map<string, number>()
    children.forEach((child, i) => {
      const index = facts[i]?.index
      if (typeof index === 'number') legacy.set(child.name, index)
    })
    const seats = seatNames(children.map(c => c.name), order, legacy)
    const cells = new Map<string, DeckCell>()
    const layerId = historyLayerId(entry.layerSig)
    children.forEach((child, i) => {
      const candidates = facts[i]?.candidates
      if (candidates?.length) this.#alternatives.set(`${layerId}\n${child.name}`, candidates)
      const seat = seats.get(child.name) ?? i
      const at = this.#axialAt(seat)
      if (!at) return
      const imageSig = facts[i]?.imageSig
      cells.set(child.name, {
        name: child.name, q: at.q, r: at.r, index: seat, layerSig: child.sig,
        ...(imageSig ? { imageSig } : {}),
      })
    })
    return {
      id: layerId, source: 'history', at: entry.at, layerSig: entry.layerSig,
      label: this.#t('lift.layer.history', 'history · {ago}', { ago: agoLabel(entry.at, now) }), cells,
    }
  }

  /** The seats a page layer's `order` slot claims (history/tile-order.ts). */
  async #orderOf(layer: RosterLayer, store: StoreShape): Promise<ReadonlyMap<string, number>> {
    const slot = (layer as Record<string, unknown>)[ORDER_SLOT]
    const ref = Array.isArray(slot) && typeof slot[0] === 'string' ? slot[0] : ''
    if (!SIG_RE.test(ref)) return new Map()
    const blob = await store.getResource(ref).catch(() => null)
    return (blob ? parseOrder(await blob.text()) : null) ?? new Map()
  }

  /** What a child layer's props say: its picture and its legacy seat. */
  async #propsFacts(layer: RosterLayer, store: StoreShape): Promise<{ imageSig?: string; index?: number; candidates?: readonly string[] }> {
    const propsSig = propsSigOf(layer)
    if (!propsSig) return {}
    const known = this.#propsOf.get(propsSig)
    if (known) return known
    let facts: { imageSig?: string; index?: number; candidates?: readonly string[] } = {}
    try {
      const blob = await store.getResource(propsSig)
      if (blob) {
        const props = JSON.parse(await blob.text()) as Record<string, unknown>
        const candidates = pictureCandidates(props, this.#flat)
        const imageSig = recoverableTileImageSig(props, this.#flat) ?? candidates[0]
        const index = props['index']
        facts = {
          ...(imageSig ? { imageSig } : {}),
          ...(candidates.length ? { candidates } : {}),
          ...(typeof index === 'number' && Number.isInteger(index) && index >= 0 ? { index } : {}),
        }
      }
    } catch { /* unreadable props: no picture, no seat claim */ }
    this.#propsOf.set(propsSig, facts)
    return facts
  }

  /** The page's current children by name → their layer sigs. */
  async #childSigs(segments: string[], history: HistoryShape | undefined, store: StoreShape | undefined): Promise<Map<string, string>> {
    if (!history?.sign || !store) return new Map()
    try {
      const { layer } = await resolveLevelLayer(segments, history)
      if (!layer) return new Map()
      const children = await childLayersOf(layer, history, store)
      return new Map(children.map(c => [c.name, c.sig]))
    } catch { return new Map() }
  }

  /** Fallback when no render has reported the page: its layer's children. */
  async #rosterCells(segments: string[], history: HistoryShape | undefined, store: StoreShape | undefined): Promise<PageCell[]> {
    const names = [...(await this.#childSigs(segments, history, store)).keys()]
    return names.map(label => ({ label, segments: [...segments, label] }))
  }

  /** Slot index → axial, through the same spiral the hive lays tiles on. */
  #axialAt(index: number): { q: number; r: number } | undefined {
    const c = get<AxialShape>('@diamondcoreprocessor.com/AxialService')?.items?.get(index)
    return c && Number.isFinite(c.q) && Number.isFinite(c.r) ? { q: c.q, r: c.r } : undefined
  }

  // ── painting ─────────────────────────────────────────────────────────

  /** The deck as the scene draws it: the front shows the composition — each
   *  staged part in the accent, at the staged version's own seat when the
   *  front does not hold the tile at all (an adopt). */
  #paint(): void {
    const scene = this.#scene
    if (!scene) return
    const spacing = this.#geometry.circumRadiusPx + this.#geometry.gapPx
    const px = (cell: { q: number; r: number }) => axialToPixel(cell.q, cell.r, spacing, this.#flat)
    const front = this.#deck[0]
    const sceneDeck: SceneDeck = {
      radius: this.#geometry.circumRadiusPx,
      flat: this.#flat,
      layers: this.#deck.map((layer, index) => {
        const tiles = [...layer.cells.values()].map(cell => ({
          name: cell.name, ...px(cell),
          mark: this.#marks.marks.get(cell.name) ?? 'common',
          staged: index === 0 && this.#composition.has(cell.name),
        }))
        if (index === 0) {
          for (const [name, ref] of this.#composition) {
            if (layer.cells.has(name)) continue
            const cell = this.#deck.find(l => l.id === ref.layerId)?.cells.get(name)
            if (cell) tiles.push({ name, ...px(cell), mark: this.#marks.marks.get(name) ?? 'partial', staged: true })
          }
        }
        const ghosts = (this.#marks.ghosts[index] ?? []).flatMap(name => {
          const cell = front?.cells.get(name)
          return cell ? [{ name, ...px(cell) }] : []
        })
        return { tiles, ghosts }
      }),
    }
    scene.setDeck(sceneDeck)
    this.#deck.forEach((layer, index) => {
      for (const cell of layer.cells.values()) {
        const shown = index === 0 ? this.#shownCell(cell.name) : cell
        const from = index === 0 ? this.#composition.get(cell.name)?.layerId ?? layer.id : layer.id
        if (shown?.imageSig) void this.#picture(index, cell.name, shown.imageSig, index === 0, from)
      }
    })
    for (const name of this.#composition.keys()) {
      if (front?.cells.has(name)) continue
      const shown = this.#shownCell(name)
      if (shown?.imageSig) void this.#picture(0, name, shown.imageSig, true, this.#composition.get(name)?.layerId)
    }
    this.#syncLabels()
    this.#syncBar()
  }

  /** What the front shows for `name`: the staged version, else the page's own. */
  #shownCell(name: string): DeckCell | undefined {
    const ref = this.#composition.get(name)
    if (ref) return this.#deck.find(l => l.id === ref.layerId)?.cells.get(name)
    return this.#deck[0]?.cells.get(name)
  }

  /** Put a picture on a tile, walking its candidates until one DECODES: the
   *  named sig, every other picture its props name (a tile can name a
   *  `small.image` it does not hold and still have its `large.image`), then
   *  the grid's stand-in. A plain prism only when nothing at all decodes. */
  async #picture(
    layerIndex: number, name: string, imageSig: string, full: boolean,
    layerId = this.#deck[layerIndex]?.id ?? '',
  ): Promise<void> {
    const candidates = [imageSig, ...await this.#alternativesFor(layerId, name)]
    const standIn = this.#standInFor(name)
    if (standIn) candidates.push(standIn)
    const tried = new Set<string>()
    for (const sig of candidates) {
      if (tried.has(sig)) continue
      tried.add(sig)
      const url = await this.#urlFor(sig, full)
      if (!url) continue
      const scene = this.#scene
      if (!scene) return
      if (await scene.setPicture(layerIndex, name, url)) return
    }
  }

  /** The other pictures a cell's props name. Built with the deck for
   *  participant and history cells; read on demand for the page's own. */
  async #alternativesFor(layerId: string, name: string): Promise<readonly string[]> {
    const key = `${layerId}\n${name}`
    const known = this.#alternatives.get(key)
    if (known) return known
    if (layerId !== currentLayerId()) return []
    const segments = this.#cellSegments.get(name) ?? [...this.#segments, name]
    const props = await readTilePropertiesAt(segments.slice(0, -1), name).catch(() => ({}))
    const candidates = pictureCandidates(props, this.#flat)
    this.#alternatives.set(key, candidates)
    return candidates
  }

  /** The front wants the HEX CAPTURE itself (`small.image` already bakes the
   *  participant's pan and zoom framing, at the hex box's aspect). Deeper,
   *  fainter layers take the 96px thumbnail first and ask for one on a miss,
   *  the way the tree's icons do. */
  #urlFor(imageSig: string, full: boolean): Promise<string | null> {
    const known = this.#urls.get(imageSig)
    if (known !== undefined) return Promise.resolve(known)
    const inflight = this.#urlReads.get(imageSig)
    if (inflight) return inflight
    const read = (async (): Promise<string | null> => {
      const store = get<StoreShape>('@hypercomb.social/Store')
      if (!store) return null
      let blob: Blob | null = null
      if (!full) blob = await readThumbnail(store, imageSig)
      if (!blob) {
        blob = await this.#bytesOf(store, imageSig)
        if (blob && blob.size > 0 && !full) {
          try { EffectBus.emit('thumbnail:wanted', { sig: imageSig }) } catch { /* non-fatal */ }
        }
      }
      if (!blob && full) blob = await readThumbnail(store, imageSig)
      if (!blob || blob.size === 0) return null
      return URL.createObjectURL(blob)
    })().then(url => {
      this.#urlReads.delete(imageSig)
      if (!this.#mount) { if (url) URL.revokeObjectURL(url); return null }
      this.#urls.set(imageSig, url)
      return url
    }, () => { this.#urlReads.delete(imageSig); return null })
    this.#urlReads.set(imageSig, read)
    return read
  }

  /** The picture's own bytes. A picture sig can be a META ENVELOPE (a Life
   *  Primitive incidence) whose bytes are JSON naming the resource — handed
   *  to a texture as-is it decodes to nothing. Local first, through the same
   *  resolver the grid uses; then the store, following any envelope it
   *  returns. */
  async #bytesOf(store: StoreShape, sig: string): Promise<Blob | null> {
    if (store.getResourceLocal) {
      const local = await resolveLocalResourceReference(
        store as StoreShape & { getResourceLocal(sig: string): Promise<Blob | null> }, sig,
      ).catch(() => null)
      if (local && local.size > 0) return local
    }
    let current = sig
    const seen = new Set<string>()
    for (let depth = 0; depth < 4; depth++) {
      if (seen.has(current)) return null
      seen.add(current)
      const blob = await store.getResource(current).catch(() => null)
      if (!blob || blob.size === 0 || blob.size > 64 * 1024) return blob
      try {
        const parsed = JSON.parse(await blob.text()) as unknown
        if (!isMetaEnvelope(parsed)) return blob
        const payload = metaPayloadOf(parsed)
        if (!payload || payload.kind !== 'resource' || !SIG_RE.test(String(payload.sig))) return null
        current = String(payload.sig)
      } catch {
        return blob
      }
    }
    return null
  }

  // ── names (DOM text) ─────────────────────────────────────────────────

  /** One label per tile of the layer at the front. */
  #syncLabels(): void {
    const mount = this.#mount
    if (!mount) return
    const layerIndex = this.#flip
    const names = new Set<string>([...(this.#deck[layerIndex]?.cells.keys() ?? [])])
    if (layerIndex === 0) for (const name of this.#composition.keys()) names.add(name)
    for (const [name, el] of this.#labelEls) {
      if (!names.has(name)) { el.remove(); this.#labelEls.delete(name) }
    }
    for (const name of names) {
      if (this.#labelEls.has(name)) continue
      const el = document.createElement('div')
      el.className = 'hc-lift-name'
      el.textContent = titleForLabel(name) || name
      mount.labels.appendChild(el)
      this.#labelEls.set(name, el)
    }
    this.#placeLabels()
  }

  readonly #placeLabels = (): void => {
    const mount = this.#mount
    const scene = this.#scene
    if (!mount || !scene) return
    const radius = scene.radiusOnScreen()
    const size = Math.max(0.55, Math.min(0.95, radius / 52))
    const legible = radius >= 16
    mount.labels.style.setProperty('--hc-lift-name-size', `${size.toFixed(3)}rem`)
    for (const [name, el] of this.#labelEls) {
      const at = legible ? scene.project(this.#flip, name) : null
      if (!at?.visible) { el.style.display = 'none'; continue }
      el.style.display = ''
      el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y + radius * 0.62)}px) translate(-50%, -50%)`
    }
    this.#placeHoverLine()
  }

  #placeHoverLine(): void {
    const mount = this.#mount
    const scene = this.#scene
    if (!mount || !scene) return
    const hover = this.#hover
    const at = hover ? scene.project(hover.layerIndex, hover.name) : null
    if (!hover || !at?.visible) { mount.hoverLine.style.display = 'none'; return }
    const variants = variantsFor(hover.name, this.#deck)
    const shownIndex = hover.layerIndex === 0
      ? stagedIndex(this.#composition.get(hover.name), variants)
      : Math.max(0, variants.findIndex(v => v.layerIndex === hover.layerIndex))
    const variant = variants[shownIndex]
    const source = variant ? this.#sourceText(variant) : (this.#deck[hover.layerIndex]?.label ?? '')
    const position = variants.length > 1
      ? ' · ' + this.#t('lift.position', '{n} of {m}', { n: shownIndex + 1, m: variants.length })
      : ''
    mount.hoverLine.textContent = `${titleForLabel(hover.name) || hover.name} — ${source}${position}`
    mount.hoverLine.style.display = ''
    const radius = scene.radiusOnScreen()
    mount.hoverLine.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - radius * 1.25)}px) translate(-50%, -100%)`
  }

  #sourceText(variant: DeckVariant): string {
    if (variant.source === 'current') return this.#t('lift.layer.current', 'you')
    if (variant.source === 'participant') return this.#t('lift.layer.participant', '{key}', { key: shortKey(variant.pubkey ?? '') })
    return this.#t('lift.layer.history', 'history · {ago}', { ago: agoLabel(variant.at ?? Date.now(), Date.now()) })
  }

  // ── gestures ─────────────────────────────────────────────────────────

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const scene = this.#scene
    if (!scene) return
    if (event.ctrlKey || event.metaKey) {
      scene.zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * 0.0015))
      return
    }
    if (event.altKey) {
      scene.tiltBy(event.deltaY * 0.002)
      return
    }
    // One step per notch: a line/page wheel is a notch per event; a pixel
    // wheel (trackpad) accumulates, with a short cooldown so a fling does not
    // race through the deck.
    const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * WHEEL_STEP
    this.#wheelAcc += delta
    if (Math.abs(this.#wheelAcc) < WHEEL_STEP) return
    const now = performance.now()
    const step = Math.sign(this.#wheelAcc)
    this.#wheelAcc = 0
    if (now - this.#wheelAt < WHEEL_COOLDOWN_MS) return
    this.#wheelAt = now
    const pick = scene.pick(event.clientX, event.clientY)
    if (pick && this.#rollTile(pick.name, step)) return
    this.#flipBy(step)
  }

  /** Over a tile: roll THAT tile through its versions and stage the one it
   *  lands on. A tile the front lacks rolls through "not taken" too. */
  #rollTile(name: string, step: number): boolean {
    const variants = variantsFor(name, this.#deck)
    const inFront = this.#deck[0]?.cells.has(name) === true
    const options: Array<DeckVariant | null> = inFront ? variants : [null, ...variants]
    if (options.length < 2) return false
    const ref = this.#composition.get(name)
    const current = ref ? Math.max(0, options.findIndex(v => v?.layerId === ref.layerId)) : 0
    const next = options[rollVariant(current, step, options)]
    const extrasBefore = [...this.#composition.keys()].filter(n => !this.#deck[0]?.cells.has(n)).join('\n')
    this.#composition = next ? stageVariant(this.#composition, name, next) : clearStaged(this.#composition, name)
    const extrasAfter = [...this.#composition.keys()].filter(n => !this.#deck[0]?.cells.has(n)).join('\n')
    if (this.#flip !== 0) { this.#flip = 0; this.#scene?.flipTo(0) }
    this.#hover = { layerIndex: 0, name }
    if (extrasBefore !== extrasAfter) {
      // The front gained or lost a tile it does not hold: redraw the deck.
      this.#paint()
      this.#scene?.setHover(this.#hover)
      return true
    }
    this.#scene?.setTileState(0, name, { staged: this.#composition.has(name) })
    const shown = this.#shownCell(name)
    if (shown?.imageSig) void this.#picture(0, name, shown.imageSig, true, this.#composition.get(name)?.layerId)
    else void this.#scene?.setPicture(0, name, null)
    this.#scene?.setHover(this.#hover)
    this.#syncLabels()
    this.#syncBar()
    return true
  }

  #flipBy(step: number): void {
    const next = flipDeck(this.#flip, step, this.#deck.length)
    if (next === this.#flip) return
    this.#flip = next
    this.#scene?.flipTo(next)
    this.#scene?.setHover(null)
    this.#hover = null
    this.#syncLabels()
    this.#syncBar()
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (!this.#scene || (event.target as Element | null)?.closest?.('.hc-lift-bar')) return
    this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try { (event.currentTarget as Element).setPointerCapture(event.pointerId) } catch { /* not capturable */ }
    if (this.#pointers.size === 2) {
      const [a, b] = [...this.#pointers.values()]
      this.#pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, midY: (a!.y + b!.y) / 2, swipe: 0 }
      this.#drag = null
      return
    }
    if (this.#pointers.size > 2) return
    const orbit = event.button === 2 || (event.button === 0 && event.shiftKey)
    if (event.button !== 0 && event.button !== 2) return
    this.#drag = { button: event.button, orbit, x: event.clientX, y: event.clientY, moved: false }
    if (event.button === 2) this.#rightDragged = false
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    const scene = this.#scene
    if (!scene) return
    if (this.#pointers.has(event.pointerId)) this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.#pinch && this.#pointers.size === 2) {
      const [a, b] = [...this.#pointers.values()]
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1
      const midX = (a!.x + b!.x) / 2
      const midY = (a!.y + b!.y) / 2
      scene.zoomAt(midX, midY, this.#pinch.distance / distance)
      this.#pinch.swipe += midY - this.#pinch.midY
      this.#pinch.distance = distance
      this.#pinch.midY = midY
      if (Math.abs(this.#pinch.swipe) >= SWIPE_STEP) {
        this.#flipBy(this.#pinch.swipe > 0 ? -1 : 1)
        this.#pinch.swipe = 0
      }
      return
    }
    const drag = this.#drag
    if (drag) {
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_SLOP) return
      drag.moved = true
      if (drag.button === 2) this.#rightDragged = true
      drag.x = event.clientX
      drag.y = event.clientY
      if (drag.orbit) scene.orbit(dx, dy)
      else scene.pan(dx, dy)
      return
    }
    if (event.pointerType === 'touch') return
    const pick = scene.pick(event.clientX, event.clientY)
    const same = pick && this.#hover && pick.layerIndex === this.#hover.layerIndex && pick.name === this.#hover.name
    if (same || (!pick && !this.#hover)) return
    this.#hover = pick
    scene.setHover(pick)
    this.#placeHoverLine()
  }

  readonly #onPointerUp = (event: PointerEvent): void => {
    this.#pointers.delete(event.pointerId)
    if (this.#pointers.size < 2) this.#pinch = null
    if (this.#pointers.size === 0) this.#drag = null
  }

  /** A right-DRAG orbited, so it claims the gesture; a plain right-click is
   *  left to the BackGesture service — the way out, as everywhere. */
  readonly #onContextMenu = (event: MouseEvent): void => {
    if (isLongPressMenu(event)) return
    if (this.#rightDragged) {
      event.preventDefault()
      this.#rightDragged = false
    }
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return
    event.preventDefault()
    void this.#apply()
  }

  // ── apply ────────────────────────────────────────────────────────────

  #viewingPast(): boolean {
    const cursor = get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    return cursor?.state?.rewound === true || history?.previewActive === true
  }

  /** Truth enters only here, and only through doors the hive already has. */
  async #apply(): Promise<void> {
    if (this.#applying) return
    const writes = compositionWrites(this.#composition)
    const whole = layerApply(this.#deck[this.#flip])
    if (!writes.length && whole.kind === 'none') return
    if (whole.kind === 'spotlight' && !writes.length) {
      // A participant's whole layer is a VIEW, not a write — the same move as
      // the 2D roll. Leave so the page shows it.
      get<SpotlightShape>('@diamondcoreprocessor.com/SpotlightService')?.set(whole.pubkey)
      this.#leave()
      return
    }
    if (this.#viewingPast()) {
      this.#notice(this.#t('lift.rewound', 'You are viewing the past — come back to the present to apply.'))
      return
    }
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const cursor = get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
    if (!history?.promoteToHead) return
    this.#applying = true
    // A staged part with no tile layer to adopt or promote cannot be written.
    let failed = this.#composition.size - writes.length
    try {
      if (writes.length) {
        const adopt = get<AdoptShape>('@diamondcoreprocessor.com/SwarmAdoptDrone')
        for (const write of writes) {
          const tileSegments = this.#cellSegments.get(write.name) ?? [...this.#segments, write.name]
          const parent = [...tileSegments.slice(0, -1)]
          try {
            if (write.kind === 'adopt') {
              if (!adopt) { failed++; continue }
              const outcome = await adopt.adoptResolvedBranch({ layerSig: write.layerSig, at: parent, label: write.name }, { silent: true })
              if (outcome !== 'committed' && outcome !== 'exists') failed++
            } else {
              const childLoc = await cellLocationSig(parent, write.name)
              if (!childLoc || !await history.promoteToHead(childLoc, write.layerSig)) failed++
            }
          } catch (error) {
            console.warn('[lift-view] apply failed for', write.name, error)
            failed++
          }
        }
      } else if (whole.kind === 'promote' && this.#composition.size === 0 && this.#pageLocSig) {
        if (!await history.promoteToHead(this.#pageLocSig, whole.layerSig)) failed++
      }
      // The same settle the rewind window's Save runs
      // (edit-actions.component.ts): cursor to the new head, then drop the
      // page's cached cells so the render that follows reads it.
      const locSig = this.#pageLocSig || cursor?.state.locationSig || ''
      if (locSig) await cursor?.load?.(locSig)
      cursor?.jumpToLatest?.()
      EffectBus.emit('fs:changed', { segments: [] })
      EffectBus.emit('activity:log', { message: this.#t('lift.applied', 'Applied from the lift view'), icon: 'layers' })
    } finally {
      this.#applying = false
    }
    if (failed) this.#notice(this.#t('lift.failed', '{n} could not be applied', { n: failed }))
    this.#composition = EMPTY_COMPOSITION
    this.#flip = 0
    this.#scheduleRebuild()
  }

  #reset(): void {
    const hadExtras = [...this.#composition.keys()].some(n => !this.#deck[0]?.cells.has(n))
    this.#composition = clearStaged(this.#composition)
    this.#flip = 0
    if (hadExtras) this.#paint()
    else {
      for (const name of this.#deck[0]?.cells.keys() ?? []) {
        this.#scene?.setTileState(0, name, { staged: false })
        const cell = this.#deck[0]?.cells.get(name)
        if (cell?.imageSig) void this.#picture(0, name, cell.imageSig, true)
      }
      this.#syncLabels()
      this.#syncBar()
    }
    this.#scene?.flipTo(0)
  }

  // ── chrome ───────────────────────────────────────────────────────────

  #syncBar(): void {
    const mount = this.#mount
    if (!mount) return
    const layer = this.#deck[this.#flip]
    mount.layerName.textContent = layer?.label ?? ''
    mount.position.textContent = this.#deck.length
      ? this.#t('lift.position', '{n} of {m}', { n: this.#flip + 1, m: this.#deck.length })
      : ''
    const staged = this.#composition.size
    mount.staged.textContent = staged ? this.#t('lift.staged', '{n} staged', { n: staged }) : ''
    mount.staged.style.display = staged ? '' : 'none'
    mount.apply.disabled = staged === 0 && layerApply(layer).kind === 'none'
    mount.reset.disabled = staged === 0 && this.#flip === 0
  }

  #notice(text: string, sticky = false): void {
    const notice = this.#mount?.notice
    if (!notice) return
    notice.textContent = text
    notice.style.display = ''
    if (this.#noticeTimer) clearTimeout(this.#noticeTimer)
    this.#noticeTimer = sticky ? null : setTimeout(() => {
      this.#noticeTimer = null
      if (this.#mount) this.#mount.notice.style.display = 'none'
    }, 3200)
  }

  #build(): Mount {
    const host = document.createElement('div')
    host.className = 'hc-lift-view'
    host.id = 'hc-lift-view-host'
    // Opt out of the always-on hex wheel-zoom handler: this view owns the wheel.
    host.setAttribute('data-consumes-wheel', '')
    const style = document.createElement('style')
    style.textContent = LIFT_CSS
    host.appendChild(style)

    const stage = document.createElement('div')
    stage.className = 'hc-lift-stage'
    const labels = document.createElement('div')
    labels.className = 'hc-lift-names'
    const hoverLine = document.createElement('div')
    hoverLine.className = 'hc-lift-hover'
    hoverLine.style.display = 'none'
    labels.appendChild(hoverLine)
    const notice = document.createElement('div')
    notice.className = 'hc-lift-notice'
    notice.style.display = 'none'

    const bar = document.createElement('div')
    bar.className = 'hc-lift-bar'
    const layerName = document.createElement('span')
    layerName.className = 'hc-lift-layer'
    const position = document.createElement('span')
    position.className = 'hc-lift-dim'
    const staged = document.createElement('span')
    staged.className = 'hc-lift-staged'
    const legend = document.createElement('span')
    legend.className = 'hc-lift-legend'
    for (const [mark, fallback] of [['common', 'same'], ['changed', 'differs'], ['partial', 'missing']] as const) {
      const item = document.createElement('span')
      item.className = `hc-lift-key hc-lift-key-${mark}`
      item.textContent = this.#t(`lift.mark.${mark}`, fallback)
      legend.appendChild(item)
    }
    const button = (text: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = text
      b.addEventListener('click', onClick)
      return b
    }
    const reset = button(this.#t('lift.reset', 'Reset'), () => this.#reset())
    const apply = button(this.#t('lift.apply', 'Apply'), () => { void this.#apply() })
    apply.className = 'hc-lift-apply'
    const leave = button(this.#t('lift.leave', 'Leave'), () => this.#leave())
    bar.append(layerName, position, staged, legend, reset, apply, leave)

    host.append(stage, labels, notice, bar)
    host.addEventListener('wheel', this.#onWheel, { passive: false })
    host.addEventListener('pointerdown', this.#onPointerDown)
    host.addEventListener('pointermove', this.#onPointerMove)
    host.addEventListener('pointerup', this.#onPointerUp)
    host.addEventListener('pointercancel', this.#onPointerUp)
    host.addEventListener('pointerleave', () => {
      if (this.#drag || !this.#hover) return
      this.#hover = null
      this.#scene?.setHover(null)
      this.#placeHoverLine()
    })
    host.addEventListener('contextmenu', this.#onContextMenu)
    host.addEventListener('keydown', this.#onKeyDown)
    host.tabIndex = -1
    queueMicrotask(() => { try { host.focus({ preventScroll: true }) } catch { /* not focusable */ } })
    return { host, stage, labels, hoverLine, notice, bar, layerName, position, staged, apply, reset }
  }

  /** Localised text with an inline fallback. The shell's `t()` answers the
   *  RAW KEY on a miss, so the fallback is chosen on `value === key`, and is
   *  interpolated too — a literal "{n}" on screen is a bug. */
  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nShape>(I18N_IOC_KEY)?.t?.(key, params)
    if (value && value !== key) return value
    if (!params) return fallback
    return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
      token in params ? String(params[token]) : whole)
  }
}

// The ground is the theme's own (`--md-surface`, the body's background) under
// a soft vignette, and OPAQUE: the shell's boot underlay must not show through.
// The WebGL canvas stays alpha so this ground is what sits behind the deck.
// The deck is the colour; the chrome stays cold.
const LIFT_CSS = `
.hc-lift-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:${Z_BASE};overflow:hidden;outline:none;
 background:radial-gradient(130% 100% at 50% 45%,transparent 52%,rgba(0,0,0,.42) 100%),var(--md-surface,#10161d);color:#d8e6ee;font-family:inherit;overscroll-behavior:contain;touch-action:none;-webkit-user-select:none;user-select:none}
.hc-lift-stage{position:absolute;inset:0}
.hc-lift-names{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.hc-lift-name{position:absolute;left:0;top:0;max-width:9rem;padding:.1rem .4rem;border-radius:var(--hc-radius-control,2px);background:rgba(8,12,18,.55);color:rgba(232,240,244,.94);
 font-size:var(--hc-lift-name-size,.8rem);line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;will-change:transform}
.hc-lift-hover{position:absolute;left:0;top:0;padding:.3rem .6rem;border-radius:var(--hc-radius-floating,4px);background:rgba(8,12,18,.9);border:1px solid rgba(126,182,214,.35);
 color:#e8f0f4;font-size:.8rem;line-height:1.3;white-space:nowrap;box-shadow:0 .4rem 1.2rem rgba(0,0,0,.45)}
.hc-lift-notice{position:absolute;top:1rem;left:50%;transform:translateX(-50%);max-width:min(40rem,92vw);padding:.6rem .9rem;border-radius:var(--hc-radius-floating,4px);
 background:rgba(8,12,18,.94);border:1px solid rgba(224,96,126,.5);color:#f0dde3;font-size:.85rem;line-height:1.4;text-align:center}
.hc-lift-bar{position:absolute;left:50%;bottom:max(1rem,env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;justify-content:center;
 max-width:calc(100% - 2rem);box-sizing:border-box;padding:.45rem .8rem;border-radius:var(--hc-radius-floating,4px);background:rgba(10,15,21,.72);border:1px solid rgba(126,182,214,.2);
 backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-size:.8rem;line-height:1.2}
.hc-lift-layer{color:#e8f0f4;font-weight:600}
.hc-lift-dim{color:rgba(216,230,238,.55)}
.hc-lift-staged{color:#c9b8ff}
.hc-lift-legend{display:flex;gap:.6rem;color:rgba(216,230,238,.7)}
.hc-lift-key::before{content:'';display:inline-block;width:.55rem;height:.55rem;margin-right:.3rem;border-radius:50%;vertical-align:-.02rem;background:var(--k)}
.hc-lift-key-common{--k:#4fa3a8}.hc-lift-key-changed{--k:#e8a33d}.hc-lift-key-partial{--k:#e0607e}
.hc-lift-bar button{min-height:2rem;padding:.25rem .55rem;border:0;border-radius:var(--hc-radius-control,2px);background:none;color:rgba(216,230,238,.85);font:inherit;cursor:pointer}
.hc-lift-bar button:hover:not(:disabled){background:rgba(126,182,214,.12);color:#fff}
.hc-lift-bar button:disabled{opacity:.35;cursor:default}
.hc-lift-bar .hc-lift-apply:not(:disabled){color:#c9b8ff}
.hc-lift-bar button:focus-visible{outline:2px solid rgb(126,182,214);outline-offset:2px}
@media(max-width:560px){.hc-lift-legend{display:none}}
`

const _liftView = new LiftViewDrone()
window.ioc.register('@diamondcoreprocessor.com/LiftViewDrone', _liftView)
