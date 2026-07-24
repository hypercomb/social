// diamondcoreprocessor.com/presentation/tiles/wave-view.drone.ts
//
// WAVE VIEW — hold Alt to DIVE into the layers under a tile.
//
// Hold Alt over a tile and the mesh is REPLACED by what is inside it: its
// children take over the grid, at full size, in the same slots a real layer
// would use — so a dive looks exactly like the place you are about to go,
// not like a decoration floating over the place you are. Alt+wheel dives
// deeper (grandchildren, then great-grandchildren) or rises back up.
//
// Because the previewed tiles ARE the mesh while you hold Alt, you can move
// over any of them; the one under the cursor lights up. Then:
//   - CLICK a tile  → you go there for real. That is the commit.
//   - RELEASE Alt   → everything snaps back exactly as it was. Nothing moved,
//                     nothing was written; the dive was only ever a look.
//
// The hive is hidden through `render:set-hive-visible`, the same takeover
// lever the screensaver uses, so show-cell keeps ownership of its own mesh
// and no renderer internals are reached into. Every exit path restores it —
// including dispose — because a stranded dive would leave a blank hive.
//
// While diving this drone OWNS the pointer: moves and presses are stopped at
// window capture so tile-overlay cannot act on the hidden layer underneath
// (its action icons live in a different container and would otherwise float
// over the dive, wired to tiles nobody can see).
//
// Read-only: head resolution is fresh per dive (heads move), while layer
// content, properties blobs and textures are cached by signature — immutable,
// so those caches never go stale. Nothing is ever written.

import { Drone, consumePointerGesture } from '@hypercomb/core'
import { Container, Graphics, Sprite, Text, Texture, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { cellLocationSig, lookupTilePropsSig, readTilePropsIndex } from '../../editor/tile-properties.js'
import {
  waveImageSigFromProps,
  waveHideTextFromProps,
  depthAvailableFrom,
  clampDepth,
  type Axial,
} from './wave-layout.js'

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
  getLayerBySig(sig: string): Promise<{ name?: unknown; children?: unknown; properties?: unknown } | null>
}

/** One tile of the previewed generation. */
type DiveNode = {
  slot: Axial            // grid slot, from the same axial matrix a real layer uses
  path: string[]         // names from the dive subject DOWN to this tile
  name: string
  imageSig?: string
  hideText?: boolean     // tile asks for its picture to speak for itself
}

/** What a tile shows: its picture, and whether its name is suppressed. */
type TileFace = { image?: string; hideText: boolean }

/** Immutable layer content, resolved once per signature. */
type LayerNode = { name: string; childSigs: string[]; propsSig?: string }

const SIG = /^[a-f0-9]{64}$/i

const DIVE_Z = 7005                 // above move-preview's held cluster (7002)
const MAX_DEPTH = 5                 // wheel-reachable generations
const MAX_TILES = 120               // a very wide generation stops here
const TILE_FILL = 0x0e1018
const TILE_FILL_ALPHA = 0.96
const TILE_BORDER = 0x7eb6d6        // steel hairline (matches chrome)
const TILE_BORDER_ALPHA = 0.85
const TILE_BORDER_WIDTH = 1.2
const HOVER_BORDER = 0xa8ffd8       // the tile a click would commit to
const HOVER_BORDER_WIDTH = 2.4
const TILE_LABEL_FILL = 0xdceaf5
const LABEL_SIZE_FACTOR = 0.22      // label height as a fraction of the tile radius
const LABEL_MAX_WIDTH_FACTOR = 1.45 // a name wider than this shrinks to fit its hex
/** Rasterise text at the scale it is actually seen at, capped so a deep zoom
 *  cannot mint enormous glyph textures. Floor of 2 keeps it crisp on a 1x display. */
const LABEL_RESOLUTION = (worldScale: number): number =>
  Math.min(4, Math.max(2, worldScale * (globalThis.devicePixelRatio || 1)))
const TEXTURE_CACHE_MAX = 128

export class WaveViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'navigation'
  override description =
    'Hold Alt to dive: the tile under the cursor is replaced by what is inside it, alt+wheel goes deeper, clicking a previewed tile travels there, releasing Alt restores the hive untouched.'

  // ── render plumbing ───────────────────────────────────────────────
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: HostReadyPayload['renderer'] | null = null
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38                             // centre-to-centre: circumradius + gap
  #circumRadius = 32                        // the hex itself
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
  #subject: string | null = null            // the tile the dive is anchored to
  #baseSegments: string[] = []              // location of the subject's PARENT
  #depth = 1                                // generation on screen: 1 = children
  #maxDepthAvailable = 1                    // deepest generation this subject has
  #layer: Container | null = null           // the painted dive
  #nodes: DiveNode[] = []
  #nodeByAxial = new Map<string, DiveNode>()
  #hoverKey: string | null = null           // "q,r" of the previewed tile under the cursor
  #hiveHidden = false
  #buildToken = 0

  // sig-addressed caches — content is immutable, so these never go stale
  #layerCache = new Map<string, LayerNode | null>()
  #propsFaceCache = new Map<string, TileFace>()
  #textures = new Map<string, Texture | null>()

  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:geometry-changed', 'render:set-orientation', 'render:cell-count']
  protected override emits = ['render:set-hive-visible']

  #wired = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#renderContainer.sortableChildren = true
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => { this.#meshOffset = offset })
    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (geo) => {
      if (geo?.spacing) this.#spacing = geo.spacing
      if (geo?.circumRadiusPx) this.#circumRadius = geo.circumRadiusPx
    })
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
      if (this.#diving()) this.#endDive()
    })

    window.addEventListener('pointermove', this.#onPointerMove, true)
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('blur', this.#onWindowBlur)
    window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', this.#onPointerDown, true)
  }

  protected override dispose(): void {
    window.removeEventListener('pointermove', this.#onPointerMove, true)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('blur', this.#onWindowBlur)
    window.removeEventListener('wheel', this.#onWheel, { capture: true } as EventListenerOptions)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    this.#endDive()                         // never strand a hidden hive
    for (const t of this.#textures.values()) { try { t?.destroy(true) } catch { /* gone */ } }
    this.#textures.clear()
  }

  #diving(): boolean { return this.#layer !== null }

  // ── input ─────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    this.#lastClient = { x: e.clientX, y: e.clientY }
    this.#overCanvas = e.target === this.#canvas
    const altChanged = this.#altHeld !== e.altKey
    this.#altHeld = e.altKey

    if (this.#diving()) {
      // The dive owns the pointer: the mesh underneath is hidden, so nothing
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
    e.stopPropagation()                     // tile-overlay must not act on the hidden layer
    const node = this.#nodeUnderCursor(e.clientX, e.clientY)
    if (!node) { this.#endDive(); return }   // a press on empty space just backs out

    consumePointerGesture(e.pointerId)      // trailing pointerup + click die at window capture
    const path = [...this.#baseSegments, this.#subject!, ...node.path]
    this.#endDive()                         // restore the hive BEFORE the new layer paints
    window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')?.goRaw?.(path)
  }

  // ── dive lifecycle ────────────────────────────────────────────────

  /** Begin a dive on the tile under the cursor, if it can be dived into. */
  async #tryStartDive(): Promise<void> {
    if (this.#diving() || !this.#altHeld || !this.#overCanvas) return
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

  /** Restore the hive and drop everything the dive owned. Safe to call twice. */
  #endDive(): void {
    this.#buildToken++                      // cancel any in-flight resolution
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })  // textures are cache-owned, not auto-destroyed
      this.#layer = null
    }
    this.#nodes = []
    this.#nodeByAxial.clear()
    this.#hoverKey = null
    this.#subject = null
    if (this.#hiveHidden) {
      this.#hiveHidden = false
      this.emitEffect('render:set-hive-visible', { visible: true })
    }
  }

  // ── resolution (merkle walk, sig-cached) ──────────────────────────

  /** Resolve the generation at the current depth and paint it. */
  async #resolveAndPaint(): Promise<void> {
    const token = ++this.#buildToken
    const subject = this.#subject
    if (!subject) return

    const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history.currentLayerAt || !history.getLayerBySig) return

    const segments = [...this.#baseSegments, subject]

    // Heads MOVE with every commit, so this read is deliberately uncached;
    // everything below it is addressed by signature and cached forever.
    let childSigs: string[] = []
    try {
      const head = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
      if (token !== this.#buildToken) return
      childSigs = Array.isArray(head?.children) ? head!.children.map(c => String(c ?? '').trim()).filter(Boolean) : []
    } catch { return }
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

    // Lay the generation out on the SAME axial matrix a real layer uses, so a
    // dive is indistinguishable from the place it previews.
    const slots = this.#gridSlots(generation.length)
    const nodes: DiveNode[] = []
    for (let i = 0; i < generation.length && i < slots.length; i++) {
      const { node, path } = generation[i]
      const face = await this.#resolveFace(node.name, [...segments, ...path.slice(0, -1)], node.propsSig)
      if (token !== this.#buildToken) return
      nodes.push({ slot: slots[i], path, name: node.name, imageSig: face.image, hideText: face.hideText })
    }

    // Decode every image BEFORE painting: the dive lands once, complete, and
    // never as a trickle of tiles popping in.
    for (const n of nodes) {
      if (n.imageSig) await this.#texture(n.imageSig)
      if (token !== this.#buildToken) return
    }

    this.#paint(nodes)
  }

  async #resolveLayer(entry: string, history: HistoryLike): Promise<LayerNode | null> {
    if (this.#layerCache.has(entry)) return this.#layerCache.get(entry) ?? null
    let node: LayerNode | null = null
    try {
      if (SIG.test(entry)) {
        const layer = await history.getLayerBySig(entry)
        if (layer) {
          const props = Array.isArray(layer.properties) ? layer.properties : []
          node = {
            name: typeof layer.name === 'string' ? layer.name : '',
            childSigs: Array.isArray(layer.children) ? layer.children.map(c => String(c ?? '').trim()).filter(Boolean) : [],
            propsSig: typeof props[0] === 'string' && SIG.test(props[0]) ? props[0] : undefined,
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

  /** The tile's image signature, resolved through the SAME TWO STORES the
   *  renderer reads, in the same order — so anything you can SEE on a tile
   *  shows in the dive:
   *    1. CANONICAL — the tile's own layer slot (`properties[0]`).
   *    2. PARTICIPANT-LOCAL props index (`hc:tile-props-index`) — what
   *       show-cell actually paints from, lineage-keyed with a bare-label
   *       legacy fallback.
   *  Canonical alone renders a labelled hex for every tile whose image only
   *  ever reached the index, which is most of them. */
  async #resolveFace(
    name: string,
    parentSegments: readonly string[],
    canonicalPropsSig?: string,
  ): Promise<TileFace> {
    const fromPropsSig = async (sig?: string): Promise<TileFace | undefined> => {
      if (!sig || !SIG.test(sig)) return undefined
      const cached = this.#propsFaceCache.get(sig)
      if (cached) return cached
      let face: TileFace = { hideText: false }
      try {
        const store = window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
        const blob = await store?.getResource?.(sig)
        if (blob) {
          const props = JSON.parse(await blob.text())
          face = { image: waveImageSigFromProps(props), hideText: waveHideTextFromProps(props) }
        }
      } catch { /* cold or unparsable — labelled hex fallback */ }
      this.#propsFaceCache.set(sig, face)     // sig-keyed: content is immutable
      return face
    }

    const canonical = await fromPropsSig(canonicalPropsSig)
    if (canonical?.image) return canonical
    try {
      const key = await cellLocationSig(parentSegments, name)
      const indexed = await fromPropsSig(lookupTilePropsSig(readTilePropsIndex(), key, name))
      if (indexed?.image) return indexed
    } catch { /* index unavailable — fall through */ }
    return canonical ?? { hideText: false }
  }

  async #texture(sig: string): Promise<Texture | null> {
    if (this.#textures.has(sig)) return this.#textures.get(sig) ?? null
    let tex: Texture | null = null
    try {
      const store = window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (blob) tex = Texture.from(await createImageBitmap(blob))
    } catch { tex = null }
    if (this.#textures.size >= TEXTURE_CACHE_MAX) {
      const oldest = this.#textures.keys().next().value
      if (oldest !== undefined) {
        try { this.#textures.get(oldest)?.destroy(true) } catch { /* gone */ }
        this.#textures.delete(oldest)
      }
    }
    this.#textures.set(sig, tex)
    return tex
  }

  // ── painting ──────────────────────────────────────────────────────

  #paint(nodes: DiveNode[]): void {
    if (!this.#renderContainer) return

    // Hide the hive only once we have a complete generation to put in its
    // place — hiding earlier would flash an empty canvas while resolving.
    if (!this.#hiveHidden) {
      this.#hiveHidden = true
      this.emitEffect('render:set-hive-visible', { visible: false })
    }

    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })
    }

    const layer = new Container()
    layer.zIndex = DIVE_Z
    const r = this.#hexRadius()

    this.#nodeByAxial.clear()
    for (const n of nodes) {
      const p = this.#axialToPixel(n.slot.q, n.slot.r)
      const tile = this.#buildTileNode(r, n)
      tile.position.set(p.x + this.#meshOffset.x, p.y + this.#meshOffset.y)
      layer.addChild(tile)
      this.#nodeByAxial.set(`${n.slot.q},${n.slot.r}`, n)
    }

    this.#renderContainer.addChild(layer)
    this.#layer = layer
    this.#nodes = nodes
    this.#hoverKey = null
    this.#updateDiveHover()
  }

  #buildTileNode(tileR: number, n: DiveNode): Container {
    const node = new Container()

    const body = new Graphics()
    const verts = this.#hexVerts(0, 0, tileR)
    body.poly(verts, true)
    body.fill({ color: TILE_FILL, alpha: TILE_FILL_ALPHA })
    body.poly(verts, true)
    body.stroke({ color: TILE_BORDER, alpha: TILE_BORDER_ALPHA, width: TILE_BORDER_WIDTH })
    node.addChild(body)

    const tex = n.imageSig ? this.#textures.get(n.imageSig) ?? null : null
    if (tex) {
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5)
      const side = tileR * 1.75
      const s = Math.max(side / (tex.width || side), side / (tex.height || side))
      sprite.scale.set(s)
      const mask = new Graphics()
      mask.poly(this.#hexVerts(0, 0, tileR * 0.97), true)
      mask.fill({ color: 0xffffff })
      node.addChild(sprite)
      node.addChild(mask)
      sprite.mask = mask
    }

    // The name goes ON TOP of the picture, exactly as the mesh superimposes
    // it — a dive of nothing but images tells you nothing about what you are
    // looking at. Only a tile that explicitly asks to hide its text AND has a
    // picture to speak for itself goes without.
    if (!(n.hideText && tex)) {
      const size = tileR * LABEL_SIZE_FACTOR
      const text = new Text({
        text: this.#shortLabel(n.name),
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: size,
          fontWeight: '600',
          fill: TILE_LABEL_FILL,
          align: 'center',
        },
      })
      // The stage is SCALED (zoom), and a Text is rasterised to a texture at
      // its own resolution before that scale is applied — leave it at 1 and
      // every label is magnified from a too-small bitmap, which is exactly
      // what made them blurry. Rasterise at the scale it will actually be
      // seen at. Zoom cannot change mid-dive (the dive eats the wheel), so
      // this stays correct for the life of the preview.
      text.resolution = LABEL_RESOLUTION(this.#worldScale())
      text.anchor.set(0.5)

      // A long name is wider than the hex it belongs to. Shrink it to fit
      // rather than letting it spill across neighbouring tiles.
      const maxWidth = tileR * LABEL_MAX_WIDTH_FACTOR
      if (text.width > maxWidth) text.scale.set(maxWidth / text.width)

      // Over a picture the label needs its own ground or it dissolves into
      // whatever is behind it — a flat band, no glow, no shadow.
      if (tex) {
        const padX = size * 0.42, padY = size * 0.26
        const scrim = new Graphics()
        scrim.rect(
          -(text.width / 2 + padX), -(text.height / 2 + padY),
          text.width + padX * 2, text.height + padY * 2,
        )
        scrim.fill({ color: 0x000000, alpha: 0.55 })
        node.addChild(scrim)
      }
      node.addChild(text)
    }

    // Hover ring, toggled by #updateDiveHover — built once so the highlight
    // costs a visibility flip per pointer move, never a rebuild.
    const ring = new Graphics()
    ring.poly(this.#hexVerts(0, 0, tileR), true)
    ring.stroke({ color: HOVER_BORDER, alpha: 0.95, width: HOVER_BORDER_WIDTH })
    ring.visible = false
    ring.label = 'hover-ring'
    node.addChild(ring)

    return node
  }

  /** Light up the previewed tile under the cursor — the one a click commits to. */
  #updateDiveHover(): void {
    if (!this.#layer) return
    const axial = this.#cursorAxial()
    const key = axial ? `${axial.q},${axial.r}` : null
    const hit = key && this.#nodeByAxial.has(key) ? key : null
    if (hit === this.#hoverKey) return
    this.#hoverKey = hit

    for (let i = 0; i < this.#nodes.length; i++) {
      const n = this.#nodes[i]
      const ring = (this.#layer.children[i] as Container | undefined)
        ?.children.find(c => (c as { label?: string }).label === 'hover-ring')
      if (ring) ring.visible = hit === `${n.slot.q},${n.slot.r}`
    }
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

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }

  /** The hex's circumradius in RENDER space, straight from the renderer's own
   *  geometry. NOT the spacing: spacing is radius PLUS the inter-tile gap
   *  (32 + 6 = 38), so sizing tiles by spacing inflates them and closes the
   *  gap the mesh deliberately leaves. (Settings' `hexagonDimensions` is the
   *  200-scale coordinate space — `hexagonSide: 200`, no circumRadius at all —
   *  so reading it there silently pinned this to the fallback forever.) */
  #hexRadius(): number {
    return this.#circumRadius
  }

  /** Accumulated scale from this container up to the stage — what a local unit
   *  actually measures on screen.
   *
   *  Walks the parent chain rather than reading `worldTransform`: that matrix
   *  is only recomputed during a render pass, so at paint time it still held
   *  the previous frame's values and reported 1 while the mesh was really
   *  drawn at ~1.8 — which would have under-sampled every label right back
   *  into blurriness at any real zoom. `scale` is always current. */
  #worldScale(): number {
    let s = 1
    for (let n = this.#renderContainer as Container | null; n; n = n.parent as Container | null) {
      s *= Math.abs(n.scale?.x ?? 1) || 1
    }
    const dpr = globalThis.devicePixelRatio || 1
    const total = s * (this.#renderer?.resolution ?? 1) / dpr
    return Number.isFinite(total) && total > 0 ? total : 1
  }

  /** Pointy-top hex vertices about (cx, cy). */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }

  /** The WHOLE name, trimmed only when it cannot fit. Taking the first word
   *  (what the held-drag cluster does, where a tile is a thumbnail) threw away
   *  most of a multi-word name — the point of the label here is to tell you
   *  what the tile IS. */
  #shortLabel(label: string): string {
    const name = label.trim()
    return name.length > 16 ? `${name.slice(0, 15)}…` : name
  }

}

const _waveView = new WaveViewDrone()
window.ioc.register('@diamondcoreprocessor.com/WaveViewDrone', _waveView)
