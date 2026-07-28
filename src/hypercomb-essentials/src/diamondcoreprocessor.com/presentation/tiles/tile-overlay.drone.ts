// diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
import { Drone, EffectBus, consumePointerGesture, type I18nProvider, I18N_IOC_KEY, type KeyMapLayer, ICON_PICK_REQUEST, type IconPickRequest, USAGE_IOC_KEY, type UsageRanker } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import { HexOverlayMesh } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial, HexDetector } from '../../navigation/hex-detector.js'
import type { InputGate } from '../../navigation/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'
import { hasDecorationKind, referenceTargetForLabel } from '../../commands/decoration-kind-index.js'
import { cellLocationSig } from '../../editor/tile-properties.js'
import type { VisualBeeRegistry, VisualBeeDescriptor } from '../../commands/visual-bee-registry.js'
import type { IconRegistryEntry } from './tile-actions.drone.js'
import { ICON_SPACING, ICON_Y, computeIconPositions } from './tile-actions.drone.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[]; branchLabels?: string[]; externalLabels?: string[]; noImageLabels?: string[]; substrateLabels?: string[]; linkLabels?: string[]; hiddenLabels?: string[]; shadedLabels?: string[]; flatPaths?: Record<string, string[]>; filterBlocked?: string[] }

// Backstop timeout (ms) for the navigation-transition guard. This is NOT the
// normal release — the guard lifts on render:cell-count (the renderer has
// rebuilt the maps a click reads for the level we moved TO), mirrored by the
// post-reveal navigation:guard-end. When the timer DOES fire (a render that
// exceeds it is routine under fetch stalls), it releases INPUT only — the
// axial map still describes the LEAVING level, so tile-ENTER stays refused
// via #tileEnterRefused until the first render:cell-count for the current
// location lands. Pan/zoom/selection stay live so the app never feels dead.
// (The prior value was 200ms and WAS the de-facto release — it undercut the
// guard on any layer whose render took >200ms, dropping it while the leaving
// level was still on screen so a 2nd click ran up a phantom address.)
const NAV_GUARD_BACKSTOP_MS = 6000

// HOLD-TO-ENTER. A tile that already has children enters on pointerdown
// (instant). A tile with NO children had no pointer path into its layer at
// all — the only way in was typing `/name` at the command line. Holding the
// press still on such a tile for this long opens its (empty) layer through
// the same #navigateInto choke point every other entry gesture uses.
// Mouse/pen only: on TOUCH a 300ms hold is already drag-to-move
// (move/touch-move.input.ts), so arming here would fight it.
const TILE_ENTER_HOLD_MS = 450
const TILE_ENTER_HOLD_JITTER_PX = 8

/** Launch-group pages live at single-segment ROOT locations named by group id
 *  (/games, /websites, /help, …) — each is its own leaf-only lineage,
 *  addressable directly. Resolved LIVE against the shell's GroupLauncher
 *  registry over IoC at call time (modules must not IMPORT shared — an IoC
 *  read is the sanctioned bridge). Legacy `agg-` locations still count so old
 *  history renders. On such a page every tile is a launcher: a click opens
 *  its target directly.
 *
 *  `openDirectly` groups are EXCLUDED per the LaunchGroup contract
 *  (group-registry.ts): they have no browsable aggregator page, so /<id> is a
 *  REAL cell page. Without this exclusion every press there was consumed into
 *  a silent `group:open` and the trailing click died — a tile on such a page
 *  would do nothing. */
function isLauncherLocation(segs: readonly unknown[]): boolean {
  if (segs.length !== 1 || typeof segs[0] !== 'string') return false
  if (segs[0].startsWith('agg-')) return true
  const reg = window.ioc.get<{ get?: (id: string) => { openDirectly?: boolean } | undefined }>('@hypercomb.social/GroupLauncher')
  const group = reg?.get?.(segs[0])
  return !!group && group.openDirectly !== true
}

type OverlayAction = {
  name: string
  button: HexIconButton
  profile: OverlayProfileKey
  genotype?: string
  /** Lives in the hidden danger row (delete) — revealed by tapping ⋮ (more).
   *  Suppressed while the tile has visible feature icons. */
  dangerRow?: boolean
  /** A FEATURE affordance — ⋮ reveals it BIGGER on the feature row(s),
   *  never the always-visible top row. */
  featureRow?: boolean
  /** If provided, called to determine per-tile visibility */
  visibleWhen?: OverlayVisibilityFn
  /** If provided, called to compute per-tile tint */
  tintWhen?: OverlayTintFn
  /** i18n key for the short hint label */
  labelKey?: string
  /** i18n key for the expanded description */
  descriptionKey?: string
  /** IoC key of the bee that services this action's `tile:action`. While it is
   *  unregistered the affordance is shaded + inert (feature not yet loaded). */
  backingKey?: string
  /** Derived per-tile: backingKey set but its bee not yet registered. */
  inert?: boolean
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
  /** Route into the hidden danger row (delete), revealed by the ⋮ toggle.
   *  Suppressed while the tile has visible feature icons. */
  dangerRow?: boolean
  /** Route into the FEATURE row(s) revealed by ⋮ — bigger icons showcasing
   *  what the tile carries (website, files, …). Never in the top row. */
  featureRow?: boolean
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
  /** IoC key of the bee that services this action. Until it registers, the
   *  overlay renders this affordance shaded + inert (feature not yet loaded). */
  backingKey?: string
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
// Feature icons used to render BIGGER, back when a ⋮ revealed them as their
// own showcase row. Everything a tile offers is now on screen together and
// wraps through the same two rows, so a second size would only make the block
// ragged — one size throughout.

// ── Two icon rows, wrapping ──────────────────────────────────────
// The hovered tile's band is two rows tall and the name steps aside
// (hex-sdf.shader.ts), so BOTH rows are icons: fill a row, wrap at
// MAX_ROW_ICONS, done. No toggle, no reveal, no set to choose — everything the
// tile offers is on screen at once.
//
// Order is main → feature → danger, so `remove` lands last (bottom-right, the
// furthest point from where the pointer enters the band).
const MAX_ROW_ICONS = 5
/** Rows the band can hold. Its height is fixed at two rows. */
const MAX_ICON_ROWS = 2
/** Centre-to-centre between the two rows — one band row each (0.15 × 32 ≈ 4.8,
 *  doubled). The block is centred on ICON_Y, so a single row sits dead centre
 *  and two rows straddle it. */
const ICON_ROW_PITCH = 10

// ── Arrange mode constants ────────────────────────────────────────

// Moved up 7 with ICON_Y (tile-actions.drone.ts) so the arrange pool keeps
// its spacing under the action row. Absolute, so it does NOT follow on its own.
const POOL_Y_OFFSET = 11
const POOL_ICON_SIZE = 5        // pool icons scaled proportionally
const POOL_SPACING = 8         // tighter to match smaller pool icons
const POOL_BG_PADDING = 2
const POOL_BG_COLOR = 0x222244
const POOL_BG_ALPHA = 0.6
const WIGGLE_SPEED = 4
const WIGGLE_AMPLITUDE = 0.06
const DRAG_ALPHA = 0.6
// Feature-readiness shade: an affordance whose backing bee hasn't registered
// yet renders at this alpha and is inert (see #updatePerTileVisibility and the
// click hit-test) — the "shaded until preloaded" rule, applied to features.
const INERT_ALPHA = 0.4
const DROP_HIGHLIGHT_TINT = 0x88ffff

// ── Action hint constants ────────────────────────────────────────
const HINT_DELAY_MS = 110       // near-instant hover-to-hint — just long enough to filter a mouse glance crossing the icon
const HINT_EXPAND_DELAY_MS = 1100 // sustained hover after the label appears → expanded description; clicks always fire the action
const HINT_Y_OFFSET = 17        // below the label band — moved up 7 with ICON_Y (absolute, does not follow on its own)
const HINT_FONT_SIZE = 6
const HINT_COLOR = 0xeaf0ff     // near-white — reads crisp against the dark hint pill
const HINT_EXPANDED_FONT_SIZE = 5.5
const HINT_MAX_WIDTH = 60
// Tooltip pill behind the hint text — turns the bare floating glyph into a
// clean, legible label that reads against any tile content.
const HINT_PILL_FILL = 0x0c0c1a
const HINT_PILL_ALPHA = 0.82
const HINT_PILL_PAD_X = 3
const HINT_PILL_PAD_Y = 1.5
const HINT_PILL_RADIUS = 2
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
  #actions: OverlayAction[] = []
  /** Unhook for the ioc.onRegister watch that un-shades a feature affordance
   *  the moment its backing bee registers (feature-readiness shade). */
  #unregisterBackingWatch: (() => void) | undefined
  #animTime = 0
  #animTickBound: ((ticker: any) => void) | null = null
  #meshOffset = { x: 0, y: 0 }
  #currentAxial: Axial | null = null
  #currentIndex: number | undefined = undefined
  /** Last raw pointer position over the canvas. A save / cell-count cascade can
   *  clear or desync #currentAxial while the cursor sits perfectly still — with
   *  no pointermove to follow, the menu would stay gone until the pointer next
   *  crossed a hex boundary ("icons gone after edit, until I wiggle the mouse").
   *  #recoverHover re-derives the hovered tile from this when that happens. */
  #lastPointerClient: { x: number; y: number } | null = null

  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY

  #cellCount = 0
  #cellLabels: string[] = []
  #cellCoords: Axial[] = []

  #listening = false
  #flat = false

  #occupiedByAxial = new Map<string, { index: number; label: string }>()
  #branchLabels = new Set<string>()
  /** Tag-flatten only: label → the match's ABSOLUTE lineage. A flattened tile
   *  can live anywhere, so entering it travels to this path rather than
   *  appending its name to wherever the view happens to be standing. */
  #flatPaths = new Map<string, string[]>()
  /** Tag-flatten only: matches whose subtree holds nothing tagged. Entering one
   *  would land on an empty filtered mesh, so the click is refused with a toast. */
  #filterBlocked = new Set<string>()
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
  /** Backstop latch: the 6s timer force-released INPUT but the new layer's
   *  render hasn't landed — the axial map still describes the LEAVING level.
   *  While set, tile-ENTER navigation (branch entry, launcher open, reference
   *  portal) is dropped; pan/zoom/selection stay live. Cleared by the first
   *  render:cell-count (the maps then describe the current location). */
  #tileEnterRefused = false
  // A tile entry / launcher open pressed while #tileEnterRefused was latched:
  // honored on the next render:cell-count if its label survives into the
  // fresh maps.
  #pendingEnter: string | null = null
  #pendingGroupOpen: string | null = null
  /** Monotonic axial-map generation — bumped on every #rebuildOccupiedMap.
   *  A press captures it so the trailing click can detect that the map was
   *  rebuilt underneath the pointer and re-bind by LABEL instead of position. */
  #mapGeneration = 0
  /** What the user actually pressed: captured at pointerdown so the click
   *  commits against the tile the user SAW, not whatever now sits at that
   *  position (see the generation re-bind in #onClick). */
  #pressCapture: { generation: number; axial: Axial; label: string } | null = null
  /** Tracks the pointerId that triggered a pointerdown-navigation, so the trailing pointerup + click can be suppressed. */
  #consumedPointerId: number | null = null
  /** An armed HOLD-TO-ENTER press on a childless tile: it opens that tile's
   *  empty layer if the pointer stays down and still for TILE_ENTER_HOLD_MS.
   *  `generation` pins the axial map the press was taken against — a render
   *  underneath the pointer invalidates the hold rather than entering a tile
   *  the user is no longer pressing. */
  #enterHold: {
    label: string
    pointerId: number
    origin: { x: number; y: number }
    generation: number
    timer: ReturnType<typeof setTimeout>
  } | null = null
  #meshPublic = false
  // World mode (toggled on the control bar): when on, the overlay shows ONLY
  // the two share-toggle icons (make-public / make-branch-public) — none of
  // the regular actions. Init from localStorage so a refresh keeps the mode.
  #worldMode = (() => { try { return localStorage.getItem('hc:world-mode') === '1' } catch { return false } })()
  #editing = false
  #editCooldown = false
  #editCooldownTimer: ReturnType<typeof setTimeout> | null = null
  #hasSelection = false
  /** A pheromone removal is armed (TagRemovalDrone): tile clicks stage and
   *  unstage tiles instead of entering or opening them, and the icon overlay
   *  stays out of the way. Cleared when the removal commits or is cancelled. */
  #tagRemovalArmed = false
  /** A pheromone APPLY brush is armed (PheromoneTilesDrone): the painter picked
   *  a keyword set to paint on. Same takeover as removal, but it is a BRUSH:
   *  pressing/dragging over tiles STAGES them (they are committed later by
   *  Done). The hive shows a paint cursor while armed. */
  #tagApplyArmed = false
  /** The tiles currently STAGED by the brush, mirrored from
   *  `tags:apply-pending {cells}`. Lets a press compute its stroke intent —
   *  press an unpainted tile to paint (add), a painted one to lift (remove). */
  #tagApplyStaged = new Set<string>()
  /** An in-flight paint stroke: `add` is fixed at press time so a drag paints
   *  (or lifts) consistently across every tile it crosses; `touched` dedupes so
   *  re-entering a tile mid-drag doesn't re-emit. null between strokes. */
  #applyStroke: { add: boolean } | null = null
  #applyStrokeTouched = new Set<string>()
  /** The cursor is on chrome above the canvas, so the hive is standing down.
   *  Latched so the "nothing hovered" broadcast fires once per entry. */
  #hoverSuppressed = false
  #touchDragging = false
  // The screensaver has taken over the screen — keep the icon overlay hidden
  // until it ends. Enforced centrally in #updateVisibility.
  #screensaverActive = false
  /** The mesh is hidden under a takeover (image hive, dive, screensaver). */
  #hiveHidden = false

  /** Registered descriptors from provider bees, keyed by name */
  #registeredDescriptors = new Map<string, OverlayActionDescriptor>()

  /** Genotype visibility — missing key means visible (default-on) */
  #genotypeVisible = new Map<string, boolean>()

  // ── Arrange mode state ──────────────────────────────────────────

  #arrangeMode = false
  #arrangeDirty = false
  /** Icon-protocol edit mode is on — overlay icons wiggle + a tap reskins. */
  #iconEditOn = false
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
  #hintBg: Graphics | null = null
  #hintDescriptionText: Text | null = null
  #hintDescriptionBg: Graphics | null = null
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
    'render:set-orientation', 'render:geometry-changed', 'render:set-hive-visible',
    'navigation:guard-start', 'navigation:guard-end',
    'mesh:public-changed', 'world:mode', 'editor:mode', 'selection:changed',
    'overlay:register-action', 'overlay:unregister-action', 'overlay:neon-color',
    'drop:dragging',
    'overlay:arrange-mode', 'overlay:pool-icons',
    'bee:disposed', 'genotype:set-visible',
    'substrate:applied', 'cell:removed', 'tile:saved',
    'tile:public-changed',
    'keymap:invoke',
    'icon:edit-mode', 'icon:override-changed',
    'tags:removal-pending', 'tags:apply-pending',
  ]
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back', 'tile:navigate-reference', 'drop:target', 'overlay:icons-reordered', 'overlay:request-register', 'overlay:feature-press', 'overlay:band-rows', 'group:open', 'icon:pick-request', 'toast:show', 'diag:click', 'diag:click-capture', 'tags:removal-toggle', 'tags:apply-toggle']

  #dropDragging = false

  #effectsRegistered = false
  // Handshake state: #requestedRegister makes #initOverlay emit
  // 'overlay:request-register' exactly once so every icon provider re-emits
  // into the now-ready overlay (fixes the boot "zero icons" replay race).
  // #arrangeRebuildPending defers a re-register-driven rebuild that arrives
  // mid arrange-drag (it would destroy the dragged button under the pointer);
  // #exitArrangeMode flushes it.
  #requestedRegister = false
  #arrangeRebuildPending = false

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
        if (this.#dropDragging) return
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

      // ── Delete the hovered tile ─────────────────────────────────
      // The trash icon was pulled off the hover overlay (too easy to click by
      // accident), so deletion is now an explicit gesture: the vertical
      // selection menu, OR Delete/Backspace over the tile under the cursor.
      // `selection.remove` (delete/backspace) is already owned by
      // RemoveQueenBee for the WHEN-SELECTED case — we handle only the
      // complementary nothing-selected case here, so the two never both fire.
      this.onEffect<{ cmd: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd !== 'selection.remove') return
        if (this.#hasSelection) return            // RemoveQueenBee owns the selection path
        if (this.#editing || this.#editCooldown) return
        if (this.#arrangeMode) return
        if (this.#meshPublic) return              // public mode: delete via select + menu only
        if (this.#dropDragging) return
        if (this.#currentTileExternal) return     // can't delete a peer's tile from your layer
        if (!this.#currentAxial) return
        const entry = this.#occupiedByAxial.get(
          TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r),
        )
        if (!entry?.label) return
        // Same payload + downstream path as the old trash icon's click —
        // TileActionsDrone handles 'remove' via #removeTile (LayerCommitter,
        // recorded in history, undoable).
        this.emitEffect('tile:action', {
          action: 'remove',
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
        this.#requestRebuild()
      })

      // Feature-readiness shade: when a backing bee registers, un-shade its
      // affordance live if the overlay is currently up on a tile that carries
      // it (otherwise the next hover refresh picks it up). Targeted so the
      // boot-time flood of registrations only repaints when it actually matters.
      this.#unregisterBackingWatch = window.ioc?.onRegister?.((key: string) => {
        if (!this.#overlay?.visible || !this.#currentAxial) return
        if (this.#actions.some(a => a.backingKey === key)) this.#updatePerTileVisibility()
      })

      this.onEffect<{ name: string; profile?: OverlayProfileKey }>('overlay:unregister-action', ({ name, profile }) => {
        // PROFILE-AWARE removal. #registeredDescriptors is keyed by NAME, but a
        // name (remove/files/invite/break-apart/contact) lives in several
        // profiles, so resolving the profile from the (last-written) descriptor
        // splices the WRONG profile's order — which is exactly how the full set
        // collapsed to the 2 non-shared survivors (link/meeting). Use the
        // payload's profile; if absent (legacy single-profile emitters whose
        // names are profile-unique, e.g. meeting-join/meeting-camera) clear the
        // name from every profile that lists it. Do NOT delete the shared
        // descriptor — another profile may still reference it and
        // #rebuildActiveProfile needs it to resolve; owner-scoped cleanup is
        // bee:disposed's job.
        const targets: OverlayProfileKey[] = profile ? [profile] : [...this.#activeOrder.keys()] as OverlayProfileKey[]
        for (const p of targets) {
          const order = this.#activeOrder.get(p)
          if (!order) continue
          const idx = order.indexOf(name)
          if (idx >= 0) order.splice(idx, 1)
        }
        this.#requestRebuild()
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

      // ── Universal icon protocol ─────────────────────────────────
      // Edit mode → overlay icons wiggle (ticker) + a tap reskins them.
      this.onEffect<{ on?: boolean }>('icon:edit-mode', ({ on }) => {
        this.#iconEditOn = !!on
        if (!this.#iconEditOn) {
          // Stop wiggling: settle every button back to upright.
          for (const a of this.#actions) a.button.rotation = 0
        }
      })
      // A reskin landed — rebuild so the new glyph renders (gated to overlay ids).
      this.onEffect<{ id?: string }>('icon:override-changed', ({ id }) => {
        if (id && id.startsWith('overlay:')) this.#rebuildActiveProfile()
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
        this.#flatPaths = new Map(Object.entries(payload.flatPaths ?? {}))
        this.#filterBlocked = new Set(payload.filterBlocked ?? [])
        this.#rebuildOccupiedMap()
        // The maps above now describe the level on screen — release the
        // backstop's tile-enter latch. cell-count only fires at render
        // completion for the CURRENT location, which is exactly the arrival
        // the latch waits on (the backstop released input early; tile entry
        // stayed refused until this render landed).
        this.#tileEnterRefused = false
        // A click that arrived while the latch was up was QUEUED, not eaten.
        // The maps are fresh now: if the tile the participant pressed is still
        // on screen, honor the press — their click lands late instead of
        // never. Absent label = the level genuinely changed under the click —
        // drop it (entering would mint a phantom segment).
        if (this.#pendingEnter) {
          const label = this.#pendingEnter
          this.#pendingEnter = null
          if (this.#cellLabels.includes(label)) this.#navigateInto(label)
          else console.warn('[tile-overlay] deferred tile-enter dropped — level changed before render landed:', label)
        }
        if (this.#pendingGroupOpen) {
          const label = this.#pendingGroupOpen
          this.#pendingGroupOpen = null
          if (this.#cellLabels.includes(label)) { this.#clearSelectionOnNavigate(); this.emitEffect('group:open', { label }) }
          else console.warn('[tile-overlay] deferred launcher open dropped — level changed before render landed:', label)
        }
        // A navigation transition is "done" the instant these maps describe the
        // level we moved to — which is exactly this emit: the renderer rebuilds
        // occupancy/branch data for the new level at render completion, right
        // before it reveals. The click guard exists solely to stop a 2nd/too-early
        // click from reading the LEAVING level's stale maps, so release it HERE.
        // That makes the guard hold for the FULL render (however long a big/cold
        // layer takes) instead of a blind 200ms timer that dropped it early and
        // let the click run up a phantom address. No-op on same-level re-renders
        // (edits/substrate) — nothing is blocked then.
        this.#endNavigationTransition()
        // The occupied map was just rebuilt (indices shifted). #recoverHover
        // re-looks-up #currentIndex against it — and re-derives #currentAxial
        // from the last pointer if the cascade cleared it — so overlay- and
        // button-visibility stay in agreement even if the cursor never moved.
        this.#recoverHover()
      })

      // substrate:applied runs via an in-place buffer path that doesn't re-emit
      // render:cell-count, so any icon's visibleWhen=hasSubstrate check would
      // stay false until the next full render. Track it incrementally and
      // refresh per-tile visibility so substrate-gated icons appear immediately.
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

      // A held tile started (or stopped) offering a peer merge. Same
      // treatment as notes: the icon's gate is derived inline at render
      // time from peer-divergence, so there's no cached set here to drift —
      // this only says WHEN to look again.
      this.onEffect('swarm:divergence-changed', () => {
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

      this.onEffect('navigation:guard-start', () => { this.#beginNavigationTransition() })

      // Post-reveal mirror of the render:cell-count release. Redundant with it
      // (cell-count fires just before this, from applyGeometry/clearMesh, so the
      // maps are already fresh by here) but kept as the semantic "hive is now on
      // screen" signal and a second release for paths that emit it.
      this.onEffect('navigation:guard-end', () => { this.#endNavigationTransition() })

      // A takeover feature (the image hive, a dive, the screensaver) hides the
      // mesh while it owns the screen. These icons belong to a tile in THAT
      // mesh, so they must go with it — left up they float over the takeover,
      // wired to a tile nobody can see.
      this.onEffect<{ visible: boolean }>('render:set-hive-visible', ({ visible }) => {
        this.#hiveHidden = !visible
        if (this.#hiveHidden) { if (this.#overlay) this.#overlay.visible = false }
        else this.#updateVisibility()
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
            // Safety refresh after cooldown ends. The image-drop save cascade
            // (cell:added → render:cell-count → cell-list rebuild) can clear
            // #currentAxial/#currentIndex between the editor:mode emit and the
            // final settle. #recoverHover re-derives the hovered tile (from the
            // last pointer if #currentAxial was cleared) so the menu reappears
            // on the still-hovered tile without the cursor crossing a hex.
            this.#recoverHover()
          }, 300)
          // Refresh now too — properties (link, hideText, noImage, image) may
          // have just changed and the cursor may already be over the tile, so
          // without this the post-save icon set doesn't appear until the next
          // pointer move. The deferred pass above covers the cascade-clears case.
          this.#recoverHover()
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

      // A staged pheromone removal takes over tile clicks: while it is armed,
      // clicking a tile stages/unstages it rather than entering or opening it.
      // Same shape as the selection takeover — presses stop navigating and the
      // click becomes a toggle — so the gesture is one the participant already
      // knows. The overlay hides too: none of its actions apply mid-staging.
      this.onEffect<{ active?: boolean }>('tags:removal-pending', (payload) => {
        this.#tagRemovalArmed = payload?.active === true
        this.#updateVisibility()
        this.#updatePerTileVisibility()
      })

      // The apply brush is the additive twin of the removal takeover: while a
      // keyword set is armed, pressing/dragging over tiles STAGES them (see
      // #beginApplyStroke / #onPointerMove) instead of navigating, the overlay
      // steps aside, and the hive wears a paint cursor. `cells` is the staged
      // set, mirrored so a press knows whether it is painting or lifting.
      this.onEffect<{ active?: boolean; cells?: string[] }>('tags:apply-pending', (payload) => {
        this.#tagApplyArmed = payload?.active === true
        this.#tagApplyStaged = new Set(Array.isArray(payload?.cells) ? payload!.cells : [])
        if (!this.#tagApplyArmed) { this.#applyStroke = null; this.#applyStrokeTouched.clear() }
        this.#applyPaintCursor()
        this.#updateVisibility()
        this.#updatePerTileVisibility()
      })

      this.onEffect<{ active: boolean }>('drop:dragging', ({ active }) => {
        this.#dropDragging = active
        // Entering the drag: suppress buttons (overlay is a bare drop target).
        // Leaving it: recover — the drop may have opened the editor or rebuilt
        // the map, clearing #currentAxial; #recoverHover re-derives so the menu
        // isn't stranded hidden. (No-ops while editing — the editor:mode close
        // handler runs the recovery once the panel dismisses.)
        if (active) { this.#updatePerTileVisibility(); this.#updateVisibility() }
        else this.#recoverHover()
      })
    }
  }

  protected override dispose(): void {
    this.#clearHint()
    this.#unregisterBackingWatch?.()
    this.#unregisterBackingWatch = undefined
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

    // No tray here: the icons sit on the SECOND row of the tile's own label
    // band, which the hex shader doubles while the tile is hovered (see
    // hex-sdf.shader.ts). One background, two rows — name above, icons below.

    this.#renderContainer.addChild(this.#overlay)
    this.#renderContainer.sortableChildren = true

    // drive hex overlay animations (breathe, embers, ambient, entry) + icon float + arrange wiggle
    if (this.#app && !this.#animTickBound) {
      this.#animTickBound = (ticker: any) => {
        this.#animTime += (ticker.deltaMS ?? 16) / 1000
        if (this.#hexBg && this.#overlay?.visible) {
          this.#hexBg.setTime(this.#animTime)
        }
        if (this.#arrangeMode || this.#iconEditOn) {
          this.#animateArrangeWiggle()
        }
      }
      this.#app.ticker.add(this.#animTickBound)
    }

    this.#rebuildActiveProfile()

    // Pull registration. The overlay subscribed to overlay:register-action in
    // heartbeat, but provider drones may have emitted their descriptors before
    // this overlay existed — and EffectBus keeps only the LAST value per
    // effect, so a late subscriber replays just one batch (the boot "zero
    // icons" race). Emit a STICKY request so every provider — current and
    // later-loading — re-emits its full descriptor set into the now-ready,
    // already-subscribed overlay, which accumulates them. One-shot; skipped in
    // arrange mode (a re-register rebuilds buttons and would destroy the
    // dragged one under the pointer).
    if (!this.#requestedRegister && !this.#arrangeMode) {
      this.#requestedRegister = true
      this.emitEffect('overlay:request-register', {})
      // Icon providers (edit/note/contact/…) self-register asynchronously
      // during boot, so a single early pull can land before they exist. Re-pull
      // once after they settle — providers respond idempotently and the overlay
      // accumulates, so the late ones fill in without churn.
      setTimeout(() => {
        if (!this.#arrangeMode) this.emitEffect('overlay:request-register', {})
      }, 800)
    }
  }

  /** Rebuild the active profile's buttons, unless an arrange drag is live —
   *  destroying #actions mid-drag would orphan #dragButton. Deferred rebuilds
   *  flush on #exitArrangeMode. */
  #requestRebuild(): void {
    if (this.#arrangeMode) { this.#arrangeRebuildPending = true; return }
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
    // A peer-EXTERNAL tile always carries its public-external affordances
    // (adopt / hide / block): if it is on your screen, you can act on it.
    // hc:mesh-public gates BROADCASTING your own tiles — it must not gate
    // adopting what you can already see. (With the old `!meshPublic →
    // private` short-circuit, peers rendered but hovering them showed NO
    // icons at all: the silent "hypercomb.io is not adopting" state.)
    if (this.#currentTileExternal) return 'public-external'
    if (!this.#meshPublic) return 'private'
    return 'public-own'
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

    // Build this profile's icon set from its OWN active-order list — NOT by
    // filtering #registeredDescriptors on `desc.profile`. That map is keyed by
    // name, so an icon declared for several profiles (e.g. `contact`, `remove`,
    // `files`) collides: only the last-emitted profile's descriptor survives,
    // which wrongly dropped those icons from every OTHER profile (the contact
    // icon never appearing in solo/private was this bug). #activeOrder tracks
    // per-profile membership correctly, and the per-profile descriptors for a
    // given name are functionally identical (same svg / visibleWhen / tint), so
    // resolving each name to its stored descriptor here is safe.
    // 'remove' stays rightmost.
    const order = this.#activeOrder.get(key) ?? []
    const seen = new Set<string>()
    const descs: OverlayActionDescriptor[] = []
    for (const name of order) {
      if (seen.has(name)) continue
      seen.add(name)
      const desc = this.#registeredDescriptors.get(name)
      if (!desc) continue
      if (desc.genotype && this.#genotypeVisible.get(desc.genotype) === false) continue
      descs.push(desc)
    }
    descs.sort((a, b) => (a.name === 'remove' ? 1 : 0) - (b.name === 'remove' ? 1 : 0))

    for (const desc of descs) {
      const btn = new HexIconButton({
        // Feature icons are the showcase — bigger glyph, bigger hit area.
        size: DEFAULT_ICON_SIZE,
        hoverTint: desc.hoverTint,
      })
      this.#overlay.addChild(btn)
      // Icon protocol: a participant reskin (overlay:<name>) wins over the
      // author SVG — render the chosen Material glyph to a texture instead.
      const ov = window.ioc.get<{ has(id: string): boolean; glyph(id: string, d: string): string }>('@hypercomb.social/IconOverrides')
      const overrideId = 'overlay:' + desc.name
      if (ov?.has(overrideId)) void btn.setGlyph(ov.glyph(overrideId, ''))
      else void btn.load(desc.svgMarkup)

      this.#actions.push({
        name: desc.name,
        button: btn,
        profile: key,
        genotype: desc.genotype,
        dangerRow: desc.dangerRow,
        featureRow: desc.featureRow,
        visibleWhen: desc.visibleWhen,
        tintWhen: desc.tintWhen,
        labelKey: desc.labelKey,
        descriptionKey: desc.descriptionKey,
        backingKey: desc.backingKey,
      })
    }

    // Layout: single centered row, evenly spaced at ICON_Y
    this.#layoutIconRow()
    this.#updatePerTileVisibility()
  }

  // ── Icon layout: fill a row, wrap, stop at two ─────────────────────
  // `base` = icons that passed their per-tile visibleWhen (set upstream by
  // #updatePerTileVisibility). Ordered main → feature → danger so `remove`
  // lands last, then chunked at MAX_ROW_ICONS. The rows are centred as a BLOCK
  // on ICON_Y, so one row sits dead centre of the doubled band and two rows
  // straddle it — one per band row. Horizontally every row shares the first
  // row's left edge (see below), so a wrap reads as one left-aligned block.

  #layoutIconRow(): void {
    const base = this.#actions.filter(a => a.button.visible)
    const ordered = [
      ...base.filter(a => !a.featureRow && !a.dangerRow),
      ...base.filter(a => a.featureRow),
      ...base.filter(a => a.dangerRow),
    ]

    const rows: OverlayAction[][] = []
    for (let i = 0; i < ordered.length; i += MAX_ROW_ICONS) {
      rows.push(ordered.slice(i, i + MAX_ROW_ICONS))
    }
    // The band is two rows tall — anything past that has nowhere to render.
    // Never silently: say what was dropped (it takes 11 visible affordances on
    // one tile to reach here, which no profile currently does).
    if (rows.length > MAX_ICON_ROWS) {
      const dropped = rows.slice(MAX_ICON_ROWS).flat()
      rows.length = MAX_ICON_ROWS
      console.warn(`[tile-overlay] ${dropped.length} icon(s) past the ${MAX_ICON_ROWS}-row band, not shown:`,
        dropped.map(a => a.name).join(', '))
    }

    // Only what is laid out is shown, so hit-testing matches what is drawn.
    const inSeq = new Set(rows.flat())
    for (const a of this.#actions) a.button.visible = inSeq.has(a)

    // Tell the renderer how tall to draw this tile's band. One row of icons
    // keeps the text's own height — the band grows only when the icons
    // actually wrap. Emitted every layout so it tracks per-tile visibility.
    this.emitEffect('overlay:band-rows', { rows: Math.max(1, rows.length) })

    if (rows.length === 0) return

    // ONE origin for every row: the FIRST row is centred, and each row after it
    // starts at that same x and reads left to right. The lefts line up on a
    // wrap instead of a short second row floating centred under a full first
    // one. Row 0 is always the widest (chunking fills it before wrapping), so
    // centring on it also centres the block — and a lone row is centred, which
    // is the same rule, not a special case.
    // Hex horizontal bound (mirrors computeIconPositions) — the row compresses to fit.
    const available = (27.7 - 3) * 2
    let spacing = ICON_SPACING
    if (rows[0].length > 1 && (rows[0].length - 1) * spacing > available) {
      spacing = available / (rows[0].length - 1)
    }
    const startX = Math.round(-(rows[0].length - 1) * spacing / 2)
    const top = ICON_Y - (rows.length - 1) * ICON_ROW_PITCH / 2
    rows.forEach((items, r) => {
      const y = Math.round(top + r * ICON_ROW_PITCH)
      items.forEach((a, j) => a.button.position.set(Math.round(startX + j * spacing), y))
    })
  }

  // ── Per-tile icon visibility ───────────────────────────────────────

  /** Hide every action button. The single reset used by all of
   *  #updatePerTileVisibility's "nothing to show here" exits, so no exit path
   *  can leave the buttons in a stale visible/hidden state from a prior call. */
  #hideAllButtons(): void {
    for (const action of this.#actions) action.button.visible = false
  }

  #updatePerTileVisibility(): void {
    // TOTAL FUNCTION: every exit fully determines button + tray state. The old
    // early `return`s left whatever the previous call set — so a drag hid the
    // tray, then a cleared #currentAxial / rebuilt occupied map bailed BEFORE
    // the restore at the bottom, stranding the menu hidden under a visible hex
    // ("icons gone after dropping an image / editing"). Now a missing tile
    // hides cleanly and #recoverHover re-derives once the cascade settles.
    if (!this.#currentAxial) { this.#hideAllButtons(); return }

    // during image drag-over, hide all action buttons — overlay is just a drop target
    if (this.#dropDragging) { this.#hideAllButtons(); return }

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
    if (!entry) { this.#hideAllButtons(); return }

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
      // Feature-readiness shade: an affordance whose backing bee has not yet
      // registered (loaded) is shaded + inert until it's available — the same
      // "shaded until preloaded" rule tiles follow. window.ioc.has is a cheap
      // live lookup; the onRegister watch (setup) repaints the instant it flips.
      action.inert = !!action.backingKey && !window.ioc?.has?.(action.backingKey)
      action.button.alpha = action.inert ? INERT_ALPHA : 1
    }

    // Re-layout so the tile's current icon set forms a tight centered row
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

    // Flush any re-register that arrived during the drag (deferred by
    // #requestRebuild) now that tearing down buttons is safe.
    if (this.#arrangeRebuildPending) {
      this.#arrangeRebuildPending = false
      this.#rebuildActiveProfile()
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
    // A hold must never survive the gesture it belongs to: a cancelled pointer
    // (browser gesture takeover, pen leaving range) or a window that loses
    // focus mid-press would otherwise navigate under a participant who is no
    // longer holding anything.
    document.addEventListener('pointercancel', () => this.#cancelEnterHold())
    window.addEventListener('blur', () => this.#cancelEnterHold())
    // CAPTURE-phase witness: records every raw click before any handler can
    // stopPropagation it. Read remotely via the bridge's `effect-last` —
    // `diag:click-capture` fired while `diag:click` stayed silent = something
    // between capture and bubble ate the event; both silent after a real
    // click = the click never dispatched at all (gesture/pointer level).
    document.addEventListener('click', (e) => {
      this.#captureClickCount++
      this.emitEffect('diag:click-capture', {
        n: this.#captureClickCount,
        target: (e.target as HTMLElement | null)?.tagName ?? null,
        targetIsCanvas: e.target === this.#canvas,
      })
    }, true)
  }

  #captureClickCount = 0

  /** Track hex position during image drag-over (pointermove doesn't fire during drag). */
  #onDragOverTrack = (e: DragEvent): void => {
    this.#lastPointerClient = { x: e.clientX, y: e.clientY }
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
    // Record the raw position unconditionally (before any guard) so #recoverHover
    // always has the freshest cursor to re-derive from after a settle.
    this.#lastPointerClient = { x: e.clientX, y: e.clientY }
    // Before any guard: travel past the jitter box means this press is a drag,
    // not a hold-to-enter.
    this.#trackEnterHold(e)
    if (this.#arrangeMode) return // arrange mode uses its own pointer handling
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return

    // The pointer is over shell chrome layered ABOVE the canvas — a docked
    // panel, a hover card, the command line. The hive must not react to a
    // cursor that is not on it: resolving a tile here pops that tile's icon
    // overlay THROUGH the panel and re-arms every hover-driven surface, which
    // is exactly the furniture the participant is trying to reach past.
    // #onPointerDown already gates on the same condition; hover was the hole.
    if (e.target !== this.#canvas) { this.#suppressHover(); return }
    this.#hoverSuppressed = false

    // Painting a stroke: extend it to whatever tile the cursor is now over. The
    // stroke's `add` was fixed at press time, so a drag paints (or lifts)
    // consistently; `#applyStrokeTouched` dedupes re-entered tiles. This runs
    // alongside the normal hover resolution below (the overlay stays hidden
    // while armed), so the brush keeps working as the pointer keeps moving.
    if (this.#applyStroke) {
      const label = this.labelAtClient(e.clientX, e.clientY)
      if (label && !this.#applyStrokeTouched.has(label)) {
        this.#applyStrokeTouched.add(label)
        this.emitEffect('tags:apply-paint', { label, add: this.#applyStroke.add })
      }
    }

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
      // Nothing to collapse on a new tile: every icon the tile offers is
      // already on screen, wrapped across the band's two rows.

      const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
      this.#currentTileExternal = !!(entry?.label && this.#externalLabels.has(entry.label))

      // A shaded tile keeps ALL of its affordances — hover ring, action
      // overlay, press, click. The shade tells you the inside is not loaded
      // yet; it never tells you that you may not go. Hovering lifts it back
      // to full opacity (show-cell), and clicking loads on demand — you wait,
      // but the choice is yours.

      // Recompute on EVERY hover-tile change (cheap key compare; rebuild only
      // on transitions). Previously gated on #meshPublic — which meant that
      // with mesh-public off the profile could never switch to
      // public-external when the pointer landed on a peer tile.
      {
        const newKey = this.#resolveProfileKey()
        if (newKey !== this.#activeProfileKey) this.#rebuildActiveProfile()
      }

      // Ctrl/Meta held: track position but hide overlay (selection mode, not navigation)
      if (e.ctrlKey || e.metaKey) {
        this.#overlay.visible = false
        this.emitEffect('tile:hover', { q: axial.q, r: axial.r, label: entry?.label ?? null })
        return
      }

      this.#positionOverlay(axial.q, axial.r)
      this.#updateCellLabel(axial.q, axial.r)
      this.#updatePerTileVisibility()
      // Carry the hovered tile's label so consumers (avatar swarm, contact
      // hover panel) can react without re-deriving from the occupied map.
      this.emitEffect('tile:hover', { q: axial.q, r: axial.r, label: entry?.label ?? null })
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
        fontWeight: '600',
        fill: HINT_COLOR,
        align: 'center',
      }),
      resolution: HINT_TEXT_RESOLUTION,
    })
    this.#hintText.anchor.set(0.5, 0)
    this.#hintText.position.set(action.button.position.x, HINT_Y_OFFSET)
    // Pill behind the label, added first so the text sits on top.
    this.#hintBg = this.#makeHintPill(this.#hintText, action.button.position.x, HINT_Y_OFFSET)
    this.#overlay.addChild(this.#hintBg)
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
    const yBelow = HINT_Y_OFFSET + (this.#hintText ? this.#hintText.height + 3 : HINT_FONT_SIZE + 3)
    this.#hintDescriptionText.position.set(0, yBelow)
    this.#hintDescriptionText.alpha = 0.92
    this.#hintDescriptionBg = this.#makeHintPill(this.#hintDescriptionText, 0, yBelow)
    this.#overlay.addChild(this.#hintDescriptionBg)
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

  /** Rounded translucent pill sized to a hint Text (anchored 0.5,0 at
   *  `centerX`,`topY`). Drawn behind the text for tooltip-grade legibility. */
  #makeHintPill(text: Text, centerX: number, topY: number): Graphics {
    const w = text.width + HINT_PILL_PAD_X * 2
    const h = text.height + HINT_PILL_PAD_Y * 2
    const g = new Graphics()
    g.roundRect(centerX - w / 2, topY - HINT_PILL_PAD_Y, w, h, HINT_PILL_RADIUS)
    g.fill({ color: HINT_PILL_FILL, alpha: HINT_PILL_ALPHA })
    return g
  }

  #clearHintText(): void {
    if (this.#hintBg) {
      this.#hintBg.parent?.removeChild(this.#hintBg)
      this.#hintBg.destroy()
      this.#hintBg = null
    }
    if (this.#hintText) {
      this.#hintText.parent?.removeChild(this.#hintText)
      this.#hintText.destroy()
      this.#hintText = null
    }
    if (this.#hintDescriptionBg) {
      this.#hintDescriptionBg.parent?.removeChild(this.#hintDescriptionBg)
      this.#hintDescriptionBg.destroy()
      this.#hintDescriptionBg = null
    }
    if (this.#hintDescriptionText) {
      this.#hintDescriptionText.parent?.removeChild(this.#hintDescriptionText)
      this.#hintDescriptionText.destroy()
      this.#hintDescriptionText = null
    }
  }

  /** True when the current location is a launch-group page (the website /
   *  game / help launcher menu). Race-free: reads the lineage + the launcher
   *  registry (synchronous), not the async decoration index. */
  #onLauncherPage(): boolean {
    const segs = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []
    return isLauncherLocation(segs)
  }

  // ── Instant branch navigation on pointerdown ────────────────────────
  #onPointerDown = (e: PointerEvent): void => {
    // Every new press invalidates the previous press-capture — a click must
    // only ever pair with ITS OWN pointerdown's capture.
    this.#pressCapture = null
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
    // Armed removal: the press must not navigate — the trailing click stages
    // the tile instead (see #onClick).
    if (this.#tagRemovalArmed) return
    // Armed apply is a BRUSH: the press starts a paint stroke (stages the tile
    // under it), a drag extends it across tiles, pointerup ends it. Staging
    // happens here, not on the trailing click.
    if (this.#tagApplyArmed) { this.#beginApplyStroke(e); return }
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

    // Bind this press to the TILE the user saw, not the position: capture the
    // map generation + resolved label. If the axial map is rebuilt between
    // now and the trailing click (render:cell-count for a new layer), #onClick
    // re-resolves by label and swallows the click when the tile is gone —
    // "the click hits what the user saw" is an invariant.
    this.#pressCapture = { generation: this.#mapGeneration, axial, label: entry.label }

    // If the press is over a VISIBLE overlay action button (edit, note, …), let
    // the click handler run that action — never treat it as a tile-body press.
    // This MUST run before the launcher branch below: on an aggregator page
    // every tile is a launcher, so without this the press would be swallowed by
    // group:open and the hover overlay's Edit icon would be dead. The icon
    // overlay then works on launcher tiles exactly as it does on normal tiles.
    if (this.#overlay?.visible) {
      const ox = this.#overlay.position.x
      const oy = this.#overlay.position.y
      for (const action of this.#actions) {
        if (!action.button.visible) continue
        const btn = action.button
        const bx = local.x - ox - btn.position.x
        const by = local.y - oy - btn.position.y
        if (btn.containsPoint(bx, by)) {
          // A press on a FEATURE icon may become a pin drag: EntrancePinDrone
          // tracks the pointer from here and, past the threshold, drags the
          // entrance up to the header bar. A plain release stays a click —
          // the trailing click runs the action as always.
          if (action.featureRow) {
            this.emitEffect('overlay:feature-press', {
              action: action.name, label: entry.label,
              pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY,
            })
          }
          return
        }
      }
    }

    // On a launch-group aggregator page EVERY tile is a launcher: a body press
    // OPENS its target directly (no arming, nothing to block). Gate on the
    // LOCATION, which is race-free — the per-cell `launch:target` decoration
    // index hydrates asynchronously, so relying on it made the first clicks on a
    // freshly-opened menu do nothing until you re-selected the icon. The
    // decoration check stays as a fallback for any launcher outside an
    // aggregator. Consume the pointer so the trailing click is suppressed.
    if (this.#onLauncherPage() || hasDecorationKind(entry.label, 'launch:target')) {
      this.#consumedPointerId = e.pointerId
      consumePointerGesture(e.pointerId)
      // Backstop latch: the map still describes the LEAVING level — opening a
      // launcher target now would navigate off a phantom tile. Drop the whole
      // gesture (pointer already consumed, so the trailing click dies too).
      if (this.#tileEnterRefused) {
        // Same queue-not-drop treatment as plain tile entry below: the open
        // fires when fresh maps land and still show this launcher.
        this.#pendingGroupOpen = entry.label
        console.warn('[tile-overlay] launcher open deferred — render not landed yet:', entry.label)
        return
      }
      this.#clearSelectionOnNavigate()
      this.emitEffect('group:open', { label: entry.label })
      return
    }
    // A CHILDLESS tile has nothing to enter on a press — but holding it opens
    // its empty layer (see #beginEnterHold). Nothing is consumed while the
    // hold is merely armed: a short press still falls through to #onClick, so
    // click-to-open and the overlay actions behave exactly as before.
    if (!this.#branchLabels.has(entry.label)) {
      this.#beginEnterHold(e, entry.label)
      return
    }

    this.#cancelEnterHold()
    this.#consumedPointerId = e.pointerId
    consumePointerGesture(e.pointerId)
    this.#navigateInto(entry.label)
  }

  // ── Hold-to-enter (childless tiles) ────────────────────────────────
  // Arms the hold for THIS press. Cancelled by any pointer travel past the
  // jitter box, by the release, by a pointercancel, or by the window losing
  // focus — so it only ever fires on a deliberate still hold.
  #beginEnterHold(e: PointerEvent, label: string): void {
    this.#cancelEnterHold()
    // Touch holds belong to drag-to-move; pen and mouse are free.
    if (e.pointerType === 'touch') return
    const pointerId = e.pointerId
    const generation = this.#mapGeneration
    const timer = setTimeout(() => {
      this.#enterHold = null
      // Re-check every gate that could have flipped during the hold — the
      // press is old news by now, and entering against a rebuilt map would
      // mint a phantom segment.
      if (generation !== this.#mapGeneration) return
      if (this.#arrangeMode || this.#navigationBlocked) return
      if (this.#editing || this.#editCooldown) return
      if (this.#hasSelection || this.#touchDragging) return
      if (this.#tagRemovalArmed || this.#tagApplyArmed) return
      this.#consumedPointerId = pointerId
      consumePointerGesture(pointerId)
      this.#pressCapture = null
      this.emitEffect('tile:enter-hold', { label })
      this.#navigateInto(label)
    }, TILE_ENTER_HOLD_MS)
    this.#enterHold = { label, pointerId, origin: { x: e.clientX, y: e.clientY }, generation, timer }
  }

  #cancelEnterHold(): void {
    if (!this.#enterHold) return
    clearTimeout(this.#enterHold.timer)
    this.#enterHold = null
  }

  /** Drop the hold once the pointer has travelled out of its jitter box — a
   *  drag (pan, brush, pin) is not a hold. */
  #trackEnterHold(e: PointerEvent): void {
    const hold = this.#enterHold
    if (!hold || e.pointerId !== hold.pointerId) return
    if (Math.abs(e.clientX - hold.origin.x) > TILE_ENTER_HOLD_JITTER_PX
      || Math.abs(e.clientY - hold.origin.y) > TILE_ENTER_HOLD_JITTER_PX) this.#cancelEnterHold()
  }

  #onClick = (e: MouseEvent): void => {
    // Every early-return names itself on `diag:click` — the bridge's
    // `effect-last` reads the sticky, so "clicking does nothing" is
    // diagnosable remotely instead of by guessing which guard ate it.
    const diag = (stage: string): void => {
      this.emitEffect('diag:click', { stage, target: (e.target as HTMLElement | null)?.tagName ?? null })
    }
    // Suppress the orphaned click from a pointerdown that already triggered navigation
    if (this.#consumedPointerId !== null) {
      this.#consumedPointerId = null
      this.#pressCapture = null
      diag('consumed-pointer')
      return
    }
    if (this.#arrangeMode) { diag('arrange-mode'); return } // arrange mode absorbs clicks
    if (this.#navigationBlocked) { diag('navigation-blocked'); return }
    if (this.#editing || this.#editCooldown) { diag('editing'); return }
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) { diag('no-renderer'); return }
    if (e.target !== this.#canvas) { diag('target-not-canvas'); return }

    // ── Armed pheromone removal ──────────────────────────────────────────
    // A click stages (or unstages) the tile for losing the keyword — it never
    // navigates, opens or selects while the removal is armed. Resolved from
    // the click's own coordinates so it works without a preceding hover, and
    // placed ahead of every other branch so no action button can eat it.
    if (this.#tagRemovalArmed) {
      const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
      if (!detector) { diag('no-detector'); return }
      const pg = this.#clientToPixiGlobal(e.clientX, e.clientY)
      const lp = this.#renderContainer.toLocal(new Point(pg.x, pg.y))
      const ax = detector.pixelToAxial(lp.x - this.#meshOffset.x, lp.y - this.#meshOffset.y, this.#flat)
      const staged = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(ax.q, ax.r))
      if (!staged?.label) { diag('removal-empty-hex'); return }
      this.emitEffect('tags:removal-toggle', { label: staged.label })
      return
    }

    // ── Armed pheromone apply brush ──────────────────────────────────────
    // The brush stages on pointerdown (and drags across tiles) — see
    // #beginApplyStroke — so the trailing click has nothing to do but decline
    // to navigate. Swallowing it here keeps a paint press from ALSO entering
    // the tile.
    if (this.#tagApplyArmed) { diag('apply-armed'); return }

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

    // ── Generation re-bind: commit against the tile the user SAW ─────────
    // #onPointerDown captured {generation, axial, label} when the press
    // resolved. If the axial map was rebuilt since (render:cell-count landed
    // between press and click — e.g. a trailing click arriving after the
    // guard cleared for a NEW layer), the same position now describes a
    // different layer's tile. Re-resolve by LABEL in the current map: commit
    // only if the pressed tile still resolves here; otherwise swallow the
    // click entirely (no navigation, no selection change).
    const press = this.#pressCapture
    this.#pressCapture = null
    if (press && press.generation !== this.#mapGeneration) {
      let rebound: { q: number; r: number; index: number } | null = null
      for (const [key, occ] of this.#occupiedByAxial) {
        if (occ.label !== press.label) continue
        const [q, r] = key.split(',').map(Number)
        rebound = { q, r, index: occ.index }
        break
      }
      if (!rebound) {
        console.warn('[tile-overlay] click swallowed — tile map changed since press and', press.label, 'no longer resolves here')
        diag('press-rebind-failed')
        return
      }
      this.#currentAxial = { q: rebound.q, r: rebound.r }
      this.#currentIndex = rebound.index
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

    if (this.#currentIndex === undefined || this.#currentIndex >= this.#cellCount) { diag('index-out-of-range'); return }

    const entry = this.#occupiedByAxial.get(
      TileOverlayDrone.axialKey(this.#currentAxial!.q, this.#currentAxial!.r),
    )
    if (!entry?.label) { diag('no-entry-at-axial'); return }

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
          // Shaded feature (backing bee not yet loaded): swallow the click so it
          // neither runs the action nor falls through to a tile-body press.
          if (action.inert) { this.#clearHint(); return }
          this.#clearHint()
          // Icon edit mode: a tap reskins this overlay icon instead of running
          // it. Write-through (no `store: false`), so the pick lands in the
          // icon override store and every surface re-resolves live — this
          // drone never has to hear the answer. Contract: ICON_PICK_REQUEST /
          // ICON_PICK_RESULT in @hypercomb/core (a module can't use shared's
          // requestIconPick helper, but the events are the same).
          if (this.#iconEditOn) {
            this.emitEffect(ICON_PICK_REQUEST, { id: 'overlay:' + action.name } satisfies IconPickRequest)
            return
          }
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

    if (this.#branchLabels.has(entry.label) || referenceTargetForLabel(entry.label) !== null) {
      // A branch (enter its children) OR a reference tile (portal to its
      // target). #navigateInto routes references to their pointer.
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
    // A release ends any armed hold — a hold that already fired cleared itself
    // and consumed this pointer, so this is a no-op on that path.
    this.#cancelEnterHold()
    // End a paint stroke on release — the staged set persists (Done commits it),
    // only the stroke does. Left button, before the nav-gesture guards below.
    if (e.button === 0 && this.#applyStroke) {
      this.#applyStroke = null
      this.#applyStrokeTouched.clear()
      return
    }
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

  // Arm the navigation-transition guard SYNCHRONOUSLY. The render pipeline's
  // `navigation:guard-start` also calls this, but that fires AFTER the pulse —
  // async. Between a tile-click committing a navigation (below) and that
  // guard-start landing, #navigationBlocked is still false and the tile maps
  // (#branchLabels/#occupiedByAxial) still describe the level we're LEAVING.
  // A double-click's second press, or a too-early press on a slow frame, would
  // read those stale maps and enter a child that doesn't exist at the new
  // level — appending a phantom URL segment that then "runs up" as you keep
  // clicking. Arming here closes that window: the trailing pointerdown/click is
  // blocked (#onPointerDown / #onClick both check #navigationBlocked) until the
  // renderer rebuilds the maps for the new level — `render:cell-count`, mirrored
  // by the post-reveal `navigation:guard-end` (see #endNavigationTransition).
  // The timer below is ONLY a long backstop against a render that emits neither;
  // it must never be the normal release. It previously fired at 200ms and WAS
  // the de-facto release, which undercut the guard on any layer whose render ran
  // longer than that: it dropped the block while the LEAVING level was still on
  // screen, so a 2nd click still read stale maps and ran up a phantom address.
  #beginNavigationTransition = (): void => {
    this.#navigationBlocked = true
    this.#currentAxial = null
    this.#currentIndex = undefined
    if (this.#overlay && !this.#arrangeMode) this.#overlay.visible = false
    // Backstop only — the real release is render:cell-count / guard-end. Arm it
    // as a FIXED deadline: set it once and NEVER push it out. `guard-start`
    // re-arms this on every render of a burst, so resetting the timer each call
    // would let a storm of renders extend the block indefinitely and strand the
    // layer. Arming only when unset guarantees input frees within
    // NAV_GUARD_BACKSTOP_MS of the FIRST arm, whatever races follow.
    if (!this.#navigationGuardTimer) {
      this.#navigationGuardTimer = setTimeout(() => {
        this.#navigationGuardTimer = null
        // The render exceeded the deadline (routine under fetch stalls).
        // Release INPUT so the app never feels dead — but the axial map still
        // describes the LEAVING level, so entering a tile now would push a
        // phantom URL segment. Latch tile-ENTER refusal instead: pan/zoom/
        // selection stay live; navigation INTO a tile is dropped (with a
        // console.warn) until the first render:cell-count for the current
        // location lands (cleared in that handler).
        this.#navigationBlocked = false
        this.#tileEnterRefused = true
      }, NAV_GUARD_BACKSTOP_MS)
    }
  }

  // Release the navigation-transition guard. Called when the renderer has
  // rebuilt the tile maps for the level we navigated to: render:cell-count fires
  // at render completion on EVERY path (full paint via applyGeometry's tail,
  // empty/bail via clearMesh), mirrored by the post-reveal navigation:guard-end.
  // Idempotent — a no-op when nothing is in flight (e.g. a same-level edit's
  // cell-count), so it is safe to call from the always-firing cell-count handler.
  #endNavigationTransition = (): void => {
    this.#navigationBlocked = false
    this.#consumedPointerId = null
    if (this.#navigationGuardTimer) {
      clearTimeout(this.#navigationGuardTimer)
      this.#navigationGuardTimer = null
    }
  }

  // Current lineage location as a normalized "/"-joined key. Captured BEFORE a
  // nav commit so we can tell whether the commit actually moved.
  #currentLocationKey(): string {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    return (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  // Release the guard immediately if a nav commit did NOT change the location —
  // a no-op nav (back at the root; a reference/sets hop that targets where you
  // already are). Such a nav fires no render, so render:cell-count never
  // arrives and ONLY the backstop timer would clear the guard: a multi-second
  // dead layer, the exact "locked onto a layer" failure. The commit updates
  // lineage.explorerPath synchronously (explorerEnter appends; goRaw dispatches
  // 'navigate' → followLocation), so an unchanged key here means nothing moved.
  #releaseGuardIfNoMove(before: string): void {
    if (this.#currentLocationKey() === before) this.#endNavigationTransition()
  }

  /** The view of a behaviour on this tile that TAKES OVER the click — opening
   *  its view instead of entering the tile. Null when the tile carries none.
   *  Both reads are synchronous (the hot decoration index + the registry), so
   *  this stays safe inside the click path.
   *
   *  When SEVERAL behaviours on the tile open on click, the winner is the
   *  lowest `takeoverRank` (unset = 0), then registration order — never the
   *  decoration index's insertion order, which is an accident of which
   *  decoration resolved first this session. Switching a behaviour off on the
   *  tile (the hidden pool) removes it from contention here, because
   *  `hasDecorationKind` already filters hidden kinds. */
  #viewTakeoverFor(label: string): string | null {
    const registry = window.ioc.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
    if (!registry?.all) return null
    let winner: VisualBeeDescriptor | null = null
    for (const bee of registry.all()) {
      if (!bee.opensOnTileClick || !hasDecorationKind(label, bee.decorationKind)) continue
      if (!winner || (bee.takeoverRank ?? 0) < (winner.takeoverRank ?? 0)) winner = bee
    }
    return winner?.view ?? null
  }

  #navigateInto(label: string): void {
    // Backstop latch: input was force-released after NAV_GUARD_BACKSTOP_MS
    // but the axial map still describes the LEAVING level — entering a tile
    // now would be a phantom-child navigation (bogus URL segment). Drop the
    // entry before ANY side effect (no guard arm, no selection change); the
    // latch clears on the first render:cell-count for the current location.
    if (this.#tileEnterRefused) {
      // DON'T EAT THE CLICK. The latch exists because the maps may describe a
      // level being left — entering against them could mint a phantom segment.
      // But silently dropping the press was the "I clicked and I wait" bug:
      // the participant saw nothing happen and blamed the tile. Queue the
      // intent instead; the moment render:cell-count lands, if the fresh maps
      // still contain this label the entry fires — the click lands LATE, never
      // never. A label absent from the fresh maps (the level really changed
      // underneath) is dropped there, with the warn.
      this.#pendingEnter = label
      console.warn('[tile-overlay] tile-enter deferred — render not landed yet; will enter', label, 'when maps are fresh')
      return
    }

    // TAG-FILTER dead end. Under a live filter the filter follows you in, so a
    // branch with nothing tagged inside would open onto a blank mesh. Refuse
    // and say why. This sits in #navigateInto rather than in a click handler
    // because entry has more than one gesture path (click and press-drag) —
    // the choke point is the only place that covers them all.
    if (this.#filterBlocked.has(label)) {
      const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('toast:show', {
        type: 'info',
        title: i18n?.t('tags.filter.blocked.title') ?? 'Nothing tagged in here',
        message: i18n?.t('tags.filter.blocked.message', { cell: label })
          ?? `"${label}" has no tagged tiles inside. Clear the filter to browse it.`,
      })
      return
    }

    // VIEW TAKEOVER: this tile carries a behaviour that declares it OPENS ON
    // TILE CLICK (a slides deck). PLAY it instead of entering its hexagon
    // layer — the view mounts over THIS layer and nothing navigates, so closing
    // it returns the participant right here and the deck's own grid is never
    // rendered. Deliberately BEFORE the navigation transition is armed: there
    // is no navigation to guard, and arming it would strand the guard.
    const takeover = this.#viewTakeoverFor(label)
    if (takeover) {
      const segs = (window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
        ?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      EffectBus.emit('view:open-for-tile', { view: takeover, segments: [...segs, label] })
      return
    }

    const lineage = this.resolve<{ explorerEnter(name: string): void }>('lineage')
    if (!lineage) return

    // Snapshot where we are BEFORE committing, so a branch that resolves to the
    // CURRENT location (a no-op) can release the guard instead of stranding it.
    const before = this.#currentLocationKey()

    // COUNT THE INTERACTION, at the choke point every entry gesture passes
    // through — the tile you MEET is the tile whose insides deserve to be
    // preloaded first, next time. Keyed by the tile's own location sig (the
    // same key its properties use), fire-and-forget, durable through the
    // tracker's write-ahead queue. A settled visit is counted separately by
    // the tracker's lineage hook; both feed one weight.
    void this.#countInteraction(label)

    // Block re-entry for the duration of this transition — every branch below
    // commits a navigation (reference portal, sets-root hop, or explorerEnter).
    this.#beginNavigationTransition()

    // REFERENCE portal: a reference tile is a live pointer to another lineage —
    // clicking it TRAVELS to that location rather than entering a child. The
    // target ([] = hive root) is resolved synchronously from the decoration
    // index (warm by paint time, same guarantee launch:target relies on).
    const refTarget = referenceTargetForLabel(label)
    if (refTarget !== null) {
      this.#clearSelectionOnNavigate()
      // Announce the portal BEFORE travelling. A reference may demand marks of
      // what it shows, and only the reference cell knows them — once we have
      // landed it is behind us and no longer resolvable from where we stand.
      this.emitEffect('tile:navigate-reference', { label })
      const nav = window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      nav?.goRaw?.([...refTarget])
      this.#releaseGuardIfNoMove(before)
      return
    }

    // TAG-FLATTEN entry: the tile on screen was gathered from somewhere else in
    // the hive, so its name means nothing relative to the current location.
    // Travel to its recorded absolute path — explorerEnter would append the
    // label here and mint a phantom segment.
    const flatPath = this.#flatPaths.get(label)
    if (flatPath) {
      this.#clearSelectionOnNavigate()
      this.emitEffect('tile:navigate-in', { label })
      const nav = window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      nav?.goRaw?.([...flatPath])
      this.#releaseGuardIfNoMove(before)
      return
    }

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

    const segs = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? []
    if (segs.length === 1 && String(segs[0]) === 'sets') {
      const nav = window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')
      if (nav?.goRaw) { nav.goRaw([label]); this.#releaseGuardIfNoMove(before); return }
    }

    lineage.explorerEnter(label)
    // Processor pulse triggered by lineage change. A valid label always appends
    // a segment (explorerEnter guards empty/'.'/'..'), so this is never a no-op
    // on the normal path — the check is belt-and-braces and simply won't fire.
    this.#releaseGuardIfNoMove(before)
  }

  /** Record one interaction with the tile at `label` under the current
   *  location. Best-effort: no tracker (or an older contract without `bump`)
   *  ⇒ silent no-op, exactly like every other usage read. */
  async #countInteraction(label: string): Promise<void> {
    try {
      const ranker = window.ioc.get<UsageRanker>(USAGE_IOC_KEY)
      if (!ranker?.bump) return
      const segs = (this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
        ?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      ranker.bump(await cellLocationSig(segs, label))
    } catch { /* local telemetry — never blocks navigation */ }
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
    // A pinned layer holds the gate under the 'pin' owner — that freezes the
    // VIEWPORT (no pan, no zoom), it must never freeze navigation. Back out of
    // a pinned page and the pin stays behind with the page. Every other holder
    // (editor, palette, a live gesture claim) still blocks the gesture.
    if (gate?.active && !gate.lockedOnlyBy?.('pin')) return
    this.#consumedPointerId = e.pointerId
    consumePointerGesture(e.pointerId)
    this.#navigateBack()
  }

  #navigateBack(): void {
    const lineage = this.resolve<{ explorerUp(): void; explorerSegments?(): readonly string[] }>('lineage')
    if (!lineage) return
    const before = this.#currentLocationKey()
    // Same race guard as #navigateInto: block a double back-gesture from
    // over-popping past the level this transition is settling on.
    this.#beginNavigationTransition()
    this.#clearSelectionOnNavigate()
    this.emitEffect('tile:navigate-back', {})

    // TRUE BACK — retrace the pages actually visited, not the structural parent.
    // A set/collection opened from an aggregate page (/sets) is a ROOT-HOP: its
    // own top-level segment, so popping a segment (explorerUp) would jump to the
    // hive root instead of BACK to /sets. window.history.back() walks the real
    // visited sequence (… → /sets → /music → back → /sets → back → root), the
    // same mechanism as the controls-bar back button. The move settles async via
    // popstate → render:cell-count, which ends the navigation guard; the guard's
    // backstop timer covers a no-op back (no in-app history to pop). At the hive
    // root there is nothing to retrace to — keep the prior no-op + release now.
    const segs = lineage.explorerSegments?.() ?? []
    if (segs.length === 0) { this.#releaseGuardIfNoMove(before); return }

    const nav = window.ioc.get<{ back?(): void }>('@hypercomb.social/Navigation')
    if (nav?.back) nav.back()
    else { lineage.explorerUp(); this.#releaseGuardIfNoMove(before) }   // defensive fallback
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

    // The mesh itself is hidden under a takeover — nothing these icons point
    // at is on screen. Released when the hive comes back.
    if (this.#hiveHidden) { this.#overlay.visible = false; return }

    // An armed pheromone removal / apply brush owns tile clicks — every icon
    // here would be unreachable, so show none of them rather than dead ones.
    if (this.#tagRemovalArmed || this.#tagApplyArmed) { this.#overlay.visible = false; return }

    // Arrange mode: overlay stays visible
    if (this.#arrangeMode) {
      this.#overlay.visible = true
      return
    }

    // during image drag-over, show overlay as a drop target / placeholder
    if (this.#dropDragging) {
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
      // icons stay active during selection so per-tile actions (edit, note, etc.)
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

  /** Re-assert the hovered tile's overlay after a state transition settles.
   *  The save / cell-count cascade rebuilds the occupied map (indices shift)
   *  and can clear #currentAxial while the cursor sits still. Without a
   *  pointermove to follow, the two visibility functions would disagree —
   *  #updateVisibility reading a stale-valid #currentIndex (overlay shown)
   *  while #updatePerTileVisibility finds no map entry (buttons hidden): a hex
   *  with an empty menu. This re-derives #currentAxial from the last pointer
   *  when it was cleared, ALWAYS re-looks-up #currentIndex against the fresh
   *  map so both functions agree, then refreshes. No-op mid-navigation (maps
   *  still describe the leaving level) or while editing (overlay stays hidden). */
  #recoverHover(): void {
    if (this.#navigationBlocked || this.#editing) return
    if (!this.#currentAxial) this.#deriveHoverFromLastPointer()
    else this.#currentIndex = this.#lookupIndex(this.#currentAxial.q, this.#currentAxial.r)
    if (this.#overlay && this.#currentAxial) {
      this.#updateVisibility()
      this.#updatePerTileVisibility()
    }
  }

  /** Recompute #currentAxial/#currentIndex from #lastPointerClient — the same
   *  pixel→axial path #onPointerMove runs, used only when the cursor is still
   *  and #currentAxial was cleared. Leaves them untouched if the pointer or the
   *  render refs are unavailable (recovery is best-effort; the next real
   *  pointermove always corrects it). */
  #deriveHoverFromLastPointer(): void {
    const p = this.#lastPointerClient
    if (!p) return
    if (!this.#renderContainer || !this.#overlay || !this.#renderer || !this.#canvas) return
    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return
    const pixiGlobal = this.#clientToPixiGlobal(p.x, p.y)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const axial = detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat)
    this.#currentAxial = axial
    this.#currentIndex = this.#lookupIndex(axial.q, axial.r)
    this.#positionOverlay(axial.q, axial.r)
    this.#updateCellLabel(axial.q, axial.r)
  }

  /** Which tile sits under a VIEWPORT point, or null for empty hex / off-canvas.
   *
   *  The same pixel→axial→occupied resolution the armed-brush click branch does,
   *  exposed because a drop must land where the pointer was RELEASED. Consumers
   *  that instead remember the last `tile:hover` are wrong in three situations
   *  this drone creates: #suppressHover nulls the hovered tile whenever the
   *  cursor crosses chrome (which every drag out of a docked panel does), an
   *  element with pointer capture retargets moves away from the canvas so no
   *  hover resolves at all, and hover only re-emits when the HEX CHANGES.
   *  Coordinates have none of those failure modes. */
  labelAtClient(clientX: number, clientY: number): string | null {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null
    const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
    if (!detector) return null
    const pixiGlobal = this.#clientToPixiGlobal(clientX, clientY)
    const local = this.#renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))
    const axial = detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat)
    return this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))?.label ?? null
  }

  /** Start a paint stroke at the press. Stages the tile under the cursor and
   *  fixes the stroke's intent: pressing an unpainted tile PAINTS (add), a
   *  painted one LIFTS (remove) — and a drag then applies that same intent to
   *  every tile it crosses, so you never toggle back and forth mid-stroke.
   *  A plain press with no drag is just a one-tile stroke. */
  #beginApplyStroke(e: PointerEvent): void {
    if (e.target !== this.#canvas) return
    const label = this.labelAtClient(e.clientX, e.clientY)
    // Empty hex: no stroke starts, so a press on empty canvas doesn't arm a
    // phantom drag.
    if (!label) return
    const add = !this.#tagApplyStaged.has(label)
    this.#applyStroke = { add }
    this.#applyStrokeTouched = new Set([label])
    this.emitEffect('tags:apply-paint', { label, add })
  }

  /** A brush cursor over the hive while the apply brush is armed — the "painter
   *  icon" that follows the pointer, telling you the tiles are a paint surface.
   *  Cleared back to default when the brush is put down. Set on the canvas
   *  element, so it only reads over the hive, not the panel. */
  #applyPaintCursor(): void {
    if (!this.#canvas) return
    this.#canvas.style.cursor = this.#tagApplyArmed ? TileOverlayDrone.#PAINT_CURSOR : ''
  }

  /** A small paintbrush, hotspot at the tip (bottom-left), as a CSS cursor. */
  static readonly #PAINT_CURSOR =
    "url('data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
      '<g fill="none" stroke="#0b0e14" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 4l4 4-9 9-4-4z"/><path d="M11 13l-4 4c-1.5 1.5-1.5 4 0 5.5"/><path d="M7 22.5c-2 .5-3.5 0-4.5-1"/>' +
      '</g>' +
      '<g fill="none" stroke="#6fbf94" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 4l4 4-9 9-4-4z"/><path d="M11 13l-4 4c-1.5 1.5-1.5 4 0 5.5"/><path d="M7 22.5c-2 .5-3.5 0-4.5-1"/>' +
      '</g></svg>',
    ) +
    "') 4 24, crosshair"

  /** Stand the hive down while the cursor sits on chrome above it: hide the
   *  icon overlay and tell every hover consumer nothing is hovered, ONCE per
   *  entry (the pointer keeps moving across the panel, and re-emitting each
   *  frame would thrash the renderer's hover ring). Forgetting #currentAxial
   *  is deliberate — coming back onto the canvas then reads as a fresh hex. */
  #suppressHover(): void {
    if (this.#hoverSuppressed) return
    this.#hoverSuppressed = true
    if (this.#overlay) this.#overlay.visible = false
    this.#currentAxial = null
    this.#currentIndex = undefined
    this.#clearHint()
    // "Nothing hovered" carries NO hex. Broadcasting a placeholder axial here
    // lied to every q/r consumer: (0,0) is the origin slot, so crossing any
    // chrome (docked panel, edit-actions cluster) lit the hover ring on
    // whatever tile happens to sit at index 0 and yanked the avatar-swarm
    // anchor there. Absence, not a sentinel.
    this.emitEffect('tile:hover', { label: null })
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
    // Every rebuild is a new GENERATION. A press captured against an older
    // generation must re-bind by label at click time (see #onClick) — the
    // same pixel position now describes a different layer's tile.
    this.#mapGeneration++
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
