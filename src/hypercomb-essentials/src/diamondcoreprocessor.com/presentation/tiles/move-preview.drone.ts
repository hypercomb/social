// diamondcoreprocessor.com/pixi/move-preview.drone.ts
import { Drone } from '@hypercomb/core'
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type MovePreviewPayload = {
  names: string[]
  movedLabels: Set<string>
} | null

type DropIntoPayload = {
  label: string
  dragged?: string[]
} | null

type DropIntoCommitPayload = {
  label: string
  dragged?: string[]
} | null

type CopyDragPayload = {
  dragged?: string[]
  q?: number
  r?: number
} | null

// swap target indicators
const SWAP_FILL = 0xff8844
const SWAP_FILL_ALPHA = 0.2
const SWAP_STROKE = 0xff8844
const SWAP_STROKE_ALPHA = 0.5
const STROKE_WIDTH = 0.5

// drop-into landing-zone ring (Ctrl held — tile becomes a parent of the set)
const DROP_FILL = 0x2299aa
const DROP_FILL_ALPHA = 0.22
const DROP_STROKE = 0x33bbcc
const DROP_STROKE_ALPHA = 0.85
const DROP_STROKE_WIDTH = 2

// ── held-cluster look (the shrunken copies hovering over the target) ──
const TILE_FILL = 0x0e1018
const TILE_FILL_ALPHA = 0.92
const TILE_BORDER = 0x7eb6d6        // steel hairline (matches chrome)
const TILE_BORDER_ALPHA = 0.92
const TILE_BORDER_WIDTH = 1.2
const TILE_LABEL_FILL = 0xdceaf5
const SHADOW_COLOR = 0x000000

const HELD_TILE_R_FACTOR = 0.50     // single held copy radius as fraction of hex radius
const HELD_LIFT_FACTOR = 0.34       // how far above the target the cluster floats
const SHADOW_DROP_FACTOR = 0.12     // shadow offset below the cluster
const MAX_HELD_NODES = 6            // cap on rendered copies (data still moves all)
const SUCK_MS = 230                 // suck-into-tile duration
const HELD_Z = 7002

export class MovePreviewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  override description =
    'Draws swap-indicator overlays, and the Ctrl drop-into preview — shrunken copies of the dragged tiles hovering over the target with a drop shadow, then a suck-into-tile animation on release.'

  #renderContainer: Container | null = null
  #layer: Graphics | null = null
  #dropIntoLayer: Graphics | null = null
  #meshOffset = { x: 0, y: 0 }
  #originalNames: string[] = []
  #cellCoords: { q: number; r: number }[] = []
  #cellCount = 0

  // ── held cluster state ────────────────────────────────────
  #held: Container | null = null        // shadow + tiles, positioned at the target center
  #heldTiles: Container | null = null    // the fanned copies (bob + suck-in apply here)
  #heldShadow: Graphics | null = null
  #heldTextures: Texture[] = []          // image textures WE created — destroyed by us
  #heldKey: string | null = null         // dragged-set identity; rebuild only when it changes
  #heldCenter: { x: number; y: number } | null = null
  #lift = 0
  #buildToken = 0                        // invalidates in-flight async builds
  #suckIn: { start: number } | null = null
  #raf = 0

  protected override deps = {
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count', 'move:preview', 'move:drop-into', 'move:drop-into-commit', 'move:copy-drag']
  protected override emits: string[] = []

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#initLayer()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
    })

    this.onEffect<{ count: number; labels: string[]; coords?: { q: number; r: number }[] }>('render:cell-count', (payload) => {
      this.#originalNames = payload.labels
      this.#cellCoords = payload.coords ?? []
      this.#cellCount = payload.count
    })

    this.onEffect<MovePreviewPayload>('move:preview', (payload) => {
      this.#redraw(payload)
    })

    this.onEffect<DropIntoPayload>('move:drop-into', (payload) => {
      this.#redrawDropInto(payload)
      // While the suck-in is playing, ignore clears/repositions — the
      // animation owns the cluster until it finishes.
      if (this.#suckIn) return
      if (payload) this.#showHeld(payload.label, payload.dragged ?? [])
      else this.#hideHeld()
    })

    this.onEffect<DropIntoCommitPayload>('move:drop-into-commit', (payload) => {
      if (payload) this.#startSuckIn(payload.label)
    })

    // Ctrl-drag COPY: the exact dragged tiles float at the hovered SLOT (q,r),
    // ready to drop as siblings. Same held-cluster renderer drop-into uses, but
    // positioned by grid coordinate (the slot may be empty) and with NO landing
    // ring — a copy lands beside, not into.
    this.onEffect<CopyDragPayload>('move:copy-drag', (payload) => {
      if (this.#suckIn) return
      if (payload && Array.isArray(payload.dragged) && payload.dragged.length > 0
        && typeof payload.q === 'number' && typeof payload.r === 'number') {
        this.#showHeldAt(this.#axialCenter(payload.q, payload.r), payload.dragged)
      } else {
        this.#hideHeld()
      }
    })
  }

  protected override dispose(): void {
    this.#destroyHeld()
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0 }
    if (this.#dropIntoLayer) {
      this.#dropIntoLayer.parent?.removeChild(this.#dropIntoLayer)
      this.#dropIntoLayer.destroy()
      this.#dropIntoLayer = null
    }
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy()
      this.#layer = null
    }
  }

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 7000
    this.#dropIntoLayer = new Graphics()
    this.#dropIntoLayer.zIndex = 7001
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.addChild(this.#dropIntoLayer)
    this.#renderContainer.sortableChildren = true
  }

  #redraw(payload: MovePreviewPayload): void {
    if (!this.#layer) return
    this.#layer.clear()

    if (!payload) return

    // A non-null swap preview means a normal (non-Ctrl) drag is in progress —
    // the move drone suppresses swap previews while drop-into is active, so
    // reaching here guarantees we've left drop-into. Tear down any held
    // cluster so it can never linger over a swap drag (#hideHeld defers to an
    // in-flight suck-in, which never coexists with a non-null swap preview).
    this.#hideHeld()

    const { names, movedLabels } = payload
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return

    const ox = this.#meshOffset.x
    const oy = this.#meshOffset.y

    // draw indicators for swapped tiles: labels that changed index but aren't in movedLabels
    for (let i = 0; i < this.#cellCount; i++) {
      const label = names[i]
      if (!label) break
      if (movedLabels.has(label)) continue
      if (label === this.#originalNames[i]) continue // not displaced

      const coord = axialSvc.items.get(i)
      if (!coord) break

      this.#drawSwapHex(coord.Location.x + ox, coord.Location.y + oy)
    }
  }

  #drawSwapHex(cx: number, cy: number): void {
    if (!this.#layer) return

    const r = this.#hexRadius()

    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 6
      verts.push(cx + r * Math.cos(angle))
      verts.push(cy + r * Math.sin(angle))
    }

    this.#layer.poly(verts, true)
    this.#layer.fill({ color: SWAP_FILL, alpha: SWAP_FILL_ALPHA })

    this.#layer.poly(verts, true)
    this.#layer.stroke({ color: SWAP_STROKE, alpha: SWAP_STROKE_ALPHA, width: STROKE_WIDTH })
  }

  // ── drop-into landing ring (Ctrl-modifier preview) ────────

  #redrawDropInto(payload: DropIntoPayload): void {
    if (!this.#dropIntoLayer) return
    this.#dropIntoLayer.clear()
    if (!payload) return

    const center = this.#cellCenter(payload.label)
    if (!center) return

    // A single ring marking the tile the set will drop into. The held
    // cluster + shadow (drawn separately) communicate the "going in" depth,
    // so the ring stays minimal — no inset hex / chevron fighting the copies.
    const r = this.#hexRadius()
    const verts = this.#hexVerts(center.x, center.y, r)
    this.#dropIntoLayer.poly(verts, true)
    this.#dropIntoLayer.fill({ color: DROP_FILL, alpha: DROP_FILL_ALPHA })
    this.#dropIntoLayer.poly(verts, true)
    this.#dropIntoLayer.stroke({ color: DROP_STROKE, alpha: DROP_STROKE_ALPHA, width: DROP_STROKE_WIDTH })
  }

  // ── held cluster (shrunken copies hovering over the target) ──

  #showHeld(targetLabel: string, dragged: string[]): void {
    this.#showHeldAt(this.#cellCenter(targetLabel), dragged)
  }

  /** Show the held exact-tile cluster at a container-space center. Shared by
   *  drop-into (centered on the target tile) and copy-drag (centered on the
   *  hovered slot, which may be empty). */
  #showHeldAt(center: { x: number; y: number } | null, dragged: string[]): void {
    if (!center || dragged.length === 0) { this.#hideHeld(); return }

    const key = dragged.join('')
    if (this.#heldKey !== key) {
      this.#destroyHeld()                 // bumps #buildToken, clears state
      this.#heldKey = key
      const token = this.#buildToken
      void this.#buildHeld(dragged, token)
    }
    this.#heldCenter = center
    this.#ensureRaf()
  }

  #hideHeld(): void {
    if (this.#suckIn) return              // animation finishes on its own
    this.#destroyHeld()
  }

  async #buildHeld(dragged: string[], token: number): Promise<void> {
    if (!this.#renderContainer) return

    const r = this.#hexRadius()
    const lift = r * HELD_LIFT_FACTOR
    const n = Math.min(dragged.length, MAX_HELD_NODES)
    const tileR = r * (HELD_TILE_R_FACTOR - Math.min(n - 1, 4) * 0.045)

    // Resolve each dragged tile's bootstrap image and decode it once.
    // Falls back to a labelled hex when a tile has no image.
    const sigs = this.#imageSigs(dragged)
    const textures: (Texture | null)[] = []
    for (let i = 0; i < n; i++) {
      const sig = sigs.get(dragged[i])
      textures.push(sig ? await this.#loadTexture(sig) : null)
      if (token !== this.#buildToken) {   // superseded mid-decode — bail
        for (const t of textures) if (t) { try { t.destroy(true) } catch { /* ok */ } }
        return
      }
    }

    if (token !== this.#buildToken || !this.#renderContainer) {
      for (const t of textures) if (t) { try { t.destroy(true) } catch { /* ok */ } }
      return
    }

    const held = new Container()
    held.zIndex = HELD_Z

    // soft drop shadow — two stacked hexes for a cheap blur
    const shadow = new Graphics()
    const sr = tileR * (n > 1 ? 1.4 : 1.05)
    shadow.poly(this.#hexVerts(0, 0, sr * 1.18), true)
    shadow.fill({ color: SHADOW_COLOR, alpha: 0.10 })
    shadow.poly(this.#hexVerts(0, 0, sr), true)
    shadow.fill({ color: SHADOW_COLOR, alpha: 0.24 })
    shadow.position.set(0, r * SHADOW_DROP_FACTOR)
    held.addChild(shadow)

    const tiles = new Container()
    tiles.position.set(0, -lift)
    held.addChild(tiles)

    // Build outermost copies first so the center copy renders on top.
    const order = [...Array(n).keys()].sort(
      (a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2),
    )
    for (const i of order) {
      const t = n > 1 ? i / (n - 1) - 0.5 : 0   // -0.5..0.5 across the fan
      const node = this.#buildTileNode(tileR, textures[i], dragged[i])
      node.position.set(t * r * 0.55, -Math.abs(t) * r * 0.06)
      node.rotation = t * 0.30
      tiles.addChild(node)
    }

    for (const tex of textures) if (tex) this.#heldTextures.push(tex)

    this.#renderContainer.addChild(held)
    this.#held = held
    this.#heldTiles = tiles
    this.#heldShadow = shadow
    this.#lift = lift
    this.#ensureRaf()
  }

  #buildTileNode(tileR: number, tex: Texture | null, label: string): Container {
    const node = new Container()

    const body = new Graphics()
    const verts = this.#hexVerts(0, 0, tileR)
    body.poly(verts, true)
    body.fill({ color: TILE_FILL, alpha: TILE_FILL_ALPHA })
    body.poly(verts, true)
    body.stroke({ color: TILE_BORDER, alpha: TILE_BORDER_ALPHA, width: TILE_BORDER_WIDTH })
    node.addChild(body)

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
        text: this.#shortLabel(label),
        style: {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: Math.max(7, tileR * 0.46),
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

  #startSuckIn(targetLabel: string): void {
    // Only animate if a cluster is actually built (a very fast Ctrl-release
    // can beat the async decode — navigation still happens, just no anim).
    if (!this.#held || !this.#heldTiles) return
    const center = this.#cellCenter(targetLabel)
    if (center) this.#heldCenter = center
    this.#suckIn = { start: performance.now() }
    this.#ensureRaf()
  }

  // ── animation loop ────────────────────────────────────────

  #ensureRaf(): void {
    if (!this.#raf) this.#raf = requestAnimationFrame(this.#tick)
  }

  #tick = (): void => {
    this.#raf = 0
    const held = this.#held
    const tiles = this.#heldTiles

    if (held && tiles && this.#heldCenter) {
      held.position.set(this.#heldCenter.x, this.#heldCenter.y)
      const now = performance.now()

      if (this.#suckIn) {
        const p = Math.min(1, (now - this.#suckIn.start) / SUCK_MS)
        const e = p * p                                   // ease-in — accelerate inward
        tiles.scale.set(1 + (0.06 - 1) * e)               // shrink toward a point
        tiles.position.set(0, -this.#lift * (1 - e))      // drop into the tile center
        tiles.alpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45
        if (this.#heldShadow) this.#heldShadow.alpha = 1 - e
        if (p >= 1) {
          this.#suckIn = null
          this.#destroyHeld()                             // RAF self-stops below
          return
        }
      } else {
        // gentle hover bob — reads as "held, about to drop"
        const bob = Math.sin(now / 320)
        tiles.position.set(0, -this.#lift + bob * 1.6)
        tiles.scale.set(1 + bob * 0.018)
      }
    }

    if (this.#held || this.#suckIn) this.#raf = requestAnimationFrame(this.#tick)
  }

  #destroyHeld(): void {
    this.#buildToken++          // invalidate any in-flight #buildHeld
    this.#heldKey = null
    this.#heldCenter = null
    this.#suckIn = null
    if (this.#held) {
      this.#held.parent?.removeChild(this.#held)
      this.#held.destroy({ children: true })   // textures destroyed below (not shared-safe to auto)
      this.#held = null
    }
    this.#heldTiles = null
    this.#heldShadow = null
    for (const t of this.#heldTextures) { try { t.destroy(true) } catch { /* already gone */ } }
    this.#heldTextures = []
  }

  // ── helpers ───────────────────────────────────────────────

  #hexRadius(): number {
    const settings = window.ioc.get<any>('@diamondcoreprocessor.com/Settings')
    return settings?.hexagonDimensions?.circumRadius ?? 32
  }

  /** Pointy-top hex vertices about (cx, cy) — matches the drop-into ring. */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }

  /** Container-space center of the tile with this label, or null. */
  #cellCenter(label: string): { x: number; y: number } | null {
    const idx = this.#originalNames.indexOf(label)
    if (idx < 0) return null
    const coord = this.#cellCoords[idx]
    if (!coord) return null
    return this.#axialCenter(coord.q, coord.r)
  }

  /** Container-space center of a grid slot by axial coordinate (works for an
   *  empty slot — used by the copy-drag ghost which lands beside, not on, a tile). */
  #axialCenter(q: number, r: number): { x: number; y: number } | null {
    const axialSvc = this.resolve<any>('axial')
    if (!axialSvc?.items) return null
    for (const [, item] of axialSvc.items) {
      if (item.q === q && item.r === r) {
        return { x: item.Location.x + this.#meshOffset.x, y: item.Location.y + this.#meshOffset.y }
      }
    }
    return null
  }

  /** label → bootstrap image signature, from the live render snapshot. */
  #imageSigs(labels: string[]): Map<string, string> {
    const out = new Map<string, string>()
    const show = window.ioc.get<{ snapshotCells?: () => { label: string; imageSig?: string }[] }>(
      '@diamondcoreprocessor.com/ShowCellDrone',
    )
    const snap = show?.snapshotCells?.()
    if (!snap) return out
    const want = new Set(labels)
    for (const c of snap) {
      if (c.imageSig && want.has(c.label) && !out.has(c.label)) out.set(c.label, c.imageSig)
    }
    return out
  }

  async #loadTexture(sig: string): Promise<Texture | null> {
    try {
      const store = window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
      const blob = await store?.getResource?.(sig)
      if (!blob) return null
      const bitmap = await createImageBitmap(blob)
      return Texture.from(bitmap)
    } catch {
      return null
    }
  }

  #shortLabel(label: string): string {
    const first = (label.split(/\s+/)[0] ?? label).slice(0, 6)
    return first || label.slice(0, 6)
  }
}

const _movePreview = new MovePreviewDrone()
window.ioc.register('@diamondcoreprocessor.com/MovePreviewDrone', _movePreview)
