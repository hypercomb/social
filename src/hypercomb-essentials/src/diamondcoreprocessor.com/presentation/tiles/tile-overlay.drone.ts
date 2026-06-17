// diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
import { Drone, EffectBus, consumePointerGesture, type I18nProvider, I18N_IOC_KEY, type KeyMapLayer } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import { HexOverlayMesh } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial, HexDetector } from '../../navigation/hex-detector.js'
import type { InputGate } from '../../navigation/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'
import type { IconRegistryEntry } from './tile-actions.drone.js'
import { ICON_SPACING, ICON_Y, computeIconPositions } from './tile-actions.drone.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[]; branchLabels?: string[]; externalLabels?: string[]; noImageLabels?: string[]; substrateLabels?: string[]; linkLabels?: string[]; hiddenLabels?: string[] }

type OverlayAction = {
  name: string
  button: HexIconButton
  profile: OverlayProfileKey
  genotype?: string
  /** If provided, called to determine per-tile visibility */
  visibleWhen?: OverlayVisibilityFn
  /** If provided, called to compute per-tile tint */
  tintWhen?: OverlayTintFn
  /** i18n key for the short hint label */
  labelKey?: string
  /** i18n key for the expanded description */
  descriptionKey?: string
}

/** Descriptor emitted by provider bees via `overlay:register-action` */
export type OverlayActionDescriptor = {
  name: string
  /** IoC key of the bee that owns this action — used for cleanup on disposal */
  owner?: string
  /** Feature-group identifier — all actions sharing a genotype are toggled as a unit */
  genotype?: string
  svgMarkup: string
  x: number
  y: number
  hoverTint?: number
  profile: OverlayProfileKey
  visibleWhen?: OverlayVisibilityFn
  /**
   * Per-tile dynamic tint. Returns the colour the icon should show when the
   * tile is in a state worth advertising (e.g. "contains notes"). Returns
   * null/undefined for the default (white). Evaluated alongside `visibleWhen`
   * whenever the active tile changes.
   */
  tintWhen?: OverlayTintFn
  /** i18n key for the short hint label (shown on sustained hover) */
  labelKey?: string
  /** i18n key for the expanded description (shown on sustained hover) */
  descriptionKey?: string
}

export type OverlayVisibilityFn = (ctx: OverlayTileContext) => boolean
export type OverlayTintFn = (ctx: OverlayTileContext) => number | null | undefined

export type OverlayTileContext = {
  label: string
  q: number
  r: number
  index: number
  noImage: boolean
  hasSubstrate: boolean
  isBranch: boolean
  hasLink: boolean
  isHidden: boolean
  hasNotes: boolean
}

export type OverlayProfileKey = 'private' | 'public-own' | 'public-external' | 'world'

// ── Icon sizing ──────────────────────────────────────────────────
const DEFAULT_ICON_SIZE = 7     // integer for pixel-perfect rendering

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

// ── Action hint constants ────────────────────────────────────────
const HINT_DELAY_MS = 350       // snappy hover-to-hint — long enough to filter mouse glances, short enough to feel responsive
const HINT_EXPAND_DELAY_MS = 1100 // sustained hover after the label appears → expanded description; clicks always fire the action
const HINT_Y_OFFSET = 22        // below the icon row
const HINT_FONT_SIZE = 6
const HINT_COLOR = 0xb0c0e0
const HINT_EXPANDED_FONT_SIZE = 5.5
const HINT_MAX_WIDTH = 60
// Hint Text rasterisation resolution. The stage is scaled 1.8× and the
// camera can zoom further, so the renderer's default DPR alone leaves
// the 6pt font visibly soft. Oversample at 4× DPR (min 6) so the texture
// stays sharp through typical zoom-in. Matches the SVG icon strategy
// (rasterise at 4× viewBox — see hex-icon-button.ts).
const HINT_TEXT_RESOLUTION = Math.max(6, (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1) * 4)

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
  #buttonTray: Graphics | null = null
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
  #substrateLabels = new Set<string>()
  #linkLabels = new Set<string>()
  #hiddenLabels = new Set<string>()

  // break-apart effect state
  #shatterContainer: Container | null = null
  #shatterAnimating = false

  #navigationBlocked = false
  #navigationGuardTimer: ReturnType<typeof setTimeout> | null = null
  /** Tracks the pointerId that triggered a pointerdown-navigation, so the trailing pointerup + click can be suppressed. */
  #consumedPointerId: number | null = null
  #meshPublic = false
  // World mode (toggled on the control bar): when on, the overlay shows ONLY
  // the two share-toggle icons (make-public / make-branch-public) — none of
  // the regular actions. Init from localStorage so a refresh keeps the mode.
  #worldMode = (() => { try { return localStorage.getItem('hc:world-mode') === '1' } catch { return false } })()
  #editing = false
  #editCooldown = false
  #editCooldownTimer: ReturnType<typeof setTimeout> | null = null
  #hasSelection = false
  #touchDragging = false
  // The screensaver has taken over the screen — keep the icon overlay hidden
  // until it ends. Enforced centrally in #updateVisibility.
  #screensaverActive = false

  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = new Map<string, OverlayActionDescriptor>()

  /** Genotype visibility — missing key means visible (default-on) */
  #genotypeVisible = new Map<string, boolean>()

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

  // ── Action hint state ──────────────────────────────────────────
  #hintText: Text | null = null
  #hintDescriptionText: Text | null = null
  #hintTimer: ReturnType<typeof setTimeout> | null = null
  #hintActionName: string | null = null
  #hintExpanded = false

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:cell-count',
    'render:set-orientation', 'render:geometry-changed',
    'navigation:guard-start', 'navigation:guard-end',
    'mesh:public-changed', 'world:mode', 'editor:mode', 'selection:changed',
    'overlay:register-action', 'overlay:unregister-action', 'overlay:neon-color',
    'drop:dragging', 'drop:pending',
    'overlay:arrange-mode', 'overlay:pool-icons',
    'bee:disposed', 'genotype:set-visible',
    'substrate:applied', 'cell:removed', 'tile:saved',
    'tile:public-changed',
    'keymap:invoke',
  ]
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back', 'drop:target', 'overlay:icons-reordered']

  #dropDragging = false
  #dropPending = false

  #effectsRegistered = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true

      // ── Tile-aware keybindings ──────────────────────────────────
      // `e` opens the editor for the tile under the cursor — paired with
      // `r` (recenter): both are pointer-anchored gestures expressed as
      // single-key keystrokes. The keybinding fires globally; the handler
      // gates on hover state so pressing `e` when not on a tile is a
      // no-op (instead of opening a random editor).
      const editLayer: KeyMapLayer = {
        id: 'tile-edit',
        priority: 5,
        bindings: [
          {
            cmd: 'tile.editHovered',
            sequence: [[{ key: 'e' }]],
            description: 'Edit the tile under the cursor',
            descriptionKey: 'keymap.tileEdit',
            category: 'Tiles',
          },
        ],
      }
      EffectBus.emit('keymap:add-layer', { layer: editLayer })

      this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd !== 'tile.editHovered') return
        // Gate: must be on a tile, not editing, not in arrange/public/drag
        if (this.#editing || this.#editCooldown) return
        if (this.#arrangeMode) return
        if (this.#meshPublic && !this.#hasSelection) return
        if (this.#dropDragging || this.#dropPending) return
        if (!this.#currentAxial) return
        const entry = this.#occupiedByAxial.get(
          TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r),
        )
        if (!entry?.label) return
        // Same payload shape as a click on the edit icon — same downstream
        // path (TileEditorDrone listens, opens the editor for entry.label).
        this.emitEffect('tile:action', {
          action: 'edit',
          q: this.#currentAxial.q,
          r: this.#currentAxial.r,
          index: entry.index,
          label: entry.label,
        })
      })

      // ── External action registration ─────────────────────────────
      this.onEffect<OverlayActionDescriptor | OverlayActionDescriptor[]>('overlay:register-action', (payload) => {
        const descs = Array.isArray(payload) ? payload : [payload]
        for (const desc of descs) {
          this.#registeredDescriptors.set(desc.name, desc)
          // Hydrate genotype visibility from localStorage on first encounter
          if (desc.genotype && !this.#genotypeVisible.has(desc.genotype)) {
            const stored = localStorage.getItem(`hc:genotype:${desc.genotype}`)
            if (stored !== null) this.#genotypeVisible.set(desc.genotype, stored === 'true')
          }
        }
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

      // ── Bee disposal cleanup ─────────────────────────────────────
      // When a bee is toggled off, remove every action it owns.
      this.onEffect<{ iocKey: string }>('bee:disposed', ({ iocKey }) => {
        let changed = false
        for (const [name, desc] of this.#registeredDescriptors) {
          if (desc.owner !== iocKey) continue
          const order = this.#activeOrder.get(desc.profile)
          if (order) {
            const idx = order.indexOf(name)
            if (idx >= 0) order.splice(idx, 1)
          }
          this.#registeredDescriptors.delete(name)
          changed = true
        }
        if (changed) this.#rebuildActiveProfile()
      })

      // ── Genotype visibility toggling ────────────────────────────
      this.onEffect<{ genotype: string; visible: boolean }>('genotype:set-visible', ({ genotype, visible }) => {
        this.#genotypeVisible.set(genotype, visible)
        localStorage.setItem(`hc:genotype:${genotype}`, String(visible))
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
        this.#substrateLabels = new Set(payload.substrateLabels ?? [])
        this.#linkLabels = new Set(payload.linkLabels ?? [])
        this.#hiddenLabels = new Set(payload.hiddenLabels ?? [])
        this.#rebuildOccupiedMap()
        if (this.#overlay && this.#currentAxial) {
          this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r)
          // Overlay-level visibility first, then per-icon visibility.
          // #updatePerTileVisibility is the sole authority on individual button
          // visibility �� #updateVisibility never touches buttons.
          this.#updateVisibility()
          this.#updatePerTileVisibility()
        }
      })

      // substrate:applied runs via an in-place buffer path that doesn't re-emit
      // render:cell-count, so the reroll icon's visibleWhen=hasSubstrate check
      // would stay false until the next full render. Track it incrementally
      // and refresh per-tile visibility so the reroll icon appears immediately.
      this.onEffect<{ cell: string }>('substrate:applied', ({ cell }) => {
        if (!cell) return
        this.#substrateLabels.add(cell)
        this.#noImageLabels.delete(cell)
        if (this.#overlay && this.#currentAxial) this.#updatePerTileVisibility()
      })
      this.onEffect<{ cell: string }>('cell:removed', ({ cell }) => {
        if (!cell) return
        this.#substrateLabels.delete(cell)
        this.#noImageLabels.delete(cell)
      })

      // notes:changed triggers a per-tile visibility refresh. The icon's
      // active tint is derived inline at render time (#hasNotesFor) —
      // single source of truth is NotesService, no cached set to drift.
      this.onEffect<{ segments?: readonly string[] }>('notes:changed', () => {
        if (this.#overlay && this.#currentAxial) this.#updatePerTileVisibility()
      })

      // The public/private flag flipped — swap the person↔globe toggle glyph
      // on the hovered tile immediately, without waiting for a pointer move.
      this.onEffect('tile:public-changed', () => {
        if (this.#overlay && this.#currentAxial) this.#updatePerTileVisibility()
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
        this.#consumedPointerId = null
        if (this.#navigationGuardTimer) {
          clearTimeout(this.#navigationGuardTimer)
          this.#navigationGuardTimer = null
        }
      })

      this.onEffect<{ active: boolean }>('touch:dragging', ({ active }) => {
        this.#touchDragging = active
        if (active && this.#overlay && !this.#arrangeMode) this.#overlay.visible = false
      })

      this.onEffect<{ active?: boolean }>('screensaver:active', (payload) => {
        this.#screensaverActive = payload?.active === true
        if (this.#screensaverActive) {
          if (this.#overlay) this.#overlay.visible = false
        } else {
          // screensaver ended — restore the overlay to its correct hover/selection state
          this.#updateVisibility()
          this.#updatePerTileVisibility()
        }
      })

      this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
        this.#meshPublic = payload.public
        this.#rebuildActiveProfile()
        this.#updateVisibility()
      })

      // World mode flips the overlay to the 'world' profile (the two share
      // toggles only). Rebuild the active profile so the icon set swaps.
      this.onEffect<{ active: boolean }>('world:mode', ({ active }) => {
        this.#worldMode = !!active
        this.#rebuildActiveProfile()
        this.#updateVisibility()
        this.#updatePerTileVisibility()
      })

      this.onEffect<{ active: boolean }>('editor:mode', (payload) => {
        this.#editing = payload.active
        // editing flips control of overlay visibility. Cooldown is a separate
        // 300ms click-suppression window: it only stops the trailing click
        // from save/cancel reaching the overlay's onClick / pointerdown
        // handlers. It does NOT hide the overlay (see #updateVisibility).
        if (this.#editCooldownTimer) {
          clearTimeout(this.#editCooldownTimer)
          this.#editCooldownTimer = null
        }
        if (payload.active) {
          this.#editCooldown = false
        } else {
          this.#editCooldown = true
          this.#editCooldownTimer = setTimeout(() => {
            this.#editCooldownTimer = null
            this.#editCooldown = false
            // Safety refresh after cooldown ends. The image-drop save
            // cascade (cell:added → render:cell-count → cell list
            // rebuild) can clear #currentAxial/#currentIndex between
            // the editor:mode emit and the final settle. The immediate
            // #updateVisibility below runs while occupied may still be
            // false; this deferred refresh re-derives once the cascade
            // is settled so the overlay reappears on the (still-
            // hovered) tile without requiring the cursor to cross a
            // hex boundary.
            this.#updateVisibility()
            this.#updatePerTileVisibility()
          }, 300)
          // Refresh per-tile visibility now — properties (link, hideText,
          // noImage, image) may have just changed. The cursor may already
          // be over the tile, so without this the post-save icon set
          // doesn't appear until the next pointer move.
          this.#updatePerTileVisibility()
        }
        this.#updateVisibility()
      })

      // tile:saved fires on every save/cancel of the tile editor. The
      // tile's properties may have changed (link, hideText, image, border)
      // — properties that gate per-icon visibility. Refresh both the
      // overlay-level visibility (image drops can leave it hidden when
      // the save cascade clears #currentAxial mid-flight) and per-tile
      // state so the overlay reflects the post-save tile without
      // waiting for the next pointer move.
      this.onEffect<{ cell: string }>('tile:saved', () => {
        if (this.#overlay && this.#currentAxial) {
          this.#updateVisibility()
          this.#updatePerTileVisibility()
        }
      })

      this.onEffect<{ selected: string[] }>('selection:changed', (payload) => {
        this.#hasSelection = (payload?.selected?.length ?? 0) > 0
        this.#updateVisibility()
        this.#updatePerTileVisibility()
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
    this.#clearHint()
    if (this.#arrangeMode) this.#exitArrangeMode()
    if (this.#editCooldownTimer) {
      clearTimeout(this.#editCooldownTimer)
      this.#editCooldownTimer = null
    }
    if (this.#listening) {
      document.removeEventListener('pointerdown', this.#onPointerDown)
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
      this.#buttonTray = null
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

    // semi-transparent tray behind action buttons (visible only when tile has an image)
    this.#buttonTray = new Graphics()
    this.#buttonTray.visible = false
    this.#overlay.addChild(this.#buttonTray)

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

  /** Sync read of "does this cell have notes at the current lineage?"
   *  Hits NotesService's warm cache — no localStorage parse, no async.
   *  Returns false until NotesService is loaded; the next notes:changed
   *  re-runs #updatePerTileVisibility which re-derives. */
  #hasNotesFor(cellLabel: string): boolean {
    const notesService = get<{ notesFor: (label: string) => unknown[] }>('@diamondcoreprocessor.com/NotesService')
    return (notesService?.notesFor(cellLabel)?.length ?? 0) > 0
  }


  // ── Profile resolution (now from registered descriptors) ───────────

  #resolveProfileKey(): OverlayProfileKey {
    // World mode takes precedence over everything: only the share-toggles show.
    if (this.#worldMode) return 'world'
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
    // Filter out actions whose genotype is currently hidden
    const descs = [...this.#registeredDescriptors.values()]
      .filter(d => d.profile === key)
      .filter(d => !d.genotype || this.#genotypeVisible.get(d.genotype) !== false)
      .sort((a, b) => (a.name === 'remove' ? 1 : 0) - (b.name === 'remove' ? 1 : 0))
    for (const desc of descs) {
      const btn = new HexIconButton({
        size: DEFAULT_ICON_SIZE,
        hoverTint: desc.hoverTint,
      })
      this.#overlay.addChild(btn)
      void btn.load(desc.svgMarkup)

      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: desc.profile,
        genotype: desc.genotype,
        visibleWhen: desc.visibleWhen,
        tintWhen: desc.tintWhen,
        labelKey: desc.labelKey,
        descriptionKey: desc.descriptionKey,
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
    const startX = Math.round(-(count - 1) * spacing / 2)

    for (let i = 0; i < count; i++) {
      visible[i].button.position.set(Math.round(startX + i * spacing), ICON_Y)
    }

    this.#drawButtonTray(count, spacing)
  }

  #drawButtonTray(iconCount: number, spacing: number): void {
    if (!this.#buttonTray) return

    this.#buttonTray.clear()

    const halfIcon = DEFAULT_ICON_SIZE / 2
    const pad = 3
    const totalWidth = (iconCount - 1) * spacing + DEFAULT_ICON_SIZE + pad * 2
    const trayHeight = DEFAULT_ICON_SIZE + pad * 2
    const x = -(totalWidth / 2)
    const y = ICON_Y - halfIcon - pad

    this.#buttonTray.roundRect(x, y, totalWidth, trayHeight, 2)
    this.#buttonTray.fill({ color: 0x0c0c1a, alpha: 0.6 })
  }

  // ── Per-tile icon visibility ───────────────────────────────────────

  #updatePerTileVisibility(): void {
    if (!this.#currentAxial) return

    // during image drag-over or pending drop, hide all action buttons — overlay is just a drop target
    if (this.#dropDragging || this.#dropPending) {
      for (const action of this.#actions) action.button.visible = false
      if (this.#buttonTray) this.#buttonTray.visible = false
      return
    }

    // Public mode used to hide every icon here, on the theory that
    // public was a "clean view" surface. With paired-channel sync we
    // need actionable public-own icons (expose, hide, break-apart),
    // so the per-icon `visibleWhen` + profile filtering downstream
    // decide what shows. No early suppression.

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
      hasSubstrate: this.#substrateLabels.has(entry.label),
      isBranch: this.#branchLabels.has(entry.label),
      hasLink: this.#linkLabels.has(entry.label),
      isHidden: this.#hiddenLabels.has(entry.label),
      hasNotes: this.#hasNotesFor(entry.label),
    }

    for (const action of this.#actions) {
      if (action.visibleWhen) {
        action.button.visible = action.visibleWhen(ctx)
      } else {
        action.button.visible = true
      }
      const tint = action.tintWhen ? action.tintWhen(ctx) : null
      action.button.setNormalTint(tint ?? null)
    }

    if (this.#buttonTray) {
      this.#buttonTray.visible = true
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
        this.#updateCellLabel(coord.q, coord.r)
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
    this.#poolContainer.destroy({ children: true })
    this.#poolIcons = []
    this.#poolBackground = null
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
        size: POOL_ICON_SIZE,
        hoverTint: entry.hoverTint,
      })
      btn.position.set(startX + i * POOL_SPACING, 0)
      btn.alpha = 0.5
      this.#poolContainer.addChild(btn)
      void btn.load(entry.svgMarkup)

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
    document.addEventListener('pointerdown', this.#onPointerDown)
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
      this.#updateCellLabel(axial.q, axial.r)

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
      this.#clearHint()

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
      this.#updateCellLabel(axial.q, axial.r)
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
      this.#clearHint()
      return
    }

    const ox = this.#overlay.position.x
    const oy = this.#overlay.position.y

    let hoveredName: string | null = null
    for (const a of this.#actions) {
      const btn = a.button
      // Invisible buttons keep their last laid-out position and can sit
      // under a visible neighbour — without this skip they steal the
      // hover (wrong or missing hint) while the click path, which does
      // filter on visibility, fires the visible icon's action.
      if (!btn.visible) { btn.hovered = false; continue }
      const bx = local.x - ox - btn.position.x
      const by = local.y - oy - btn.position.y
      const isHovered = btn.containsPoint(bx, by)
      btn.hovered = isHovered
      if (isHovered) hoveredName = a.name
    }

    // ── Action hint timer ──────────────────────────────────────────
    if (hoveredName !== this.#hintActionName) {
      this.#clearHint()
      if (hoveredName) {
        this.#hintActionName = hoveredName
        this.#hintTimer = setTimeout(() => this.#showHint(hoveredName!), HINT_DELAY_MS)
      }
    }
  }

  // ── Action hint display ─────────────────────────────────────────────

  #resolveI18n(): I18nProvider | undefined {
    return window.ioc.get<I18nProvider>(I18N_IOC_KEY) ?? undefined
  }

  #showHint(actionName: string): void {
    if (!this.#overlay) return
    const action = this.#actions.find(a => a.name === actionName && a.button.hovered)
    if (!action?.labelKey) return

    const i18n = this.#resolveI18n()
    const label = i18n?.t(action.labelKey) ?? action.name

    this.#clearHintText()

    const hcFont = getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()

    this.#hintText = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
        fontSize: HINT_FONT_SIZE,
        fill: HINT_COLOR,
        align: 'center',
      }),
      resolution: HINT_TEXT_RESOLUTION,
    })
    this.#hintText.anchor.set(0.5, 0)
    this.#hintText.position.set(action.button.position.x, HINT_Y_OFFSET)
    this.#hintText.alpha = 0.85
    this.#overlay.addChild(this.#hintText)
    this.#hintExpanded = false

    // Keep hovering → the description expands on its own. Expansion used
    // to be click-triggered, which turned every icon into a two-stage
    // button whenever the label was showing (first click expanded, second
    // click acted). The timer reuses #hintTimer so #clearHint cancels it.
    this.#hintTimer = setTimeout(() => this.#expandHint(), HINT_EXPAND_DELAY_MS)
  }

  #expandHint(): void {
    if (!this.#overlay || !this.#hintActionName || this.#hintExpanded) return
    const action = this.#actions.find(a => a.name === this.#hintActionName)
    if (!action?.descriptionKey) return

    const i18n = this.#resolveI18n()
    const description = i18n?.t(action.descriptionKey) ?? ''
    if (!description) return

    const hcFont = getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()

    this.#hintDescriptionText = new Text({
      text: description,
      style: new TextStyle({
        fontFamily: hcFont || "'Source Sans Pro Light', system-ui, sans-serif",
        fontSize: HINT_EXPANDED_FONT_SIZE,
        fill: HINT_COLOR,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: HINT_MAX_WIDTH,
      }),
      resolution: HINT_TEXT_RESOLUTION,
    })
    this.#hintDescriptionText.anchor.set(0.5, 0)
    const yBelow = HINT_Y_OFFSET + (this.#hintText ? this.#hintText.height + 2 : HINT_FONT_SIZE + 2)
    this.#hintDescriptionText.position.set(0, yBelow)
    this.#hintDescriptionText.alpha = 0.7
    this.#overlay.addChild(this.#hintDescriptionText)
    this.#hintExpanded = true
  }

  #clearHint(): void {
    if (this.#hintTimer) {
      clearTimeout(this.#hintTimer)
      this.#hintTimer = null
    }
    this.#hintActionName = null
    this.#hintExpanded = false
    this.#clearHintText()
  }

  #clearHintText(): void {
    if (this.#hintText) {
      this.#hintText.parent?.removeChild(this.#hintText)
      this.#hintText.destroy()
      this.#hintText = null
    }
    if (this.#hintDescriptionText) {
      this.#hintDescriptionText.parent?.removeChild(this.#hintDescriptionText)
      this.#hintDescriptionText.destroy()
      this.#hintDescriptionText = null
    }
  }

  // ── Instant branch navigation on pointerdown ────────────────────────
  #onPointerDown = (e: PointerEvent): void => {
    // Right-button down → instant back navigation (trailing pointerup + contextmenu suppressed)
    if (e.button === 2) {
      this.#beginBackGesture(e)
      return
    }
    // Shift + left-click → back navigation. Mac-friendly alternative to
    // right-click, which is awkward on trackpads (two-finger tap / Ctrl-click,
    // and Ctrl-click is reserved for selection here). Mirrors the right-button
    // gesture: the trailing click is suppressed via #consumedPointerId.
    if (e.button === 0 && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.#beginBackGesture(e)
      return
    }
    if (e.button !== 0) return
    if (this.#arrangeMode) return
    if (this.#navigationBlocked) return
    if (this.#editing || this.#editCooldown) return
    if (this.#hasSelection) return
    if (this.#touchDragging) return
    if (e.ctrlKey || e.metaKey) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return
    if (e.target !== this.#canvas) return

    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return

    const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const meshLocalX = local.x - this.#meshOffset.x
    const meshLocalY = local.y - this.#meshOffset.y
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
    if (!entry?.label) return
    if (!this.#branchLabels.has(entry.label)) return

    // Check that pointer is not on an action button — those use click
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x
      const oy = this.#overlay.position.y
      for (const action of this.#actions) {
        if (!action.button.visible) continue
        const btn = action.button
        const bx = local.x - ox - btn.position.x
        const by = local.y - oy - btn.position.y
        if (btn.containsPoint(bx, by)) return
      }
    }

    this.#consumedPointerId = e.pointerId
    consumePointerGesture(e.pointerId)
    this.#navigateInto(entry.label)
  }

  #onClick = (e: MouseEvent): void => {
    // Suppress the orphaned click from a pointerdown that already triggered navigation
    if (this.#consumedPointerId !== null) {
      this.#consumedPointerId = null
      return
    }
    if (this.#arrangeMode) return // arrange mode absorbs clicks
    if (this.#navigationBlocked) return
    if (this.#editing || this.#editCooldown) return
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return
    if (e.target !== this.#canvas) return

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

    // If pointermove hasn't fired since navigation (e.g. click without moving
    // the mouse after changing levels), resolve axial from click coordinates
    // so the click isn't swallowed.
    if (this.#currentIndex === undefined || this.#currentAxial === null) {
      const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
      if (!detector) return

      const pixiGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
      const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
      const meshLocalX = local.x - this.#meshOffset.x
      const meshLocalY = local.y - this.#meshOffset.y
      const axial = detector.pixelToAxial(meshLocalX, meshLocalY, this.#flat)

      this.#currentAxial = axial
      this.#currentIndex = this.#lookupIndex(axial.q, axial.r)
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
          this.#clearHint()
          // break-apart: play shatter animation first, then emit action
          if (action.name === 'break-apart') {
            this.playShatterAnimation(
              this.#currentAxial!.q,
              this.#currentAxial!.r,
              entry.label,
            )
            return
          }
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
    // Suppress orphaned pointerup from navigation gesture (click/contextmenu still pending)
    if (this.#consumedPointerId === e.pointerId) return
    if (e.button !== 2) return
    if (!this.#editing) return
    const drone = window.ioc.get<{ cancelEditing(): void }>('@diamondcoreprocessor.com/TileEditorDrone')
    drone?.cancelEditing()
  }

  #onContextMenu = (e: MouseEvent): void => {
    // Always suppress the native menu on our canvas; back-nav already fired on pointerdown.
    if (e.target === this.#canvas) e.preventDefault()
  }

  // ── Navigation ─────────────────────────────────────────────────────

  #navigateInto(label: string): void {
    const lineage = this.resolve<{ explorerEnter(name: string): void }>('lineage')
    if (!lineage) return
    this.#clearSelectionOnNavigate()
    this.emitEffect('tile:navigate-in', { label })

    // Side-channel: ping the swarm interest signal BEFORE we lineage-
    // enter. Other participants at the SAME location see our cue and
    // can choose to join — "I'm going in there, please follow."
    // Fire-and-forget; the publish is a kind-30203 with parameterized-
    // replaceable d-tag so repeated entries refresh rather than spam.
    // Safe when no swarm bee is loaded — silent no-op.
    interface SwarmInterestApi { publishInterest: (name: string) => Promise<void> }
    const swarm = window.ioc.get<SwarmInterestApi>('@diamondcoreprocessor.com/SwarmDrone')
    if (swarm?.publishInterest) {
      void swarm.publishInterest(label).catch(() => { /* silent — swarm logs internally */ })
    }

    lineage.explorerEnter(label)
    // Processor pulse triggered by lineage change
  }

  // Shared guard + commit for the back-navigation gesture (right-click or
  // shift+left-click). Bails on the same conditions as branch navigation, then
  // claims the pointer so the trailing click / contextmenu is suppressed.
  #beginBackGesture(e: PointerEvent): void {
    if (this.#arrangeMode) return
    if (this.#navigationBlocked) return
    if (this.#editing || this.#editCooldown) return
    if (e.ctrlKey || e.metaKey) return
    if (!this.#canvas || e.target !== this.#canvas) return
    const selection = window.ioc.get<{ count: number }>('@diamondcoreprocessor.com/SelectionService')
    if (selection && selection.count > 0) return
    const gate = window.ioc.get<InputGate>('@diamondcoreprocessor.com/InputGate')
    if (gate?.active) return
    this.#consumedPointerId = e.pointerId
    consumePointerGesture(e.pointerId)
    this.#navigateBack()
  }

  #navigateBack(): void {
    const lineage = this.resolve<{ explorerUp(): void }>('lineage')
    if (!lineage) return
    this.#clearSelectionOnNavigate()
    this.emitEffect('tile:navigate-back', {})
    lineage.explorerUp()
  }

  #clearSelectionOnNavigate(): void {
    const selection = window.ioc.get<{ count: number; clear(): void }>('@diamondcoreprocessor.com/SelectionService')
    if (selection && selection.count > 0) selection.clear()
    const pixi = window.ioc.get<{ selectedAxialKeys: ReadonlySet<string>; clearSelection(): void }>('@diamondcoreprocessor.com/TileSelectionDrone')
    if (pixi && pixi.selectedAxialKeys.size > 0) pixi.clearSelection()
  }

  // ── Helpers ────────────────────────────────────────────────────────

  #updateCellLabel(_q: number, _r: number): void {
    // shader-rendered label stays visible — no overlay text needed
  }

  #updateVisibility(): void {
    if (!this.#overlay) return

    // Screensaver owns the screen — keep the icon overlay hidden regardless of
    // hover/selection state. Released when screensaver:active goes false.
    if (this.#screensaverActive) { this.#overlay.visible = false; return }

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

    // Public mode used to hide the whole overlay here. With paired-
    // channel sync we want hover-to-expose to work in public mode, so
    // the overlay follows the normal hover-on-occupied logic and the
    // profile filter (public-own vs public-external) handles which
    // icons are surfaced. If you want a truly clean public view,
    // hover-disabled is a future setting, not an enforcement here.

    // Visibility depends only on whether the user is hovering an occupied
    // tile and the editor isn't open. `#editCooldown` is a click-suppression
    // window — it prevents the trailing click from save/cancel from being
    // re-processed by the overlay — but it must NOT hide the overlay itself,
    // otherwise the menu disappears for 300ms after every save and the user
    // sees "icons gone after edit." `#editing` already covers the
    // editor-is-open case (overlay must stay hidden); cooldown only matters
    // to onClick / onPointerDown, which still gate on it directly.
    const shouldShow = occupied && !this.#editing && !this.#touchDragging

    // When tiles are selected: overlay visible, hex bg hidden, per-tile icons still active
    if (this.#hasSelection) {
      this.#overlay.visible = occupied && !this.#editing
      if (this.#hexBg) this.#hexBg.hide()
      // Individual icon visibility is managed solely by #updatePerTileVisibility —
      // icons stay active during selection so per-tile actions (reroll, edit, etc.)
      // still work. Clicking the tile body (not an icon) falls through to tile:click.
      return
    }

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

  // ── Break-apart: shatter animation ─────────────────────────────────

  /** Run the shatter animation then emit the action. */
  playShatterAnimation(q: number, r: number, label: string): void {
    if (this.#shatterAnimating || !this.#renderContainer || !this.#app) return
    this.#shatterAnimating = true

    const R = this.#geo.circumRadiusPx
    const px = this.#axialToPixel(q, r)
    const ox = px.x + this.#meshOffset.x
    const oy = px.y + this.#meshOffset.y

    // hide the overlay during animation
    if (this.#overlay) this.#overlay.visible = false

    // create fragment container at tile position
    const container = new Container()
    container.position.set(ox, oy)
    container.zIndex = 10001
    this.#renderContainer.addChild(container)
    this.#shatterContainer = container

    // create 6 triangular wedges (hex split from center)
    const fragments: { g: Graphics; angle: number; speed: number; spin: number }[] = []
    const wedges = 6
    for (let i = 0; i < wedges; i++) {
      const a1 = (i / wedges) * Math.PI * 2 - Math.PI / 2
      const a2 = ((i + 1) / wedges) * Math.PI * 2 - Math.PI / 2
      const g = new Graphics()

      g.moveTo(0, 0)
      g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R)
      g.lineTo(Math.cos(a2) * R, Math.sin(a2) * R)
      g.closePath()
      g.fill({ color: 0x445566, alpha: 0.6 })
      g.stroke({ width: 0.5, color: 0x88aacc, alpha: 0.4 })

      container.addChild(g)

      const midAngle = (a1 + a2) / 2
      fragments.push({
        g,
        angle: midAngle,
        speed: 0.8 + Math.random() * 0.6,
        spin: (Math.random() - 0.5) * 4,
      })
    }

    // animate via ticker
    const duration = 500
    const startTime = performance.now()

    const tick = () => {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)

      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3)

      for (const frag of fragments) {
        const dist = ease * R * 1.8 * frag.speed
        frag.g.position.set(
          Math.cos(frag.angle) * dist,
          Math.sin(frag.angle) * dist,
        )
        frag.g.rotation = ease * frag.spin
        frag.g.alpha = 1 - ease
        frag.g.scale.set(1 - ease * 0.3)
      }

      if (t >= 1) {
        // cleanup
        this.#app!.ticker.remove(tick)
        this.#renderContainer!.removeChild(container)
        container.destroy({ children: true })
        this.#shatterContainer = null
        this.#shatterAnimating = false

        // fire the actual break-apart action
        this.emitEffect('tile:action', {
          action: 'break-apart',
          q, r,
          index: this.#lookupIndex(q, r) ?? 0,
          label,
        })
      }
    }

    this.#app.ticker.add(tick)
  }
}

const _tileOverlay = new TileOverlayDrone()
window.ioc.register('@diamondcoreprocessor.com/TileOverlayDrone', _tileOverlay)
