// presentation/tiles/wave-view.drone.ts
//
// WAVE VIEW — hold Alt to DIVE into the layers under a tile.
//
// Hold Alt over a tile and the page is REPLACED by what is inside it: its
// children take over the grid, at full size, in the same slots a real layer
// would use. They are not a picture of the tiles underneath — they ARE those
// tiles: show-cell paints them through the same shader, atlases and geometry
// packer it paints the page with (`render:dive`), so a dive looks exactly
// like the place you are about to go. Alt+wheel dives deeper (grandchildren,
// then great-grandchildren) or rises back up.
//
// Because the previewed tiles ARE the mesh while you hold Alt, you can move
// over any of them; the one under the cursor lights up. Then:
//   - CLICK a tile  → it is EXECUTED as if it stood in front of you: a
//                     reference portal travels to its target, anything else is
//                     entered — and a layer that opens as a view (a website, a
//                     tree) opens that view. The page you dove from is
//                     announced as the view's spawn (`view:spawn`), so closing
//                     it brings you back HERE, not to wherever the tile lives.
//                     That is what makes the dive a way to go and activate
//                     something and stay.
//   - RELEASE Alt   → everything snaps back exactly as it was. Nothing moved,
//                     nothing was written; the dive was only ever a look.
//
// This drone owns the GESTURE and the RESOLUTION; show-cell owns the PAINT.
// While a dive is on screen this drone OWNS the pointer: moves and presses are
// stopped at window capture so tile-overlay cannot act on the page underneath
// (its action icons live in a different container and would otherwise float
// over the dive, wired to tiles nobody can see).
//
// Read-only: head resolution is fresh per dive (heads move), while layer
// content and properties blobs are cached by signature — immutable, so those
// caches never go stale. Nothing is ever written.

import { Drone, consumePointerGesture } from '@hypercomb/core'
import { Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { DiveCell } from './show-cell.drone.js'
import {
  cellLocationSig,
  lookupTilePropsSig,
  readTilePropsIndex,
  readTilePropertiesAt,
  recoverableTileImageSig,
} from '../../editor/tile-properties.js'
import {
  ensureDecorationsIndexed,
  referenceTargetAt,
  defaultViewWithinSegments,
} from '../../commands/decoration-kind-index.js'
import { VIEW_SPAWN_EFFECT } from './view-spawn.js'
import { depthAvailableFrom, clampDepth, diveClickPlan, borderColorFromProps, type Axial } from './wave-layout.js'

type CellCountPayload = {
  labels: string[]
  coords: Axial[]
  branchLabels: string[]
  externalLabels: string[]
  shadedLabels: string[]
}

type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<{ children?: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: unknown; children?: unknown } | null>
}

/** One tile of the previewed generation. */
type DiveNode = {
  slot: Axial                          // grid slot, from the same axial matrix a real layer uses
  name: string
  parent: string[]                     // full path of the layer this tile sits in
  referenceTarget: readonly string[] | null
  cell: DiveCell                       // what show-cell paints
}

/** What a tile shows, resolved the way the page resolves it. */
type TileFace = { image?: string; hideText: boolean; borderColor?: [number, number, number] }

/** Immutable layer content, resolved once per signature. */
type LayerNode = { name: string; childSigs: string[] }

const SIG = /^[a-f0-9]{64}$/i
const MAX_DEPTH = 5                 // wheel-reachable generations
const MAX_TILES = 120               // a very wide generation stops here

export class WaveViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'navigation'
  override description =
    'Hold Alt to dive: the tile under the cursor is replaced by the tiles inside it, painted by the page renderer itself; alt+wheel goes deeper, clicking a dived tile executes it as if it stood in front of you and comes back here when done, releasing Alt restores the page untouched.'

  // ── hit-testing plumbing (the renderer's own transforms) ─────────
  #renderContainer: HostReadyPayload['container'] | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: HostReadyPayload['renderer'] | null = null
  #meshOffset = { x: 0, y: 0 }
  #flat = false

  // ── current-layer snapshot (render:cell-count) ────────────────────
  #byAxial = new Map<string, string>()      // "q,r" → label
  #branchSet = new Set<string>()
  #externalSet = new Set<string>()
  #shadedSet = new Set<string>()

  // ── pointer / modifier state ──────────────────────────────────────
  #altHeld = false
  #overCanvas = false
  #lastClient: { x: number; y: number } | null = null

  // ── dive state ────────────────────────────────────────────────────
  #subject: string | null = null            // the tile the dive is anchored to (set while resolving too)
  #baseSegments: string[] = []              // the page the dive was made from
  #depth = 1                                // generation on screen: 1 = children
  #maxDepthAvailable = 1                    // deepest generation this subject has
  #active = false                           // a generation has been handed to show-cell
  #nodes: DiveNode[] = []
  #nodeByAxial = new Map<string, DiveNode>()
  #hoverLabel: string | null = null
  #buildToken = 0

  // sig-addressed caches — content is immutable, so these never go stale
  #layerCache = new Map<string, LayerNode | null>()
  #propsCache = new Map<string, Record<string, unknown> | null>()

  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:set-orientation', 'render:cell-count', 'render:dive-painted']
  protected override emits = ['render:dive', 'render:dive-hover', VIEW_SPAWN_EFFECT, 'tile:navigate-in', 'tile:navigate-reference']

  #wired = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => { this.#meshOffset = offset })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#flat = !!p?.flat })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#byAxial.clear()
      for (let i = 0; i < payload.labels.length; i++) {
        const c = payload.coords[i]
        if (c) this.#byAxial.set(`${c.q},${c.r}`, payload.labels[i])
      }
      this.#branchSet = new Set(payload.branchLabels ?? [])
      this.#externalSet = new Set(payload.externalLabels ?? [])
      this.#shadedSet = new Set(payload.shadedLabels ?? [])
      // A new layer landed under the dive (navigation, edit, sync). Whatever is
      // painted describes tiles that are no longer here — end the dive rather
      // than leave a preview of somewhere else on screen.
      if (this.#subject !== null) this.#endDive()
    })

    // show-cell's own word on what is up. A zero while we believe a dive is
    // showing means it could not be painted (or was torn down under us) —
    // let go of the pointer rather than hold a dive that never landed.
    this.onEffect<{ count?: number }>('render:dive-painted', (payload) => {
      if (this.#active && (payload?.count ?? 0) === 0) this.#endDive()
    })

    window.addEventListener('pointermove', this.#onPointerMove, true)
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('blur', this.#onWindowBlur)
    window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', this.#onPointerDown, true)
    window.addEventListener('navigate', this.#onNavigate)
  }

  protected override dispose(): void {
    window.removeEventListener('pointermove', this.#onPointerMove, true)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('blur', this.#onWindowBlur)
    window.removeEventListener('wheel', this.#onWheel, { capture: true } as EventListenerOptions)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    window.removeEventListener('navigate', this.#onNavigate)
    this.#endDive()                         // never strand the page behind a dive
  }

  /** A generation is on screen (handed to show-cell) — the dive owns the pointer. */
  #diving(): boolean { return this.#active }

  // ── input ─────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    this.#lastClient = { x: e.clientX, y: e.clientY }
    this.#overCanvas = e.target === this.#canvas
    const altChanged = this.#altHeld !== e.altKey
    this.#altHeld = e.altKey

    if (this.#diving()) {
      // The dive owns the pointer: the page underneath is hidden, so nothing
      // else may act on it. Alt released mid-move ends the dive first.
      if (!this.#altHeld) { this.#endDive(); return }
      e.stopPropagation()
      this.#updateDiveHover()
      return
    }

    if (altChanged && this.#altHeld) void this.#tryStartDive()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt' || e.repeat) return
    this.#altHeld = true
    // Claim Alt only while the pointer is actually over the hive. Gating on
    // "is a text field focused" instead looked equivalent but was not: this
    // shell's command input holds focus by DEFAULT, so Alt was swallowed on a
    // fresh page and the dive never started until you had clicked the canvas.
    // Where the pointer is says what Alt is for far better than where focus
    // sits. Only the bare Alt is taken — Alt+key combos never reach here, so
    // browser and app shortcuts are untouched.
    if (!this.#overCanvas) return
    e.preventDefault()                      // the bare Alt press must not arm the browser menu
    void this.#tryStartDive()
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt') return
    if (this.#altHeld) e.preventDefault()   // Firefox focuses its menu on Alt RELEASE
    this.#altHeld = false
    this.#endDive()                         // "let go and you are back where you were"
  }

  #onWindowBlur = (): void => {
    // Alt+Tab away would otherwise latch the modifier on and strand the dive.
    this.#altHeld = false
    this.#endDive()
  }

  /** The explorer moved (a back gesture, a typed address) — the dive was a
   *  look at somewhere else's insides; the new page must paint at once. */
  #onNavigate = (): void => {
    if (this.#subject !== null) this.#endDive()
  }

  #onWheel = (e: WheelEvent): void => {
    if (!this.#diving()) return
    const target = e.target as Element | null
    if (target?.closest?.('[data-consumes-wheel]')) return
    e.preventDefault()
    e.stopPropagation()                     // zoom and the swarm spotlight never see it
    const next = clampDepth(this.#depth + (e.deltaY < 0 ? 1 : -1), this.#maxDepthAvailable, MAX_DEPTH)
    if (next === this.#depth) return
    this.#depth = next
    void this.#resolveAndPaint()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#diving()) return
    if (e.button !== 0) return
    e.stopPropagation()                     // tile-overlay must not act on the hidden page
    const node = this.#nodeUnderCursor(e.clientX, e.clientY)
    if (!node) { this.#endDive(); return }   // a press on empty space just backs out

    consumePointerGesture(e.pointerId)      // trailing pointerup + click die at window capture

    // EXECUTE THE TILE AS IF IT STOOD IN FRONT OF YOU. The plan is decided
    // while the dive still knows where it was made from; the page comes back
    // BEFORE anything travels, so the destination paints over a clean floor.
    const full = [...node.parent, node.name]
    const vm = window.ioc.get<{ mode?: string }>('@hypercomb.social/ViewMode')
    const plan = diveClickPlan({
      segments: full,
      referenceTarget: node.referenceTarget,
      arrivalView: defaultViewWithinSegments(full),
      from: this.#baseSegments,
      mode: String(vm?.mode ?? '').trim(),
    })
    this.#endDive()

    if (plan.kind === 'reference') this.emitEffect('tile:navigate-reference', { label: node.name, target: [...plan.travel] })
    else this.emitEffect('tile:navigate-in', { label: node.name })
    // Told BEFORE the walk, while "here" still means the page the dive was
    // made from — the destination's view comes back out onto it.
    if (plan.spawn) this.emitEffect(VIEW_SPAWN_EFFECT, plan.spawn)
    window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')?.goRaw?.([...plan.travel])
  }

  // ── dive lifecycle ────────────────────────────────────────────────

  /** Begin a dive on the tile under the cursor, if it can be dived into. */
  async #tryStartDive(): Promise<void> {
    if (this.#subject !== null || !this.#altHeld || !this.#overCanvas) return
    const axial = this.#cursorAxial()
    if (!axial) return
    const label = this.#byAxial.get(`${axial.q},${axial.r}`) ?? null
    if (!label) return
    if (this.#shadedSet.has(label)) return      // still warming — inert everywhere
    if (this.#externalSet.has(label)) return    // peer tile: no local layers to dive
    if (!this.#branchSet.has(label)) return     // a leaf has nothing inside

    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    this.#baseSegments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    this.#subject = label
    this.#depth = 1
    this.#maxDepthAvailable = 1
    await this.#resolveAndPaint()
  }

  /** Give the page back and drop everything the dive owned. Safe to call twice. */
  #endDive(): void {
    this.#buildToken++                      // cancel any in-flight resolution
    const wasActive = this.#active
    this.#active = false
    this.#subject = null
    this.#nodes = []
    this.#nodeByAxial.clear()
    this.#hoverLabel = null
    if (wasActive) this.emitEffect('render:dive', { cells: null })
  }

  // ── resolution (merkle walk, sig-cached) ──────────────────────────

  /** Resolve the generation at the current depth and hand it to show-cell. */
  async #resolveAndPaint(): Promise<void> {
    const token = ++this.#buildToken
    const subject = this.#subject
    if (!subject) return

    const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt || !history.getLayerBySig) { this.#endDive(); return }

    const segments = [...this.#baseSegments, subject]

    // Heads MOVE with every commit, so this read is deliberately uncached;
    // everything below it is addressed by signature and cached forever.
    let childSigs: string[] = []
    try {
      const head = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
      if (token !== this.#buildToken) return
      childSigs = Array.isArray(head?.children) ? head!.children.map(c => String(c ?? '').trim()).filter(Boolean) : []
    } catch { this.#endDive(); return }
    if (childSigs.length === 0) { this.#endDive(); return }

    // Walk down to the requested generation. Each level records how deep the
    // subject actually goes, so the wheel can be clamped to real ground.
    type Frontier = { sigs: string[]; path: string[] }
    let frontier: Frontier[] = [{ sigs: childSigs, path: [] }]
    let deepest = 1
    let generation: { node: LayerNode; path: string[] }[] = []

    for (let level = 1; level <= this.#depth && frontier.length > 0; level++) {
      const resolved: { node: LayerNode; path: string[] }[] = []
      const next: Frontier[] = []
      for (const f of frontier) {
        for (const sig of f.sigs) {
          if (resolved.length >= MAX_TILES) break
          const node = await this.#resolveLayer(sig, history)
          if (token !== this.#buildToken) return
          if (!node?.name) continue
          const path = [...f.path, node.name]
          resolved.push({ node, path })
          if (node.childSigs.length > 0) next.push({ sigs: node.childSigs, path })
        }
      }
      if (resolved.length === 0) break
      generation = resolved
      deepest = level
      frontier = next
    }

    this.#maxDepthAvailable = depthAvailableFrom(deepest, frontier.length > 0)
    // The wheel may have asked for deeper ground than exists — settle on the
    // deepest real generation instead of showing an empty dive.
    this.#depth = clampDepth(this.#depth, this.#maxDepthAvailable, MAX_DEPTH)
    if (generation.length === 0) { this.#endDive(); return }

    // The generation's decorations, indexed by FULL PATH first: a portal
    // shimmers in the dive and a click routes exactly as tile-overlay would
    // route the real tile. One layer read per label, memoised by path.
    const byParent = new Map<string, { parent: string[]; names: string[] }>()
    for (const { path } of generation) {
      const parent = [...segments, ...path.slice(0, -1)]
      const key = parent.join('/')
      const group = byParent.get(key) ?? { parent, names: [] }
      group.names.push(path[path.length - 1])
      byParent.set(key, group)
    }
    await Promise.all([...byParent.values()].map(g => ensureDecorationsIndexed(g.names, g.parent).catch(() => undefined)))
    if (token !== this.#buildToken) return

    // Lay the generation out on the SAME axial matrix a real layer uses, each
    // tile wearing the face its own page would give it.
    const slots = this.#gridSlots(generation.length)
    const nodes: DiveNode[] = []
    for (let i = 0; i < generation.length && i < slots.length; i++) {
      const { node, path } = generation[i]
      const parent = [...segments, ...path.slice(0, -1)]
      const face = await this.#resolveFace(node.name, parent)
      if (token !== this.#buildToken) return
      const referenceTarget = referenceTargetAt([...parent, node.name])
      nodes.push({
        slot: slots[i],
        name: node.name,
        parent,
        referenceTarget,
        cell: {
          q: slots[i].q,
          r: slots[i].r,
          label: node.name,
          imageSig: face.image,
          hasBranch: node.childSigs.length > 0,
          hideText: face.hideText,
          borderColor: face.borderColor,
          portal: referenceTarget !== null,
        },
      })
    }

    this.#nodes = nodes
    this.#nodeByAxial.clear()
    for (const n of nodes) this.#nodeByAxial.set(`${n.slot.q},${n.slot.r}`, n)
    this.#active = true
    this.emitEffect('render:dive', { cells: nodes.map(n => n.cell) })
    this.#hoverLabel = null
    this.#updateDiveHover()
  }

  async #resolveLayer(entry: string, history: HistoryLike): Promise<LayerNode | null> {
    if (this.#layerCache.has(entry)) return this.#layerCache.get(entry) ?? null
    let node: LayerNode | null = null
    try {
      if (SIG.test(entry)) {
        const layer = await history.getLayerBySig(entry)
        if (layer) {
          node = {
            name: typeof layer.name === 'string' ? layer.name : '',
            childSigs: Array.isArray(layer.children) ? layer.children.map(c => String(c ?? '').trim()).filter(Boolean) : [],
          }
        }
      } else {
        // A legacy child entry stored by NAME is not addressable as content —
        // it shows as a labelled hex with nothing below it.
        node = { name: entry, childSigs: [] }
      }
    } catch { node = null }
    if (SIG.test(entry)) this.#layerCache.set(entry, node)   // by-sig results are immutable
    return node
  }

  /** A tile's face, resolved the way the PAGE resolves it, in the same order:
   *    1. the EFFECTIVE properties — root defaults under the layer's own
   *       overrides (`readTilePropertiesAt`), the picture read by the
   *       renderer's own key (`recoverableTileImageSig`);
   *    2. the participant-local props index (`hc:tile-props-index`) when the
   *       canonical slot is cold — what show-cell actually paints from then;
   *    3. no picture at all → the substrate's deterministic pick for this
   *       name, exactly as the page would show it.
   *  Anything less and a dive disagrees with the page about what a tile is. */
  async #resolveFace(name: string, parentSegments: readonly string[]): Promise<TileFace> {
    let props: Record<string, unknown> = {}
    try { props = await readTilePropertiesAt(parentSegments, name) } catch { props = {} }
    let image = recoverableTileImageSig(props, this.#flat)
    if (!image) {
      try {
        const key = await cellLocationSig(parentSegments, name)
        const indexed = await this.#propsBySig(lookupTilePropsSig(readTilePropsIndex(), key, name))
        if (indexed) {
          image = recoverableTileImageSig(indexed, this.#flat)
          if (Object.keys(props).length === 0) props = indexed
        }
      } catch { /* index unavailable — the substrate answers below */ }
    }
    if (!image) {
      const substrate = window.ioc.get<{ pickImageForLabel?: (label: string) => string | null }>('@diamondcoreprocessor.com/SubstrateService')
      image = substrate?.pickImageForLabel?.(name) ?? undefined
    }
    return { image, hideText: props['hideText'] === true, borderColor: borderColorFromProps(props) }
  }

  async #propsBySig(sig: string | undefined): Promise<Record<string, unknown> | null> {
    if (!sig || !SIG.test(sig)) return null
    if (this.#propsCache.has(sig)) return this.#propsCache.get(sig) ?? null
    let props: Record<string, unknown> | null = null
    try {
      const store = window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (blob) props = JSON.parse(await blob.text()) as Record<string, unknown>
    } catch { props = null }
    this.#propsCache.set(sig, props)       // sig-keyed: content is immutable
    return props
  }

  // ── hover ─────────────────────────────────────────────────────────

  /** Light up the dived tile under the cursor — the one a click executes. */
  #updateDiveHover(): void {
    if (!this.#active) return
    const axial = this.#cursorAxial()
    const node = axial ? this.#nodeByAxial.get(`${axial.q},${axial.r}`) ?? null : null
    const label = node?.name ?? null
    if (label === this.#hoverLabel) return
    this.#hoverLabel = label
    this.emitEffect('render:dive-hover', { label })
  }

  #nodeUnderCursor(clientX: number, clientY: number): DiveNode | null {
    const axial = this.#clientToAxial(clientX, clientY)
    return axial ? this.#nodeByAxial.get(`${axial.q},${axial.r}`) ?? null : null
  }

  // ── geometry helpers (same transforms as move-preview / tile-overlay) ──

  /** The first `count` slots of the axial matrix a real layer is laid out on. */
  #gridSlots(count: number): Axial[] {
    const axial = window.ioc.get<{ items?: Map<number, { q: number; r: number }> }>(
      '@diamondcoreprocessor.com/AxialService',
    )
    const out: Axial[] = []
    for (let i = 0; i < count; i++) {
      const item = axial?.items?.get(i)
      if (!item) break
      out.push({ q: item.q, r: item.r })
    }
    return out
  }

  #cursorAxial(): Axial | null {
    return this.#lastClient ? this.#clientToAxial(this.#lastClient.x, this.#lastClient.y) : null
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null
    const detector = window.ioc.get<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>(
      '@diamondcoreprocessor.com/HexDetector',
    )
    if (!detector) return null
    const events = (this.#renderer as { events?: { mapPositionToPoint?: (p: Point, x: number, y: number) => void } }).events
    let gx: number, gy: number
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      gx = out.x; gy = out.y
    } else {
      const rect = this.#canvas.getBoundingClientRect()
      const screen = this.#renderer.screen
      gx = (cx - rect.left) * (screen.width / rect.width)
      gy = (cy - rect.top) * (screen.height / rect.height)
    }
    const local = this.#renderContainer.toLocal(new Point(gx, gy))
    return detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat)
  }
}

const _waveView = new WaveViewDrone()
window.ioc.register('@diamondcoreprocessor.com/WaveViewDrone', _waveView)
