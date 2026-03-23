// diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
import { Drone, EffectBus } from '@hypercomb/core'
import { Application, Container, Point, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import { HexOverlayMesh } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial, HexDetector } from '../input/hex-detector.js'
import type { InputGate } from '../input/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from './hex-geometry.js'

type CellCountPayload = { count: number; labels: string[]; branchLabels?: string[]; externalLabels?: string[]; noImageLabels?: string[] }

type OverlayAction = {
  name: string
  button: HexIconButton
  profile: OverlayProfileKey
  /** If provided, called to determine per-tile visibility */
  visibleWhen?: OverlayVisibilityFn
}

/** Descriptor emitted by provider bees via `overlay:register-action` */
export type OverlayActionDescriptor = {
  name: string
  svgMarkup?: string
  fontChar?: string
  x: number
  y: number
  iconSize?: number
  hoverTint?: number
  profile: OverlayProfileKey
  /** Optional: called with tile context to determine if this icon is visible on a specific tile */
  visibleWhen?: OverlayVisibilityFn
}

export type OverlayVisibilityFn = (ctx: OverlayTileContext) => boolean

export type OverlayTileContext = {
  label: string
  q: number
  r: number
  index: number
  noImage: boolean
}

export type OverlayProfileKey = 'private' | 'public-own' | 'public-external'

// Seed label styling
const LABEL_X = -24
const LABEL_Y = -14
const LABEL_STYLE = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 5,
  fill: 0xffffff,
  align: 'left',
})

export class TileOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'contextual action overlay host — icons registered externally via effects'

  #app: Application | null = null
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null

  #overlay: Container | null = null
  #hexBg: HexOverlayMesh | null = null
  #seedLabel: Text | null = null
  #actions: OverlayAction[] = []

  #meshOffset = { x: 0, y: 0 }
  #currentAxial: Axial | null = null
  #currentIndex: number | undefined = undefined

  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY

  #cellCount = 0
  #cellLabels: string[] = []

  #listening = false
  #hoverLog = 0
  #flat = false

  #occupiedByAxial = new Map<string, { index: number; label: string }>()
  #branchLabels = new Set<string>()
  #externalLabels = new Set<string>()
  #currentTileExternal = false
  #activeProfileKey: OverlayProfileKey | null = null
  #noImageLabels = new Set<string>()

  #navigationBlocked = false
  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null
  #meshPublic = false
  #editing = false
  #editCooldown = false
  #hasSelection = false
  #touchDragging = false

  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = new Map<string, OverlayActionDescriptor>()

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:cell-count',
    'render:set-orientation', 'render:geometry-changed',
    'navigation:guard-start', 'navigation:guard-end',
    'mesh:public-changed', 'editor:mode', 'selection:changed',
    'overlay:register-action', 'overlay:unregister-action',
  ]
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back']

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // ── External action registration ─────────────────────────────
      this.onEffect<OverlayActionDescriptor | OverlayActionDescriptor[]>('overlay:register-action', (payload) => {
        const descs = Array.isArray(payload) ? payload : [payload]
        for (const desc of descs) this.#registeredDescriptors.set(desc.name, desc)
        this.#rebuildActiveProfile()
      })

      this.onEffect<{ name: string }>('overlay:unregister-action', ({ name }) => {
        this.#registeredDescriptors.delete(name)
        this.#rebuildActiveProfile()
      })

      // ── Pixi host ────────────────────────────────────────────────
      this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
        this.#app = payload.app
        this.#renderContainer = payload.container
        this.#canvas = payload.canvas
        this.#renderer = payload.renderer
        this.#initOverlay()
        this.#attachListeners()
      })

      this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
        this.#meshOffset = offset
        if (this.#currentAxial) {
          this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r)
        }
      })

      this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
        this.#cellCount = payload.count
        this.#cellLabels = payload.labels
        this.#branchLabels = new Set(payload.branchLabels ?? [])
        this.#externalLabels = new Set(payload.externalLabels ?? [])
        this.#noImageLabels = new Set(payload.noImageLabels ?? [])
        this.#rebuildOccupiedMap()
        if (this.#overlay && this.#currentAxial) {
          this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r)
          this.#updatePerTileVisibility()
          this.#updateVisibility()
        }
      })

      this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
        this.#flat = payload.flat
        this.#updateHexBg()
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r)
      })

      this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
        this.#geo = geo
        const detector = this.resolve<HexDetector>('detector')
        if (detector) detector.spacing = geo.spacing
        this.#updateHexBg()
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r)
      })

      this.onEffect('navigation:guard-start', () => {
        this.#navigationBlocked = true
        // hide overlay immediately — stale label from the previous layer must not
        // linger; it will reappear on the next fresh pointer move
        this.#currentAxial = null
        this.#currentIndex = undefined
        if (this.#overlay) this.#overlay.visible = false
        if (this.#navigationGuardTimer) clearTimeout(this.#navigationGuardTimer)
        this.#navigationGuardTimer = setTimeout(() => { this.#navigationBlocked = false }, 200)
      })

      this.onEffect('navigation:guard-end', () => {
        this.#navigationBlocked = false
        if (this.#navigationGuardTimer) {
          clearTimeout(this.#navigationGuardTimer)
          this.#navigationGuardTimer = null
        }
      })

      this.onEffect<{ active: boolean }>('touch:dragging', ({ active }) => {
        this.#touchDragging = active
        if (active && this.#overlay) this.#overlay.visible = false
      })

      this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
        this.#meshPublic = payload.public
        this.#rebuildActiveProfile()
        this.#updateVisibility()
      })

      this.onEffect<{ active: boolean }>('editor:mode', (payload) => {
        this.#editing = payload.active
        if (payload.active) {
          this.#editCooldown = false
          this.#updateVisibility()
        } else {
          this.#editCooldown = true
          this.#updateVisibility()
          setTimeout(() => { this.#editCooldown = false; this.#updateVisibility() }, 300)
        }
      })

      this.onEffect<{ selected: string[] }>('selection:changed', (payload) => {
        this.#hasSelection = (payload?.selected?.length ?? 0) > 0
        this.#updateVisibility()
      })
    }
  }

  protected override dispose(): void {
    if (this.#listening) {
      document.removeEventListener('pointermove', this.#onPointerMove)
      document.removeEventListener('click', this.#onClick)
      document.removeEventListener('contextmenu', this.#onContextMenu)
      this.#listening = false
    }
    if (this.#overlay) {
      this.#overlay.destroy({ children: true })
      this.#overlay = null
      this.#hexBg = null
      this.#seedLabel = null
      this.#actions = []
    }
  }

  // ── Overlay setup ──────────────────────────────────────────────────

  #initOverlay(): void {
    if (!this.#renderContainer || this.#overlay) return

    this.#overlay = new Container()
    this.#overlay.visible = false
    this.#overlay.zIndex = 9999

    this.#hexBg = new HexOverlayMesh(this.#geo.circumRadiusPx, this.#flat)
    this.#overlay.addChild(this.#hexBg.mesh)

    this.#seedLabel = new Text({ text: '', style: LABEL_STYLE, resolution: window.devicePixelRatio * 8 })
    this.#seedLabel.position.set(LABEL_X, LABEL_Y)
    this.#overlay.addChild(this.#seedLabel)

    this.#renderContainer.addChild(this.#overlay)
    this.#renderContainer.sortableChildren = true

    this.#rebuildActiveProfile()
  }

  #updateHexBg(): void {
    this.#hexBg?.update(this.#geo.circumRadiusPx, this.#flat)
  }

  // ── Profile resolution (now from registered descriptors) ───────────

  #resolveProfileKey(): OverlayProfileKey {
    if (!this.#meshPublic) return 'private'
    return this.#currentTileExternal ? 'public-external' : 'public-own'
  }

  #rebuildActiveProfile(): void {
    if (!this.#overlay) return

    // Tear down existing buttons
    for (const action of this.#actions) {
      this.#overlay.removeChild(action.button)
      action.button.destroy({ children: true })
    }
    this.#actions = []

    const key = this.#resolveProfileKey()
    this.#activeProfileKey = key

    // Build buttons from registered descriptors matching this profile
    for (const desc of this.#registeredDescriptors.values()) {
      if (desc.profile !== key) continue

      const btn = new HexIconButton({
        svgMarkup: desc.svgMarkup,
        fontChar: desc.fontChar,
        width: desc.iconSize ?? 8.75,
        height: desc.iconSize ?? 8.75,
        alias: `hc-icon-${desc.name}`,
        hoverTint: desc.hoverTint,
      })
      btn.position.set(desc.x, desc.y)
      this.#overlay.addChild(btn)
      void btn.load()

      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        visibleWhen: desc.visibleWhen,
      })
    }

    this.#updatePerTileVisibility()
  }

  // ── Per-tile icon visibility ───────────────────────────────────────

  #updatePerTileVisibility(): void {
    if (!this.#currentAxial) return
    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r))
    if (!entry) return

    const ctx: OverlayTileContext = {
      label: entry.label,
      q: this.#currentAxial.q,
      r: this.#currentAxial.r,
      index: entry.index,
      noImage: this.#noImageLabels.has(entry.label),
    }

    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx)
      }
    }
  }

  // ── Input listeners ────────────────────────────────────────────────

  #attachListeners(): void {
    if (this.#listening) return
    this.#listening = true
    document.addEventListener('pointermove', this.#onPointerMove)
    document.addEventListener('click', this.#onClick)
    document.addEventListener('contextmenu', this.#onContextMenu)
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return

    if (e.ctrlKey || e.metaKey) {
      this.#overlay.visible = false
      return
    }

    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

    const hexChanged = !this.#currentAxial
      || this.#currentAxial.q !== axial.q
      || this.#currentAxial.r !== axial.r

    if (hexChanged) {
      this.#currentAxial = axial
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r)

      const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
      this.#currentTileExternal = !!(entry?.label && this.#externalLabels.has(entry.label))

      if (this.#meshPublic) {
        const newKey = this.#resolveProfileKey()
        if (newKey !== this.#activeProfileKey) this.#rebuildActiveProfile()
      }

      if (this.#hoverLog < 5) {
        console.log('[TileOverlay] hover q:', axial.q, 'r:', axial.r, '-> index:', this.#currentIndex)
        this.#hoverLog++
      }

      this.#positionOverlay(axial.q, axial.r)
      this.#updateSeedLabel(axial.q, axial.r)
      this.#updatePerTileVisibility()
      this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
    }

    this.#updateIconHover(local)
  }

  #updateIconHover(local: Point): void {
    if (!this.#overlay?.visible) {
      for (const a of this.#actions) a.button.hovered = false
      return
    }

    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    for (const a of this.#actions) {
      const btn = a.button
      const bx = local.x - ox - btn.position.x
      const by = local.y - oy - btn.position.y
      btn.hovered = btn.containsPoint(bx, by)
    }
  }

  #onClick = (e: MouseEvent): void => {
    if (this.#navigationBlocked) return
    if (this.#editing || this.#editCooldown) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return
    if (this.#currentIndex === undefined || this.#currentIndex >= this.#cellCount) return

    const entry = this.#occupiedByAxial.get(
      TileOverlayDrone.axialKey(this.#currentAxial!.q, this.#currentAxial!.r),
    )
    if (!entry?.label) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))

    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x
      const oy = this.#overlay.position.y

      for (const action of this.#actions) {
        if (!action.button.visible) continue
        const btn = action.button
        const bx = local.x - ox - btn.position.x
        const by = local.y - oy - btn.position.y

        if (btn.containsPoint(bx, by)) {
          this.emitEffect('tile:action', {
            action: action.name,
            q: this.#currentAxial!.q,
            r: this.#currentAxial!.r,
            index: this.#currentIndex!,
            label: entry.label,
          })
          return
        }
      }
    }

    if (e.ctrlKey || e.metaKey || this.#hasSelection) {
      this.emitEffect('tile:click', {
        q: this.#currentAxial!.q,
        r: this.#currentAxial!.r,
        label: entry.label,
        index: this.#currentIndex!,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
      return
    }

    if (this.#branchLabels.has(entry.label)) {
      this.#navigateInto(entry.label)
    }
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (this.#navigationBlocked) return

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      return
    }
    const selection = window.ioc.get<{ count: number }>('@diamondcoreprocessor.com/SelectionService')
    if (selection && selection.count > 0) {
      e.preventDefault()
      return
    }

    const gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate')
    if (gate?.active) return

    e.preventDefault()
    this.#navigateBack()
  }

  // ── Navigation ─────────────────────────────────────────────────────

  #navigateInto(label: string): void {
    const lineage = this.resolve<{ explorerEnter(name: string): void }>('lineage')
    if (!lineage) return
    this.emitEffect('tile:navigate-in', { label })
    lineage.explorerEnter(label)
    // Processor pulse triggered by lineage change
  }

  #navigateBack(): void {
    const lineage = this.resolve<{ explorerUp(): void }>('lineage')
    if (!lineage) return
    this.emitEffect('tile:navigate-back', {})
    lineage.explorerUp()
  }

  // ── Helpers ────────────────────────────────────────────────────────

  #updateSeedLabel(q: number, r: number): void {
    if (!this.#seedLabel) return
    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(q, r))
    this.#seedLabel.text = entry?.label ?? ''
  }

  #updateVisibility(): void {
    if (!this.#overlay) return
    const occupied = this.#currentIndex !== undefined && this.#currentIndex < this.#cellCount
    this.#overlay.visible = occupied && !this.#editing && !this.#editCooldown && !this.#hasSelection && !this.#touchDragging
  }

  #positionOverlay(q: number, r: number): void {
    if (!this.#overlay) return
    const px = this.#axialToPixel(q, r)
    this.#overlay.position.set(
      px.x + this.#meshOffset.x,
      px.y + this.#meshOffset.y,
    )
    this.#updateVisibility()
  }

  #axialToPixel(q: number, r: number) {
    return this.#flat
      ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r }
  }

  static axialKey(q: number, r: number): string {
    return `${q},${r}`
  }

  #rebuildOccupiedMap(): void {
    this.#occupiedByAxial.clear()
    const axial = this.resolve<any>('axial')
    if (!axial?.items) return

    for (let i = 0; i < this.#cellCount; i++) {
      const coord = axial.items.get(i) as Axial | undefined
      const label = this.#cellLabels[i]
      if (!coord || !label) break
      this.#occupiedByAxial.set(TileOverlayDrone.axialKey(coord.q, coord.r), { index: i, label })
    }
  }

  #lookupIndex(q: number, r: number): number | undefined {
    return this.#occupiedByAxial.get(TileOverlayDrone.axialKey(q, r))?.index
  }

  #clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.#renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas!.getBoundingClientRect()
    const screen = this.#renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }
}

const _tileOverlay = new TileOverlayDrone()
window.ioc.register('@diamondcoreprocessor.com/TileOverlayDrone', _tileOverlay)
