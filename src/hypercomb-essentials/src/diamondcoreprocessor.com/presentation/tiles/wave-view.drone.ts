// diamondcoreprocessor.com/presentation/tiles/wave-view.drone.ts
//
// WAVE VIEW — Alt+hover quick-look into the next layer(s).
//
// Hold Alt while hovering a tile and its children materialize on the six
// hexes AROUND the hovered tile — a wave of the next level washing up onto
// the current one. The pointer keeps moving over CURRENT-layer tiles (the
// preview is render-only and never captures hover); gliding to the next
// tile re-centers the wave on it. Alt+wheel while a wave is showing pulls
// MORE levels into view: deeper levels continue outward in the slot spiral,
// sharing partially-filled rings (3 children leave 3 ring-1 slots — the
// grandchildren start there and spill into ring 2). Clicking a wave tile
// travels straight to it (Navigation.goRaw with the full path), so the
// next level — or two below — is one click away.
//
// Input ownership: alt+wheel normally belongs to the swarm spotlight
// (spotlight-scroll.input.ts). This drone pre-empts it at window CAPTURE
// phase ONLY while a wave is actually showing — alt+wheel over empty space
// or with no wave still cycles the spotlight. Clicks on wave slots are
// likewise intercepted at capture before tile-overlay's document handlers,
// and the trailing click is consumed via consumePointerGesture.
//
// Read-only: head resolution is fresh per build (mutable), while layer
// content, properties blobs, and textures are cached by signature —
// immutable, so the caches never go stale. Nothing is written anywhere.

import { Drone, consumePointerGesture } from '@hypercomb/core'
import { Container, Graphics, Sprite, Text, Texture, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type Axial = { q: number; r: number }

type CellCountPayload = {
  count: number
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

type WaveNode = {
  slot: Axial          // absolute grid slot the preview tile occupies
  path: string[]       // names from the hovered tile DOWN to this node
  level: number        // 1 = children, 2 = grandchildren, …
  imageSig?: string
  name: string
}

/** Immutable layer content resolved once per signature. */
type LayerNode = { name: string; childSigs: string[]; propsSig?: string }

const SIG = /^[a-f0-9]{64}$/i

// Axial neighbor directions, pointy-top winding.
const DIRS: Axial[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
]

const WAVE_Z = 7005                 // above move-preview's held cluster (7002)
const MAX_DEPTH = 4                 // wheel-expandable levels
const MAX_RINGS = 4                 // slot spiral bound: 6+12+18+24 = 60 tiles
const NODE_R_FACTOR = 0.78          // level-1 tile radius as fraction of hex radius
const LEVEL_SCALE = 0.88            // each deeper level shrinks by this
const LEVEL_ALPHA = 0.94            // …and fades by this
const TILE_FILL = 0x0e1018
const TILE_FILL_ALPHA = 0.94
const TILE_BORDER = 0x7eb6d6        // steel hairline (matches chrome)
const TILE_BORDER_ALPHA = 0.92
const TILE_BORDER_WIDTH = 1.2
const TILE_LABEL_FILL = 0xdceaf5
const TEXTURE_CACHE_MAX = 96

export class WaveViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'navigation'
  override description =
    'Alt+hover quick-look: renders the hovered tile\'s children on the surrounding hexes; alt+wheel pulls deeper levels into the slot spiral; clicking a preview tile travels straight into it.'

  // ── render plumbing (mirrored the same way move-preview does) ─────
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: HostReadyPayload['renderer'] | null = null
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38
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
  #hoverAxial: Axial | null = null
  #hoverLabel: string | null = null
  #depth = 1

  // ── built wave ────────────────────────────────────────────────────
  #layer: Container | null = null
  #placed: WaveNode[] = []
  #builtSegments: string[] = []             // absolute path INCLUDING the hovered tile
  #builtKey: string | null = null           // label+depth identity of the painted wave
  #buildToken = 0

  // sig-addressed caches — content is immutable, so these never go stale
  #layerCache = new Map<string, LayerNode | null>()
  #propsImageCache = new Map<string, string | undefined>()
  #textures = new Map<string, Texture | null>()

  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:geometry-changed', 'render:set-orientation', 'render:cell-count']
  protected override emits: string[] = []

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
    this.onEffect<{ spacing?: number }>('render:geometry-changed', (geo) => { if (geo?.spacing) this.#spacing = geo.spacing })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#flat = !!p?.flat })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#byAxial.clear()
      for (let i = 0; i < payload.labels.length; i++) {
        const c = payload.coords[i]
        if (c) this.#byAxial.set(`${c.q},${c.r}`, payload.labels[i])
      }
      this.#branchSet = new Set(payload.branchLabels)
      this.#externalSet = new Set(payload.externalLabels)
      this.#shadedSet = new Set(payload.shadedLabels)
      // The layer under the wave changed (nav, edit, sync) — the painted
      // wave describes stale tiles. Re-derive from the last cursor.
      this.#clearWave()
      this.#syncHoverFromClient()
      this.#refresh()
    })

    document.addEventListener('pointermove', this.#onPointerMove, { passive: true })
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('keyup', this.#onKeyUp, true)
    window.addEventListener('blur', this.#onWindowBlur)
    window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', this.#onPointerDown, true)
  }

  protected override dispose(): void {
    document.removeEventListener('pointermove', this.#onPointerMove)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('keyup', this.#onKeyUp, true)
    window.removeEventListener('blur', this.#onWindowBlur)
    window.removeEventListener('wheel', this.#onWheel, { capture: true } as EventListenerOptions)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    this.#clearWave()
    for (const t of this.#textures.values()) { try { t?.destroy(true) } catch { /* gone */ } }
    this.#textures.clear()
  }

  // ── input ─────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    this.#lastClient = { x: e.clientX, y: e.clientY }
    const overCanvas = e.target === this.#canvas
    const altChanged = this.#altHeld !== e.altKey
    this.#altHeld = e.altKey
    const canvasChanged = this.#overCanvas !== overCanvas
    this.#overCanvas = overCanvas
    const hexChanged = this.#syncHoverFromClient()
    if (altChanged || canvasChanged || hexChanged) this.#refresh()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt' || e.repeat) return
    if (this.#typingContext()) return
    // Keep the browser from arming its menu bar on the bare Alt press.
    e.preventDefault()
    this.#altHeld = true
    this.#refresh()
  }

  #onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt') return
    if (this.#altHeld) e.preventDefault()   // Firefox focuses the menu on Alt RELEASE
    this.#altHeld = false
    this.#refresh()
  }

  #onWindowBlur = (): void => {
    // Alt+Tab away would otherwise leave the modifier latched on.
    this.#altHeld = false
    this.#refresh()
  }

  #onWheel = (e: WheelEvent): void => {
    if (!this.#showing()) return
    const target = e.target as Element | null
    if (target?.closest?.('[data-consumes-wheel]')) return
    e.preventDefault()
    e.stopPropagation()                     // spotlight + zoom never see it
    const next = Math.min(MAX_DEPTH, Math.max(1, this.#depth + (e.deltaY < 0 ? 1 : -1)))
    if (next === this.#depth) return
    this.#depth = next
    this.#refresh()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#showing() || this.#placed.length === 0) return
    if (e.button !== 0) return
    if (e.target !== this.#canvas) return
    const axial = this.#clientToAxial(e.clientX, e.clientY)
    if (!axial) return
    const node = this.#placed.find(n => n.slot.q === axial.q && n.slot.r === axial.r)
    if (!node) return                       // press over the center tile or empty ring space falls through

    e.stopPropagation()                     // tile-overlay's document handlers never fire
    consumePointerGesture(e.pointerId)      // trailing pointerup + click die at window capture

    const nav = window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
    nav?.goRaw?.([...this.#builtSegments, ...node.path])
    this.#clearWave()                       // the arriving layer repaints under a fresh hover
  }

  // ── show / hide decision ──────────────────────────────────────────

  #showing(): boolean {
    return this.#altHeld && this.#overCanvas && this.#hoverLabel !== null && this.#layer !== null
  }

  #refresh(): void {
    const label = this.#hoverLabel
    const wantWave = this.#altHeld && this.#overCanvas && !!label
      && !this.#shadedSet.has(label!)       // warming tiles are inert everywhere
      && !this.#externalSet.has(label!)     // peer tiles have no local child layers
      && this.#branchSet.has(label!)        // leaves have nothing to preview

    if (!wantWave) {
      this.#buildToken++                    // cancel any in-flight build
      this.#clearWave()
      return
    }

    const key = `${label}\u0001${this.#depth}`
    if (key === this.#builtKey) return      // already painted for this tile+depth
    void this.#build(label!, this.#hoverAxial!, key)
  }

  // ── resolution (merkle walk, sig-cached) ──────────────────────────

  async #build(label: string, center: Axial, key: string): Promise<void> {
    const token = ++this.#buildToken

    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history?.sign || !history.currentLayerAt || !history.getLayerBySig) return

    const base = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = [...base, label]

    // Head resolution is deliberately UNCACHED — the head moves with every
    // commit; only sig-addressed content below is cached.
    let childSigs: string[] = []
    try {
      const headSig = await history.sign({ explorerSegments: () => segments })
      const head = await history.currentLayerAt(headSig)
      if (token !== this.#buildToken) return
      childSigs = Array.isArray(head?.children) ? head!.children.map(c => String(c ?? '').trim()).filter(Boolean) : []
    } catch { return }
    if (childSigs.length === 0) { this.#clearWave(); return }

    // Slot spiral: ring 1 outward, each ring in neighbor-winding order.
    // Levels consume slots SEQUENTIALLY — a level that doesn't fill its
    // ring leaves the remainder to the next level (shared rings).
    const slots = this.#spiralSlots(center)
    const placed: WaveNode[] = []
    let slotIdx = 0

    type Frontier = { sigs: string[]; path: string[] }
    let frontier: Frontier[] = [{ sigs: childSigs, path: [] }]

    for (let level = 1; level <= this.#depth && frontier.length > 0 && slotIdx < slots.length; level++) {
      const next: Frontier[] = []
      for (const f of frontier) {
        for (const sig of f.sigs) {
          if (slotIdx >= slots.length) break
          const node = await this.#resolveLayer(sig, history)
          if (token !== this.#buildToken) return
          if (!node || !node.name) continue
          const imageSig = node.propsSig ? await this.#resolveImageSig(node.propsSig) : undefined
          if (token !== this.#buildToken) return
          placed.push({
            slot: slots[slotIdx++],
            path: [...f.path, node.name],
            level,
            imageSig,
            name: node.name,
          })
          if (node.childSigs.length > 0) next.push({ sigs: node.childSigs, path: [...f.path, node.name] })
        }
      }
      frontier = next
    }

    if (placed.length === 0) { this.#clearWave(); return }

    // Decode every image BEFORE painting — the wave lands once, complete,
    // never as a trickle of tiles popping in.
    for (const n of placed) {
      if (n.imageSig) await this.#texture(n.imageSig)
      if (token !== this.#buildToken) return
    }

    this.#paint(placed, key, segments)
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
        // Legacy child entry stored by NAME — a bare name is not addressable
        // as content, so it resolves through nothing here; the wave simply
        // shows a labelled hex with no descent below it.
        node = { name: entry, childSigs: [] }
      }
    } catch { node = null }
    // Names are mutable only via new sigs; a by-sig result is immutable — cacheable forever.
    if (SIG.test(entry)) this.#layerCache.set(entry, node)
    return node
  }

  async #resolveImageSig(propsSig: string): Promise<string | undefined> {
    if (this.#propsImageCache.has(propsSig)) return this.#propsImageCache.get(propsSig)
    let imageSig: string | undefined
    try {
      const store = window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(propsSig)
      if (blob) {
        const parsed = JSON.parse(await blob.text()) as { imageSig?: unknown }
        if (typeof parsed?.imageSig === 'string' && SIG.test(parsed.imageSig)) imageSig = parsed.imageSig
      }
    } catch { /* cold or unparsable — labelled hex fallback */ }
    this.#propsImageCache.set(propsSig, imageSig)
    return imageSig
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

  #paint(placed: WaveNode[], key: string, segments: string[]): void {
    if (!this.#renderContainer) return
    this.#clearWave()

    const layer = new Container()
    layer.zIndex = WAVE_Z

    const hexR = this.#hexRadius()
    for (const n of placed) {
      const r = hexR * NODE_R_FACTOR * Math.pow(LEVEL_SCALE, n.level - 1)
      const p = this.#axialToPixel(n.slot.q, n.slot.r)
      const node = this.#buildTileNode(r, n)
      node.position.set(p.x + this.#meshOffset.x, p.y + this.#meshOffset.y)
      node.alpha = Math.pow(LEVEL_ALPHA, n.level - 1)
      layer.addChild(node)
    }

    this.#renderContainer.addChild(layer)
    this.#layer = layer
    this.#placed = placed
    this.#builtSegments = segments
    this.#builtKey = key
  }

  #buildTileNode(tileR: number, n: WaveNode): Container {
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
      const side = tileR * 1.5
      const s = Math.min(side / (tex.width || side), side / (tex.height || side))
      sprite.scale.set(s)
      const mask = new Graphics()
      mask.poly(this.#hexVerts(0, 0, tileR * 0.97), true)
      mask.fill({ color: 0xffffff })
      node.addChild(sprite)
      node.addChild(mask)
      sprite.mask = mask
    } else {
      const text = new Text({
        text: this.#shortLabel(n.name),
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: Math.max(7, tileR * 0.34),
          fontWeight: '600',
          fill: TILE_LABEL_FILL,
          align: 'center',
        },
      })
      text.anchor.set(0.5)
      node.addChild(text)
    }

    return node
  }

  #clearWave(): void {
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })   // textures are cache-owned, not auto-destroyed
      this.#layer = null
    }
    this.#placed = []
    this.#builtSegments = []
    this.#builtKey = null
  }

  // ── geometry helpers (same transforms as move-preview / tile-overlay) ──

  #spiralSlots(center: Axial): Axial[] {
    const out: Axial[] = []
    for (let k = 1; k <= MAX_RINGS; k++) {
      let q = center.q + DIRS[4].q * k
      let r = center.r + DIRS[4].r * k
      for (let side = 0; side < 6; side++) {
        for (let step = 0; step < k; step++) {
          out.push({ q, r })
          q += DIRS[side].q
          r += DIRS[side].r
        }
      }
    }
    return out
  }

  /** Re-derive the hovered hex from the last raw cursor. Returns true when the hex or label changed. */
  #syncHoverFromClient(): boolean {
    if (!this.#lastClient) return false
    const axial = this.#clientToAxial(this.#lastClient.x, this.#lastClient.y)
    if (!axial) return false
    const changed = !this.#hoverAxial || this.#hoverAxial.q !== axial.q || this.#hoverAxial.r !== axial.r
    this.#hoverAxial = axial
    const label = this.#byAxial.get(`${axial.q},${axial.r}`) ?? null
    const labelChanged = label !== this.#hoverLabel
    this.#hoverLabel = label
    return changed || labelChanged
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

  #hexRadius(): number {
    const settings = window.ioc.get<{ hexagonDimensions?: { circumRadius?: number } }>('@diamondcoreprocessor.com/Settings')
    return settings?.hexagonDimensions?.circumRadius ?? 32
  }

  /** Pointy-top hex vertices about (cx, cy) — matches move-preview's tiles. */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }

  #shortLabel(label: string): string {
    const first = (label.split(/\s+/)[0] ?? label).slice(0, 8)
    return first || label.slice(0, 8)
  }

  #typingContext(): boolean {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  }
}

const _waveView = new WaveViewDrone()
window.ioc.register('@diamondcoreprocessor.com/WaveViewDrone', _waveView)
