// diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
import { Drone, EffectBus } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import { HexOverlayMesh } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial, HexDetector } from '../../navigation/hex-detector.js'
import type { InputGate } from '../../navigation/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'
import type { IconRegistryEntry } from './tile-actions.drone.js'
import { ICON_SPACING, ICON_Y, computeIconPositions } from './tile-actions.drone.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[]; branchLabels?: string[]; externalLabels?: string[]; noImageLabels?: string[]; linkLabels?: string[] }

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
  svgMarkup: string
  x: number
  y: number
  hoverTint?: number
  profile: OverlayProfileKey
  visibleWhen?: OverlayVisibilityFn
}

export type OverlayVisibilityFn = (ctx: OverlayTileContext) => boolean

export type OverlayTileContext = {
  label: string
  q: number
  r: number
  index: number
  noImage: boolean
  isBranch: boolean
  hasLink: boolean
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

// ── Icon sizing ──────────────────────────────────────────────────
const DEFAULT_ICON_SIZE = 6.5   // 75 % of original 8.75

// ── Hover label styling ─────────────────────────────────────────
const HOVER_LABEL_Y = 0         // just above the icon row (ICON_Y = 6)
const HOVER_LABEL_STYLE = new TextStyle({
  fontFamily: 'monospace',
  fontSize: 3.5,
  fill: 0x999999,
  align: 'center',
})

/** Human-readable display names for icon actions */
const ICON_DISPLAY_NAMES: Record<string, string> = {
  'edit': 'edit',
  'add-sub': 'branch',
  'search': 'search',
  'hide': 'hide',
  'adopt': 'adopt',
  'block': 'block',
}

// ── Arrange mode constants ────────────────────────────────────────

const POOL_Y_OFFSET = 16
const POOL_ICON_SIZE = 5        // pool icons scaled proportionally
const POOL_SPACING = 8         // tighter to match smaller pool icons
const POOL_BG_PADDING = 2
const POOL_BG_COLOR = 0x222244
const POOL_BG_ALPHA = 0.6
const WIGGLE_SPEED = 4
const WIGGLE_AMPLITUDE = 0.06
const DRAG_ALPHA = 0.6
const DROP_HIGHLIGHT_TINT = 0x88ffff

// ── Pool icon wrapper (tracks identity for drag) ──────────────────

type PoolIcon = {
  name: string
  profile: OverlayProfileKey
  button: HexIconButton
}

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
  #hoverLabel: Text | null = null
  #actions: OverlayAction[] = []
  #animTime = 0
  #animTickBound: ((ticker: any) => void) | null = null
  #meshOffset = { x: 0, y: 0 }
  #currentAxial: Axial | null = null
  #currentIndex: number | undefined = undefined

  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY

  #cellCount = 0
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []

  #listening = false
  #flat = false

  #occupiedByAxial = new Map<string, { index: number; label: string }>()
  #branchLabels = new Set<string>()
  #externalLabels = new Set<string>()
  #currentTileExternal = false
  #activeProfileKey: OverlayProfileKey | null = null
  #noImageLabels = new Set<string>()
  #linkLabels = new Set<string>()

  #navigationBlocked = false
  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null
  #meshPublic = false
  #editing = false
  #editCooldown = false
  #hasSelection = false
  #touchDragging = false

  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = new Map<string, OverlayActionDescriptor>()

  // ── Arrange mode state ──────────────────────────────────────────

  #arrangeMode = false
  #arrangeDirty = false
  #poolContainer: Container | null = null
  #poolBackground: Graphics | null = null
  #poolIcons: PoolIcon[] = []
  #poolRegistry: IconRegistryEntry[] = []

  /** Drag state */
  #dragActive = false
  #dragSource: 'active' | 'pool' = 'active'
  #dragName: string | null = null
  #dragButton: HexIconButton | null = null
  #dragOriginalPosition = { x: 0, y: 0 }
  #dragStartClient = { x: 0, y: 0 }

  /** Current active order per profile (mirrors tile-actions arrangement) */
  #activeOrder: Map<OverlayProfileKey, string[]> = new Map()

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
    'overlay:register-action', 'overlay:unregister-action', 'overlay:neon-color',
    'drop:dragging', 'drop:pending',
    'overlay:arrange-mode', 'overlay:pool-icons',
  ]
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back', 'drop:target', 'overlay:icons-reordered']

  #dropDragging = false
  #dropPending = false

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // ── External action registration ─────────────────────────────
      this.onEffect<OverlayActionDescriptor | OverlayActionDescriptor[]>('overlay:register-action', (payload) => {
        const descs = Array.isArray(payload) ? payload : [payload]
        for (const desc of descs) this.#registeredDescriptors.set(desc.name, desc)
        // Track active order from descriptors — keep 'remove' last
        for (const desc of descs) {
          if (!this.#activeOrder.has(desc.profile)) this.#activeOrder.set(desc.profile, [])
          const order = this.#activeOrder.get(desc.profile)!
          if (!order.includes(desc.name)) {
            const removeIdx = order.indexOf('remove')
            if (desc.name !== 'remove' && removeIdx >= 0) {
              order.splice(removeIdx, 0, desc.name)
            } else {
              order.push(desc.name)
            }
          }
        }
        this.#rebuildActiveProfile()
      })

      this.onEffect<{ name: string }>('overlay:unregister-action', ({ name }) => {
        const desc = this.#registeredDescriptors.get(name)
        if (desc) {
          const order = this.#activeOrder.get(desc.profile)
          if (order) {
            const idx = order.indexOf(name)
            if (idx >= 0) order.splice(idx, 1)
          }
        }
        this.#registeredDescriptors.delete(name)
        this.#rebuildActiveProfile()
      })

      this.onEffect<{ index: number }>('overlay:neon-color', ({ index }) => {
        this.#hexBg?.setColorIndex(index)
      })

      // ── Arrange mode ───────────────────────────────────────────
      this.onEffect<{ active: boolean }>('overlay:arrange-mode', ({ active }) => {
        if (active) {
          this.#enterArrangeMode()
        } else {
          this.#exitArrangeMode()
        }
      })

      // ── Pool icons from tile-actions ────────────────────────────
      this.onEffect<{ pool: Record<string, IconRegistryEntry[]>; registry: IconRegistryEntry[] }>('overlay:pool-icons', ({ pool, registry }) => {
        this.#poolRegistry = registry
        if (this.#arrangeMode) {
          this.#rebuildPoolIcons(pool)
        }
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
        this.#cellCoords = payload.coords
        this.#branchLabels = new Set(payload.branchLabels ?? [])
        this.#externalLabels = new Set(payload.externalLabels ?? [])
        this.#noImageLabels = new Set(payload.noImageLabels ?? [])
        this.#linkLabels = new Set(payload.linkLabels ?? [])
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
        this.#currentAxial = null
        this.#currentIndex = undefined
        if (this.#overlay && !this.#arrangeMode) this.#overlay.visible = false
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
        if (active && this.#overlay && !this.#arrangeMode) this.#overlay.visible = false
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

      this.onEffect<{ active: boolean }>('drop:dragging', ({ active }) => {
        this.#dropDragging = active
        this.#updatePerTileVisibility()
        this.#updateVisibility()
      })

      this.onEffect<{ active: boolean }>('drop:pending', ({ active }) => {
        this.#dropPending = active
        this.#updatePerTileVisibility()
        this.#updateVisibility()
      })
    }
  }

  protected override dispose(): void {
    if (this.#arrangeMode) this.#exitArrangeMode()
    if (this.#listening) {
      document.removeEventListener('pointermove', this.#onPointerMove)
      document.removeEventListener('dragover', this.#onDragOverTrack)
      document.removeEventListener('click', this.#onClick)
      document.removeEventListener('pointerup', this.#onPointerUp)
      document.removeEventListener('contextmenu', this.#onContextMenu)
      this.#listening = false
    }
    if (this.#animTickBound && this.#app) {
      this.#app.ticker.remove(this.#animTickBound)
      this.#animTickBound = null
    }
    if (this.#overlay) {
      this.#overlay.destroy({ children: true })
      this.#overlay = null
      this.#hexBg = null
      this.#seedLabel = null
      this.#hoverLabel = null
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

    this.#hoverLabel = new Text({ text: '', style: HOVER_LABEL_STYLE, resolution: window.devicePixelRatio * 8 })
    this.#hoverLabel.anchor.set(0.5, 1)
    this.#hoverLabel.position.set(0, HOVER_LABEL_Y)
    this.#hoverLabel.visible = false
    this.#overlay.addChild(this.#hoverLabel)

    this.#renderContainer.addChild(this.#overlay)
    this.#renderContainer.sortableChildren = true

    // drive hex overlay animations (breathe, embers, ambient, entry) + icon float + arrange wiggle
    if (this.#app && !this.#animTickBound) {
      this.#animTickBound = (ticker: any) => {
        this.#animTime += (ticker.deltaMS ?? 16) / 1000
        if (this.#hexBg && this.#overlay?.visible) {
          this.#hexBg.setTime(this.#animTime)
        }
        if (this.#arrangeMode) {
          this.#animateArrangeWiggle()
        }
      }
      this.#app.ticker.add(this.#animTickBound)
    }

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

    // Collect descriptors for this profile, build buttons
    // Sort so 'remove' is always the rightmost action
    const descs = [...this.#registeredDescriptors.values()]
      .filter(d => d.profile === key)
      .sort((a, b) => (a.name === 'remove' ? 1 : 0) - (b.name === 'remove' ? 1 : 0))
    for (const desc of descs) {
      const btn = new HexIconButton({
        svgMarkup: desc.svgMarkup,
        size: DEFAULT_ICON_SIZE,
        cacheKey: `hc-icon-${desc.name}`,
        hoverTint: desc.hoverTint,
      })
      this.#overlay.addChild(btn)
      void btn.load()

      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        visibleWhen: desc.visibleWhen,
      })
    }

    // Layout: single centered row, evenly spaced at ICON_Y
    this.#layoutIconRow()
    this.#updatePerTileVisibility()
  }

  // ── Icon row layout (centered, inline) ──────────────────────────────

  #layoutIconRow(): void {
    const visible = this.#actions.filter(a => a.button.visible)
    const count = visible.length
    if (count === 0) return

    const spacing = ICON_SPACING
    const startX = -(count - 1) * spacing / 2

    for (let i = 0; i < count; i++) {
      visible[i].button.position.set(startX + i * spacing, ICON_Y)
    }
  }

  // ── Per-tile icon visibility ───────────────────────────────────────

  #updatePerTileVisibility(): void {
    if (!this.#currentAxial) return

    // during image drag-over or pending drop, hide all action buttons — overlay is just a drop target
    if (this.#dropDragging || this.#dropPending) {
      for (const action of this.#actions) action.button.visible = false
      if (this.#seedLabel) this.#seedLabel.visible = false
      if (this.#hoverLabel) this.#hoverLabel.visible = false
      return
    }

    if (this.#seedLabel) this.#seedLabel.visible = true

    // In arrange mode, all icons are always visible
    if (this.#arrangeMode) {
      for (const action of this.#actions) action.button.visible = true
      return
    }

    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r))
    if (!entry) return

    const ctx: OverlayTileContext = {
      label: entry.label,
      q: this.#currentAxial.q,
      r: this.#currentAxial.r,
      index: entry.index,
      noImage: this.#noImageLabels.has(entry.label),
      isBranch: this.#branchLabels.has(entry.label),
      hasLink: this.#linkLabels.has(entry.label),
    }

    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx)
      }
    }

    // Re-layout so visible icons form a tight centered row
    this.#layoutIconRow()
  }

  // ── Arrange mode ────────────────────────────────────────────────────

  #enterArrangeMode(): void {
    if (this.#arrangeMode) return
    this.#arrangeMode = true
    this.#arrangeDirty = false

    // Force overlay visible on the first occupied tile
    if (!this.#currentAxial || this.#currentIndex === undefined) {
      // Position on tile 0 if possible
      if (this.#cellCoords.length > 0 && this.#cellLabels.length > 0) {
        const coord = this.#cellCoords[0]
        this.#currentAxial = { q: coord.q, r: coord.r }
        this.#currentIndex = 0
        this.#positionOverlay(coord.q, coord.r)
        this.#updateSeedLabel(coord.q, coord.r)
      }
    }

    if (this.#overlay) {
      this.#overlay.visible = true
    }

    // Make all action icons visible
    for (const action of this.#actions) {
      action.button.visible = true
    }

    // Create pool container
    this.#createPoolContainer()

    // Suppress keyboard so Escape exits arrange mode
    EffectBus.emit('keymap:suppress', { reason: 'arrange-mode' })

    // Listen for Escape key
    document.addEventListener('keydown', this.#onArrangeKeyDown)

    // Add pointer listeners for drag
    document.addEventListener('pointerdown', this.#onArrangePointerDown, true)
    document.addEventListener('pointermove', this.#onArrangePointerMove)
    document.addEventListener('pointerup', this.#onArrangePointerUp)
  }

  #exitArrangeMode(): void {
    if (!this.#arrangeMode) return
    this.#arrangeMode = false

    // Cancel any active drag
    if (this.#dragActive) this.#cancelDrag()

    // Persist if dirty
    if (this.#arrangeDirty && this.#activeProfileKey) {
      const order = this.#activeOrder.get(this.#activeProfileKey)
      if (order) {
        this.emitEffect('overlay:icons-reordered', { profile: this.#activeProfileKey, order: [...order] })
      }
    }

    // Remove pool
    this.#destroyPoolContainer()

    // Unsuppress keyboard
    EffectBus.emit('keymap:unsuppress', { reason: 'arrange-mode' })

    // Remove event listeners
    document.removeEventListener('keydown', this.#onArrangeKeyDown)
    document.removeEventListener('pointerdown', this.#onArrangePointerDown, true)
    document.removeEventListener('pointermove', this.#onArrangePointerMove)
    document.removeEventListener('pointerup', this.#onArrangePointerUp)

    // Reset icon transforms (undo wiggle)
    for (const action of this.#actions) {
      action.button.rotation = 0
      action.button.scale.set(1, 1)
    }

    this.#updateVisibility()
    this.#updatePerTileVisibility()
  }

  #onArrangeKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      EffectBus.emit('overlay:arrange-mode', { active: false })
    }
  }

  // ── Arrange wiggle animation ────────────────────────────────────

  #animateArrangeWiggle(): void {
    for (let i = 0; i < this.#actions.length; i++) {
      const action = this.#actions[i]
      if (this.#dragActive && action.name === this.#dragName) continue
      const phase = i * 1.2
      action.button.rotation = Math.sin(this.#animTime * WIGGLE_SPEED + phase) * WIGGLE_AMPLITUDE
    }
    // Wiggle pool icons too
    for (let i = 0; i < this.#poolIcons.length; i++) {
      const poolIcon = this.#poolIcons[i]
      if (this.#dragActive && poolIcon.name === this.#dragName) continue
      const phase = (i + this.#actions.length) * 1.2
      poolIcon.button.rotation = Math.sin(this.#animTime * WIGGLE_SPEED + phase) * WIGGLE_AMPLITUDE
    }
  }

  // ── Pool container ──────────────────────────────────────────────

  #createPoolContainer(): void {
    if (!this.#overlay || this.#poolContainer) return

    this.#poolContainer = new Container()
    this.#poolContainer.position.set(0, POOL_Y_OFFSET)
    this.#overlay.addChild(this.#poolContainer)

    this.#poolBackground = new Graphics()
    this.#poolContainer.addChild(this.#poolBackground)

    // Request pool icons from tile-actions
    // They should already have been emitted; if not, they'll come via the effect
    this.#requestPoolRebuild()
  }

  #destroyPoolContainer(): void {
    if (!this.#poolContainer) return

    for (const poolIcon of this.#poolIcons) {
      poolIcon.button.destroy({ children: true })
    }
    this.#poolIcons = []

    this.#poolBackground?.destroy()
    this.#poolBackground = null

    this.#poolContainer.destroy({ children: true })
    if (this.#overlay) {
      this.#overlay.removeChild(this.#poolContainer)
    }
    this.#poolContainer = null
  }

  #requestPoolRebuild(): void {
    // Build pool from registry vs active order
    const profile = this.#activeProfileKey ?? this.#resolveProfileKey()
    const activeNames = new Set(this.#activeOrder.get(profile) ?? [])
    const poolEntries = this.#poolRegistry.filter(e => e.profile === profile && !activeNames.has(e.name))

    const pool: Record<string, IconRegistryEntry[]> = {}
    pool[profile] = poolEntries
    this.#rebuildPoolIcons(pool)
  }

  #rebuildPoolIcons(pool: Record<string, IconRegistryEntry[]>): void {
    if (!this.#poolContainer || !this.#poolBackground) return

    // Clear existing pool icons
    for (const poolIcon of this.#poolIcons) {
      this.#poolContainer.removeChild(poolIcon.button)
      poolIcon.button.destroy({ children: true })
    }
    this.#poolIcons = []

    const profile = this.#activeProfileKey ?? this.#resolveProfileKey()
    const entries = pool[profile] ?? []

    if (entries.length === 0) {
      this.#poolBackground.clear()
      return
    }

    // Create pool icon buttons — center positions, symmetric about x=0
    const startX = -(entries.length - 1) * POOL_SPACING / 2
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const btn = new HexIconButton({
        svgMarkup: entry.svgMarkup,
        size: POOL_ICON_SIZE,
        cacheKey: `hc-pool-${entry.name}`,
        hoverTint: entry.hoverTint,
      })
      btn.position.set(startX + i * POOL_SPACING, 0)
      btn.alpha = 0.5
      this.#poolContainer.addChild(btn)
      void btn.load()

      this.#poolIcons.push({ name: entry.name, profile: entry.profile, button: btn })
    }

    // Draw pool background — centered around the row
    this.#poolBackground.clear()
    const halfW = ((entries.length - 1) * POOL_SPACING) / 2 + POOL_ICON_SIZE / 2 + POOL_BG_PADDING
    const halfH = POOL_ICON_SIZE / 2 + POOL_BG_PADDING
    this.#poolBackground.roundRect(-halfW, -halfH, halfW * 2, halfH * 2, 1.5)
    this.#poolBackground.fill({ color: POOL_BG_COLOR, alpha: POOL_BG_ALPHA })
  }

  // ── Arrange drag-and-drop ───────────────────────────────────────

  #onArrangePointerDown = (e: PointerEvent): void => {
    if (!this.#arrangeMode || this.#dragActive) return
    if (!this.#overlay || !this.#renderContainer || !this.#renderer || !this.#canvas) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    // Check active icons
    for (const action of this.#actions) {
      const btn = action.button
      const bx = local.x - ox - btn.position.x
      const by = local.y - oy - btn.position.y
      if (btn.containsPoint(bx, by)) {
        e.preventDefault()
        e.stopPropagation()
        this.#startDrag(action.name, action.button, 'active', e.clientX, e.clientY)
        return
      }
    }

    // Check pool icons
    if (this.#poolContainer) {
      const poolOx = ox + this.#poolContainer.position.x
      const poolOy = oy + this.#poolContainer.position.y
      for (const poolIcon of this.#poolIcons) {
        const btn = poolIcon.button
        const bx = local.x - poolOx - btn.position.x
        const by = local.y - poolOy - btn.position.y
        if (btn.containsPoint(bx, by)) {
          e.preventDefault()
          e.stopPropagation()
          this.#startDrag(poolIcon.name, poolIcon.button, 'pool', e.clientX, e.clientY)
          return
        }
      }
    }
  }

  #startDrag(name: string, button: HexIconButton, source: 'active' | 'pool', clientX: number, clientY: number): void {
    this.#dragActive = true
    this.#dragSource = source
    this.#dragName = name
    this.#dragButton = button
    this.#dragOriginalPosition = { x: button.position.x, y: button.position.y }
    this.#dragStartClient = { x: clientX, y: clientY }
    button.alpha = DRAG_ALPHA
    button.zIndex = 10000
    if (button.parent) button.parent.sortableChildren = true
  }

  #onArrangePointerMove = (e: PointerEvent): void => {
    if (!this.#dragActive || !this.#dragButton || !this.#overlay || !this.#renderContainer) return

    // Move dragged icon in overlay-local space
    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    // Account for pool offset if source is pool
    if (this.#dragSource === 'pool' && this.#poolContainer) {
      this.#dragButton.position.set(
        local.x - ox - this.#poolContainer.position.x,
        local.y - oy - this.#poolContainer.position.y,
      )
    } else {
      this.#dragButton.position.set(local.x - ox, local.y - oy)
    }

    // Highlight drop targets
    this.#updateDropHighlights(local.x - ox, local.y - oy)
  }

  #onArrangePointerUp = (_e: PointerEvent): void => {
    if (!this.#dragActive || !this.#dragButton || !this.#overlay || !this.#renderContainer) return

    const dragName = this.#dragName!
    const dragSource = this.#dragSource
    const dragButton = this.#dragButton

    // Find what we're dropping on
    const dropTarget = this.#findDropTarget(dragButton, dragSource)

    if (dropTarget) {
      if (dropTarget.type === 'active' && dragSource === 'active') {
        // Swap two active icons
        this.#swapActiveIcons(dragName, dropTarget.name)
      } else if (dropTarget.type === 'pool' && dragSource === 'active') {
        // Move active icon to pool (remove from active)
        this.#moveActiveToPool(dragName)
      } else if (dropTarget.type === 'active' && dragSource === 'pool') {
        // Insert pool icon into active at target position
        this.#movePoolToActive(dragName, dropTarget.name)
      } else if (dropTarget.type === 'active-area' && dragSource === 'pool') {
        // Insert pool icon at end of active
        this.#movePoolToActiveEnd(dragName)
      }
    } else if (dragSource === 'pool') {
      // Check if dropped in the active area (above pool)
      const btnGlobalY = dragButton.position.y + (this.#poolContainer?.position.y ?? 0)
      if (btnGlobalY < POOL_Y_OFFSET - POOL_BG_PADDING) {
        this.#movePoolToActiveEnd(dragName)
      }
    }

    // Reset drag state
    this.#cancelDrag()

    // Clear highlights
    this.#clearDropHighlights()
  }

  #cancelDrag(): void {
    if (this.#dragButton) {
      this.#dragButton.alpha = this.#dragSource === 'pool' ? 0.5 : 1
      this.#dragButton.position.set(this.#dragOriginalPosition.x, this.#dragOriginalPosition.y)
      this.#dragButton.zIndex = 0
    }
    this.#dragActive = false
    this.#dragSource = 'active'
    this.#dragName = null
    this.#dragButton = null
  }

  #findDropTarget(dragButton: HexIconButton, dragSource: 'active' | 'pool'): { type: 'active' | 'pool' | 'active-area'; name: string } | null {
    // Determine the drag button's center in overlay-local space
    let centerX: number
    let centerY: number

    if (dragSource === 'pool' && this.#poolContainer) {
      centerX = dragButton.position.x + this.#poolContainer.position.x
      centerY = dragButton.position.y + this.#poolContainer.position.y
    } else {
      centerX = dragButton.position.x
      centerY = dragButton.position.y
    }

    // Check active icons
    for (const action of this.#actions) {
      if (action.name === this.#dragName && dragSource === 'active') continue
      const ax = action.button.position.x
      const ay = action.button.position.y
      const dist = Math.sqrt((centerX - ax) ** 2 + (centerY - ay) ** 2)
      if (dist < ICON_SPACING * 0.7) {
        return { type: 'active', name: action.name }
      }
    }

    // Check pool icons
    if (this.#poolContainer) {
      for (const poolIcon of this.#poolIcons) {
        if (poolIcon.name === this.#dragName && dragSource === 'pool') continue
        const px = poolIcon.button.position.x + this.#poolContainer.position.x
        const py = poolIcon.button.position.y + this.#poolContainer.position.y
        const dist = Math.sqrt((centerX - px) ** 2 + (centerY - py) ** 2)
        if (dist < POOL_SPACING * 0.7) {
          return { type: 'pool', name: poolIcon.name }
        }
      }
    }

    // Check if in the active icon row area (y near ICON_Y)
    if (centerY < POOL_Y_OFFSET - POOL_BG_PADDING && centerY > ICON_Y - 10 && centerY < ICON_Y + 15) {
      return { type: 'active-area', name: '' }
    }

    return null
  }

  #updateDropHighlights(localX: number, localY: number): void {
    // Simple highlight: tint potential drop targets
    for (const action of this.#actions) {
      if (action.name === this.#dragName && this.#dragSource === 'active') continue
      const ax = action.button.position.x
      const ay = action.button.position.y
      const dist = Math.sqrt((localX - ax) ** 2 + (localY - ay) ** 2)
      action.button.hovered = dist < ICON_SPACING * 0.7
    }
  }

  #clearDropHighlights(): void {
    for (const action of this.#actions) {
      action.button.hovered = false
    }
    for (const poolIcon of this.#poolIcons) {
      poolIcon.button.hovered = false
    }
  }

  // ── Arrange operations ──────────────────────────────────────────

  #swapActiveIcons(nameA: string, nameB: string): void {
    const profile = this.#activeProfileKey
    if (!profile) return

    const order = this.#activeOrder.get(profile)
    if (!order) return

    const idxA = order.indexOf(nameA)
    const idxB = order.indexOf(nameB)
    if (idxA < 0 || idxB < 0) return

    // Swap in order
    order[idxA] = nameB
    order[idxB] = nameA

    // Reposition buttons
    const positions = computeIconPositions(order)
    for (const action of this.#actions) {
      const idx = order.indexOf(action.name)
      if (idx >= 0 && positions[idx]) {
        action.button.position.set(positions[idx].x, positions[idx].y)
      }
    }

    // Update registered descriptors positions
    for (const action of this.#actions) {
      const desc = this.#registeredDescriptors.get(action.name)
      if (desc) {
        const idx = order.indexOf(action.name)
        if (idx >= 0 && positions[idx]) {
          desc.x = positions[idx].x
          desc.y = positions[idx].y
        }
      }
    }

    this.#arrangeDirty = true
  }

  #moveActiveToPool(name: string): void {
    const profile = this.#activeProfileKey
    if (!profile) return

    const order = this.#activeOrder.get(profile)
    if (!order) return

    const idx = order.indexOf(name)
    if (idx < 0) return

    // Remove from active order
    order.splice(idx, 1)

    // Unregister the descriptor
    this.#registeredDescriptors.delete(name)

    // Rebuild the active profile buttons with new positions
    this.#rebuildActiveProfile()

    // Rebuild pool
    this.#requestPoolRebuild()

    this.#arrangeDirty = true

    // Make all icons visible in arrange mode
    for (const action of this.#actions) {
      action.button.visible = true
    }
  }

  #movePoolToActive(name: string, beforeName: string): void {
    const profile = this.#activeProfileKey
    if (!profile) return

    const order = this.#activeOrder.get(profile)
    if (!order) return

    // Don't add duplicates
    if (order.includes(name)) return

    // Insert before the target
    const targetIdx = order.indexOf(beforeName)
    if (targetIdx >= 0) {
      order.splice(targetIdx, 0, name)
    } else {
      order.push(name)
    }

    this.#reregisterActiveIcons(profile, order)
    this.#arrangeDirty = true
  }

  #movePoolToActiveEnd(name: string): void {
    const profile = this.#activeProfileKey
    if (!profile) return

    const order = this.#activeOrder.get(profile)
    if (!order) return

    if (order.includes(name)) return

    order.push(name)

    this.#reregisterActiveIcons(profile, order)
    this.#arrangeDirty = true
  }

  #reregisterActiveIcons(profile: OverlayProfileKey, order: string[]): void {
    // Re-register all active icons with computed positions
    const positions = computeIconPositions(order)

    for (let i = 0; i < order.length; i++) {
      const iconName = order[i]
      const entry = this.#poolRegistry.find(e => e.name === iconName && e.profile === profile)
      if (!entry) continue

      const desc: OverlayActionDescriptor = {
        name: entry.name,
        svgMarkup: entry.svgMarkup,
        hoverTint: entry.hoverTint,
        profile: entry.profile,
        visibleWhen: entry.visibleWhen,
        x: positions[i].x,
        y: positions[i].y,
      }
      this.#registeredDescriptors.set(iconName, desc)
    }

    // Remove descriptors for icons no longer active in this profile
    for (const [descName, desc] of this.#registeredDescriptors) {
      if (desc.profile === profile && !order.includes(descName)) {
        this.#registeredDescriptors.delete(descName)
      }
    }

    this.#rebuildActiveProfile()
    this.#requestPoolRebuild()

    // Make all icons visible in arrange mode
    for (const action of this.#actions) {
      action.button.visible = true
    }
  }

  // ── Input listeners ────────────────────────────────────────────────

  #attachListeners(): void {
    if (this.#listening) return
    this.#listening = true
    document.addEventListener('pointermove', this.#onPointerMove)
    document.addEventListener('dragover', this.#onDragOverTrack)
    document.addEventListener('click', this.#onClick)
    document.addEventListener('pointerup', this.#onPointerUp)
    document.addEventListener('contextmenu', this.#onContextMenu)
  }

  /** Track hex position during image drag-over (pointermove doesn't fire during drag). */
  #onDragOverTrack = (e: DragEvent): void => {
    if (!this.#dropDragging) return
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return

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
      this.#positionOverlay(axial.q, axial.r)
      this.#updateSeedLabel(axial.q, axial.r)

      // tell ImageDropDrone what's under the cursor
      const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
      this.emitEffect('drop:target', {
        q: axial.q,
        r: axial.r,
        occupied: !!entry,
        label: entry?.label ?? null,
        index: entry?.index ?? -1,
        hasImage: entry ? !this.#noImageLabels.has(entry.label) : false,
      })
    }
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (this.#arrangeMode) return // arrange mode uses its own pointer handling
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return

    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

    // dev-mode: warn if occupied map is out of sync with visual mesh
    if (typeof (globalThis as any).ngDevMode !== 'undefined') {
      const key = TileOverlayDrone.axialKey(axial.q, axial.r)
      const entry = this.#occupiedByAxial.get(key)
      if (entry && entry.index >= this.#cellCount) {
        console.warn('[tile-overlay] stale occupied entry:', key, entry, 'cellCount:', this.#cellCount)
      }
    }

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

      // Ctrl/Meta held: track position but hide overlay (selection mode, not navigation)
      if (e.ctrlKey || e.metaKey) {
        this.#overlay.visible = false
        this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
        return
      }

      this.#positionOverlay(axial.q, axial.r)
      this.#updateSeedLabel(axial.q, axial.r)
      this.#updatePerTileVisibility()
      this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
    }

    // Ctrl/Meta held but hex didn't change — still hide overlay
    if (e.ctrlKey || e.metaKey) {
      this.#overlay.visible = false
      return
    }

    this.#updateIconHover(local)
  }

  #updateIconHover(local: Point): void {
    if (!this.#overlay?.visible) {
      for (const a of this.#actions) a.button.hovered = false
      if (this.#hoverLabel) this.#hoverLabel.visible = false
      return
    }

    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    let hoveredName: string | null = null
    for (const a of this.#actions) {
      const btn = a.button
      const bx = local.x - ox - btn.position.x
      const by = local.y - oy - btn.position.y
      const isHovered = btn.containsPoint(bx, by)
      btn.hovered = isHovered
      if (isHovered) hoveredName = a.name
    }

    if (this.#hoverLabel) {
      if (hoveredName) {
        this.#hoverLabel.text = ICON_DISPLAY_NAMES[hoveredName] ?? hoveredName
        this.#hoverLabel.visible = true
      } else {
        this.#hoverLabel.visible = false
      }
    }
  }

  #onClick = (e: MouseEvent): void => {
    if (this.#arrangeMode) return // arrange mode absorbs clicks
    if (this.#navigationBlocked) return
    if (this.#editing || this.#editCooldown) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return

    // For Ctrl/Meta clicks, resolve axial from click coordinates directly
    // rather than relying on pointermove having set #currentIndex
    if (e.ctrlKey || e.metaKey) {
      const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
      if (!detector) return

      const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
      const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
      const meshLocalX = local.x - this.#meshOffset.x
      const meshLocalY = local.y - this.#meshOffset.y
      const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

      const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
      if (!entry?.label) return

      this.emitEffect('tile:click', {
        q: axial.q,
        r: axial.r,
        label: entry.label,
        index: entry.index,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
      return
    }

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

    if (this.#hasSelection) {
      this.emitEffect('tile:click', {
        q: this.#currentAxial!.q,
        r: this.#currentAxial!.r,
        label: entry.label,
        index: this.#currentIndex!,
        ctrlKey: false,
        metaKey: false,
      })
      return
    }

    if (this.#branchLabels.has(entry.label)) {
      this.#navigateInto(entry.label)
    } else {
      // Non-branch tile with no action button hit → default "open" action
      this.emitEffect('tile:action', {
        action: 'open',
        q: this.#currentAxial!.q,
        r: this.#currentAxial!.r,
        index: this.#currentIndex!,
        label: entry.label,
      })
    }
  }

  // Cancel editor on right-click release (mirrors Escape cascade priority 1)
  #onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 2) return
    if (!this.#editing) return
    const drone = window.ioc.get<{ cancelEditing(): void }>('@diamondcoreprocessor.com/TileEditorDrone')
    drone?.cancelEditing()
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (this.#arrangeMode) { e.preventDefault(); return }
    if (this.#navigationBlocked) return

    // Suppress browser menu while editing (cancel handled by pointerup)
    if (this.#editing) {
      e.preventDefault()
      return
    }

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

    // Arrange mode: overlay stays visible
    if (this.#arrangeMode) {
      this.#overlay.visible = true
      return
    }

    // during image drag-over or pending drop, show overlay as a drop target / placeholder
    if (this.#dropDragging || this.#dropPending) {
      this.#overlay.visible = true
      return
    }

    const occupied = this.#currentIndex !== undefined && this.#currentIndex < this.#cellCount
    const shouldShow = occupied && !this.#editing && !this.#editCooldown && !this.#hasSelection && !this.#touchDragging
    this.#overlay.visible = shouldShow

    // trigger entry animation on show transition
    if (shouldShow && this.#hexBg) {
      this.#hexBg.show(this.#animTime)
    } else if (!shouldShow && this.#hexBg) {
      this.#hexBg.hide()
    }
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

    for (let i = 0; i < this.#cellCount; i++) {
      const coord = this.#cellCoords[i]
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
