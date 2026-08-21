// diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
import { Drone, EffectBus, consumePointerGesture, POINTER_GESTURE_END, type I18nProvider, I18N_IOC_KEY, type KeyMapLayer, ICON_PICK_REQUEST, type IconPickRequest, USAGE_IOC_KEY, type UsageRanker } from '@hypercomb/core'
import { Application, Container, Graphics, Point, Sprite, Text, TextStyle } from 'pixi.js'
import { HexIconButton } from './hex-icon-button.js'
import { HexOverlayMesh } from './hex-overlay.shader.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial, HexDetector } from '../../navigation/hex-detector.js'
import type { InputGate } from '../../navigation/input-gate.service.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'
import { hasDecorationKind, referenceTargetForLabel } from '../../commands/decoration-kind-index.js'
import { cellLocationSig } from '../../editor/tile-properties.js'
import { peerDivergesAt } from '../../sharing/peer-divergence.js'
import type { IconRegistryEntry } from './tile-actions.drone.js'
import { ICON_SPACING, ICON_Y, computeIconPositions } from './tile-actions.drone.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[]; branchLabels?: string[]; externalLabels?: string[]; swarmTakeLabels?: string[]; noImageLabels?: string[]; substrateLabels?: string[]; linkLabels?: string[]; hiddenLabels?: string[]; shadedLabels?: string[]; flatPaths?: Record<string, string[]>; filterBlocked?: string[] }

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

// ── The touch grammar ─────────────────────────────────────────────────
//
//   tap        GO TO THE TILE — enter its layer, ON THE RELEASE, never the
//              press. A childless tile enters its empty layer; there is no
//              such thing as a tile a tap cannot walk into.
//   hold still the quick-menu ring (quickmenu/quick-menu.input.ts, 380ms).
//              Let go without moving and the ring's zero-travel slot opens
//              THAT tile's own screen — picture, name, notes, actions. Flick
//              instead and it is the ordinary hive-wide ring.
//   hold+drag  move the tile (move/touch-move.input.ts)
//
// This drone therefore arms NO hold of its own on touch. It used to open the
// tile screen from a 340ms hold deliberately timed to beat the ring, which
// made two long presses on the same finger and left the ring unreachable over
// a tile. One long press, one owner: the ring, which carries the tile screen
// as its centre.
//
// Entry MUST stay on the release. A press that navigates on pointerdown
// consumes the pointer, and every hold watching it — drag-to-move, the
// quick-menu ring — dies with the consume before it can mature. That is why a
// long-press on a phone once did nothing at all: the view had already changed
// under the finger.

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
  /** PINNED to the label row's left edge, beside the name — outside the
   *  wrapping icon flow (see #layoutIconRow). Placement only. */
  labelRow?: boolean
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
  /** PIN to the label row's left edge, beside the name — outside the wrapping
   *  icon flow. Placement only; pairs with `featureRow` for the press seam. */
  labelRow?: boolean
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

// ── Two icon rows, wrapping, UNDER the name ──────────────────────
// The hovered tile's band keeps the NAME in its top row (hex-sdf.shader.ts) and
// the icons take the row(s) below it: fill a row, wrap at MAX_ROW_ICONS, done.
// No toggle, no reveal, no set to choose — the tile says what it is called and
// everything it offers, at once. The band grows a row per icon row, so a full
// wrap makes it three rows tall.
//
// Order is main → feature → danger, so `remove` lands last (bottom-right, the
// furthest point from where the pointer enters the band).
const MAX_ROW_ICONS = 5
/** Icon rows the band can hold under the name. */
const MAX_ICON_ROWS = 2
/** Centre-to-centre between the two rows — one band row each (0.15 × 32 ≈ 4.8,
 *  doubled). The block is centred on ICON_Y, so a single row sits dead centre
 *  and two rows straddle it. */
const ICON_ROW_PITCH = 10
/** The hex's horizontal half-extent (√3/2 × 32) — the bound every icon
 *  surface measures against. */
const HEX_INRADIUS = 27.7
/** How far apart the OUTERMOST icon centres in a row may sit: the hex's
 *  inradius less an edge margin, doubled. Mirrors computeIconPositions. The
 *  action row compresses to fit it; the arrange pool WRAPS at it. One
 *  constant, so the two surfaces cannot drift apart. */
const ICON_ROW_AVAILABLE = (HEX_INRADIUS - 3) * 2

// ── The label row, for icons PINNED to it (`labelRow`) ────────────
/** HALF-height of one band row in overlay-local units — the shader's
 *  `rowH = u_radiusPx * 0.15` (hex-sdf.shader.ts) at the hex radius of 32.
 *  The NAME's row centre sits (bandRows − 1) × this ABOVE the hex centre
 *  (the shader's nameShift), which is where a pinned icon must land. */
const NAME_ROW_HALF = 32 * 0.15
/** Centre x of the first icon pinned to the label row: hard against the band's
 *  LEFT edge, so it is LEFT OF THE NAME at every name length. The name is
 *  centred and the widest one reaches about ±19.3 here — the shader maps the
 *  quad's central half to the label cell (LABEL_BAND) and the bake fits text to
 *  92 % of it (sdf-glyph.ts) — so hugging the inradius keeps the two apart
 *  instead of letting a long name run under the handle. The icon's drawn ink is
 *  a good deal narrower than its box, so the edge reads as a margin. */
const LABEL_ROW_LEFT_X = Math.round(-(HEX_INRADIUS - DEFAULT_ICON_SIZE / 2))

// ── Arrange mode constants ────────────────────────────────────────

// The pool hangs UNDER the action rows. It no longer follows ICON_Y by hand:
// #layoutIconRow reports where the icon block actually ends and #positionPool
// hangs the pool off that, so a wrap moves the pool down with it instead of
// leaving it riding up inside the band's bottom row. POOL_Y_OFFSET is only the
// resting place used before any layout has run — with one icon row the derived
// offset lands on exactly this number, which is what it always was.
const POOL_Y_OFFSET = 16
const POOL_ICON_SIZE = 5        // pool icons scaled proportionally
const POOL_SPACING = 8         // tighter to match smaller pool icons
const POOL_BG_PADDING = 2
/** Centre-to-centre between wrapped pool rows. */
const POOL_ROW_PITCH = POOL_ICON_SIZE + 2
/** Clearance between the bottom of the icon block and the top of the pool. */
const POOL_GAP = 3
/** Pool icons per row — the same hex width the action rows respect. The pool
 *  used to lay every parked icon out on ONE line, so a handful of them ran off
 *  both sides of the tile, under a background drawn one row tall regardless. */
const POOL_MAX_ROW_ICONS = Math.max(1, Math.floor(ICON_ROW_AVAILABLE / POOL_SPACING) + 1)
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

// TILE VIEW PENDING. A view assigned to a tile may need to read its layer,
// decorations, notes, or media before it can cover the hexagon surface. Keep
// the acknowledgement compact and inside the tile the participant pressed:
// the hourglass says "your click landed" while the orbit says work is live.
const VIEW_PENDING_Y = -9
const VIEW_PENDING_BACKING_RADIUS = 7.5
const VIEW_PENDING_RING_RADIUS = 6.15
const VIEW_PENDING_COLOR = 0x9bcfe8
const VIEW_PENDING_SAND = 0xe6bf72

// ── Action hint constants ────────────────────────────────────────
// Cool-off between icon-set repair handshakes (see #requestReregister).
const REREGISTER_REPAIR_MS = 1500

const HINT_DELAY_MS = 110     // near-instant hover-to-hint — just long enough to filter a mouse glance crossing the icon
const HINT_Y_OFFSET = 17        // below the label band — moved up 7 with ICON_Y (absolute, does not follow on its own)
const HINT_FONT_SIZE = 4
const HINT_COLOR = 0xeaf0ff     // near-white — reads crisp against the dark hint pill
const HINT_EXPANDED_FONT_SIZE = 3.25
const HINT_MAX_WIDTH = 44
// Tooltip pill behind the hint text — turns the bare floating glyph into a
// clean, legible label that reads against any tile content.
const HINT_PILL_FILL = 0x0c0c1a
const HINT_PILL_ALPHA = 0.82
const HINT_PILL_PAD_X = 2.5
const HINT_PILL_PAD_Y = 2
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

  /** Last icon-overflow set reported, so the same overflow isn't warned once
   *  per rebuild. See #layoutIconRow. */
  static #lastOverflowReport = ''

  #app: Application | null = null
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null

  #overlay: Container | null = null
  #hexBg: HexOverlayMesh | null = null
  #actions: OverlayAction[] = []
  /** In-tile acknowledgement between `view:open-for-tile` and the assigned
   *  view entering owner-counted `view:active`. Independent of hover: moving
   *  the pointer away must not make an in-flight click look forgotten. */
  #viewPending: { view: string; label: string } | null = null
  #viewPendingIndicator: Container | null = null
  #viewPendingRing: Graphics | null = null
  #viewPendingHourglass: Graphics | null = null
  /** `view:open-for-tile` is a gesture but EffectBus retains last values.
   *  Suppress the subscription-time replay; only opens occurring after this
   *  overlay is listening are live work that needs acknowledgement. */
  #acceptViewOpen = false
  /** Rows currently laid out for the hovered tile: its name plus icon rows.
   *  Travels with tile:hover so navigation cannot pair a fresh hover with a
   *  stale global row count. */
  #bandRows = 1
  /** Y of the BOTTOM edge of the laid-out icon block, in overlay-local space.
   *  Written by #layoutIconRow every pass; the arrange pool hangs off it so it
   *  follows a wrap instead of being a constant copied from ICON_Y by hand.
   *  Starts at a single row's bottom, which is where the pool has always sat. */
  #iconBlockBottom = ICON_Y + DEFAULT_ICON_SIZE / 2
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
  /** Branches whose next view is not fully resident and pre-baked yet. */
  #shadedLabels = new Set<string>()
  /** Tag-flatten only: label → the match's ABSOLUTE lineage. A flattened tile
   *  can live anywhere, so entering it travels to this path rather than
   *  appending its name to wherever the view happens to be standing. */
  #flatPaths = new Map<string, string[]>()
  /** Tag-flatten only: matches whose subtree holds nothing tagged. Entering one
   *  would land on an empty filtered mesh, so the click is refused with a toast. */
  #filterBlocked = new Set<string>()
  #externalLabels = new Set<string>()
  /** External tiles whose next click is a TAKE, not a walk (hover-free
   *  swarm-shade set from the render — see #firstClickTakes). */
  #swarmTakeLabels = new Set<string>()
  /** Labels a first click already took at #wandTakenLocation — the second
   *  click walks in even before the fold's repaint lands. */
  #wandTakenLabels = new Set<string>()
  #wandTakenLocation = ''
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
  /** An armed HOLD-TO-ENTER press on a childless tile — or on ANY tile while
   *  the clipboard window is open, where the long press IS the walk-in: it
   *  opens that tile's layer if the pointer stays down and still for
   *  TILE_ENTER_HOLD_MS.
   *  `generation` pins the axial map the press was taken against — a render
   *  underneath the pointer invalidates the hold rather than entering a tile
   *  the user is no longer pressing. */
  #enterHold: {
    label: string
    pointerId: number
    origin: { x: number; y: number }
    generation: number
    timer: ReturnType<typeof setTimeout>
    /** Travel that cancels this hold. A finger rolls further than a mouse
     *  drifts, so the touch hold gets a wider box or it never survives. */
    jitter: number
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
  /** Sampling mode — every tap picks instead of entering. See `sample:mode`. */
  #sampling = false
  /** General select mode (SelectModeDrone) — the same takeover as sampling,
   *  with the swarm taken out of it. Kept as its OWN flag rather than folded
   *  into `#sampling`: the two arm from different surfaces and disarm on
   *  different events, and one flag would let either one's teardown hand
   *  navigation back while the other is still picking. */
  #selectMode = false
  /** Either picking mode is armed: a press must not navigate and the trailing
   *  tap is an ADD-TO-SET toggle. The one thing both modes mean. */
  get #picking(): boolean { return this.#sampling || this.#selectMode }
  /** The Pheromones window is open. While it is, hover pops that tile's
   *  keyword card and a dragged pheromone lands on the tile under the release.
   *  The hover band would sit on top of both, so it stands down for as long as
   *  the window is up — not just while the removal takeover is armed (closing
   *  the window disarms that anyway, via tags-viewer `close()`). */
  #pheromoneWindowOpen = false
  /** A pheromone removal is armed (TagRemovalDrone): tile clicks stage and
   *  unstage tiles instead of entering or opening them. Cleared when the
   *  removal commits or is cancelled. */
  #tagRemovalArmed = false
  /** The clipboard window is open — see the `clipboard:open` listener. */
  #clipboardArmed = false

  /** Swap mode proper: the window is open AND the gesture came from a
   *  POINTER. A finger has no ctrl to walk with, so on touch the clipboard
   *  window changes nothing about the hive — a tap still walks in, and the
   *  window's own rows stay the way tiles move there. */
  get #clipboardSwap(): boolean {
    return this.#clipboardArmed && !this.#lastPressWasTouch && !this.#mobileMode()
  }

  /** Pointer kind of the most recent press, set before every guard. */
  #lastPressWasTouch = false
  // NOTE: there is deliberately NO apply-brush takeover here any more. A
  // bouquet in hand does not hijack the hive — you keep walking (click,
  // enter, hold) exactly as always, and ctrl+click COLLECTS the tile into
  // the grouping. That gesture belongs to SelectionInputDrone, the canonical
  // owner of ctrl-as-add-to-set; the paint brush it replaced lived here.
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
  #hintIcon: Sprite | null = null
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
    'render:set-orientation', 'render:geometry-changed', 'render:set-hive-visible',
    'navigation:guard-start', 'navigation:guard-end',
    'mesh:public-changed', 'world:mode', 'editor:mode', 'selection:changed',
    'overlay:register-action', 'overlay:unregister-action', 'overlay:neon-color',
    'drop:dragging',
    'overlay:arrange-mode', 'overlay:pool-icons',
    'bee:disposed', 'genotype:set-visible', 'mobile:mode',
    'substrate:applied', 'cell:removed', 'tile:saved',
    'tile:public-changed',
    'behavior:enablement-changed',
    'keymap:invoke',
    'icon:edit-mode', 'icon:override-changed',
    'tags:view-state', 'tags:removal-pending',
    'clipboard:open',
    'sample:mode', 'select:mode', 'tile:enter-request',
    'view:open-for-tile', 'view:active',
  ]
  protected override emits = ['tile:hover', 'tile:action', 'tile:click', 'tile:navigate-in', 'tile:navigate-back', 'tile:navigate-reference', 'drop:target', 'overlay:icons-reordered', 'overlay:request-register', 'overlay:feature-press', 'overlay:band-rows', 'group:open', 'icon:pick-request', 'toast:show', 'diag:click', 'diag:click-capture', 'tags:removal-toggle', 'clipboard:take-items', 'swarm:wand']

  #dropDragging = false
  #dropGroupOnly = false

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

      // Deletion safety boundary (2026-07-29): while investigating tiles that
      // disappeared around the empty-page/history work, an accidental direct
      // Delete/Backspace could not be ruled out. Do NOT service
      // `selection.remove` from hover state here. RemoveQueenBee owns that
      // command only for an explicit selection; a single tile is removed only
      // through its trash icon in this overlay.

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
          // PROFILE-BLIND removal, deliberately. #registeredDescriptors is keyed
          // by NAME, so one entry backs the SAME name in every profile that
          // lists it (remove / files / invite / adopt / contact). Splicing only
          // `desc.profile` — the profile of the LAST-emitted descriptor — while
          // deleting the shared descriptor left every OTHER profile's order
          // naming an icon that no longer resolves. #rebuildActiveProfile skips
          // those silently (`if (!desc) continue`), so the band kept rendering
          // its label with a permanently shrunken icon row: icons that "cease to
          // show up" after drone churn and never come back without a reload.
          for (const order of this.#activeOrder.values()) {
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
        this.#positionViewPending()
      })

      this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
        this.#cellCount = payload.count
        this.#cellLabels = payload.labels
        this.#cellCoords = payload.coords
        this.#branchLabels = new Set(payload.branchLabels ?? [])
        this.#shadedLabels = new Set(payload.shadedLabels ?? [])
        this.#externalLabels = new Set(payload.externalLabels ?? [])
        this.#swarmTakeLabels = new Set(payload.swarmTakeLabels ?? [])
        this.#noImageLabels = new Set(payload.noImageLabels ?? [])
        this.#substrateLabels = new Set(payload.substrateLabels ?? [])
        this.#linkLabels = new Set(payload.linkLabels ?? [])
        this.#hiddenLabels = new Set(payload.hiddenLabels ?? [])
        this.#flatPaths = new Map(Object.entries(payload.flatPaths ?? {}))
        this.#filterBlocked = new Set(payload.filterBlocked ?? [])
        this.#rebuildOccupiedMap()
        // A same-layer repaint can shift slot assignments while the assigned
        // view is still reading. Follow the tile by label; if it genuinely
        // left this layer, there is no honest tile anchor left to show.
        if (this.#viewPending && !this.#cellLabels.includes(this.#viewPending.label)) {
          this.#clearViewPending()
        } else {
          this.#positionViewPending()
        }
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

      // Shade-only transitions must not masquerade as a completed level
      // render, so readiness has a narrow update separate from cell-count.
      this.onEffect<{ shadedLabels?: string[] }>('render:tile-readiness', (payload) => {
        this.#shadedLabels = new Set(payload.shadedLabels ?? [])
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

      // The global behavior roster flipped (behavior-enablement lens) — a
      // dormant behavior's icons must vanish (or wake) on the hovered tile
      // immediately; visibleWhen re-reads the lens on the repaint.
      this.onEffect('behavior:enablement-changed', () => {
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
        this.#positionViewPending()
      })

      this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
        this.#geo = geo
        const detector = this.resolve<HexDetector>('detector')
        if (detector) detector.spacing = geo.spacing
        this.#updateHexBg()
        if (this.#currentAxial) this.#positionOverlay(this.#currentAxial.q, this.#currentAxial.r)
        this.#positionViewPending()
      })

      // A tile-assigned takeover begins asynchronously: acknowledge it on the
      // hexagon surface immediately, before its first layer/resource await.
      // The target path is explicit, so this also works when Beehaviors opens
      // a visible tile without relying on whichever tile is still hovered.
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', (payload) => {
        if (!this.#acceptViewOpen) return
        const view = String(payload?.view ?? '').trim()
        const segments = Array.isArray(payload?.segments)
          ? payload!.segments!.map(s => String(s ?? '').trim()).filter(Boolean)
          : []
        const label = segments.at(-1) ?? ''
        if (!view || !label || !this.#cellLabels.includes(label)) {
          this.#clearViewPending()
          return
        }
        this.#viewPending = { view, label }
        this.#ensureViewPendingIndicator()
        this.#positionViewPending()
        if (this.#viewPendingIndicator) this.#viewPendingIndicator.visible = !this.#hiveHidden
        this.#canvas?.setAttribute('aria-busy', 'true')
      })
      this.#acceptViewOpen = true

      // View drones enter this owner-counted mode only after their surface is
      // mounted. That is the exact end of the otherwise silent pause.
      this.onEffect<{ active?: boolean }>('view:active', ({ active }) => {
        if (active === true) this.#clearViewPending()
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
        if (this.#hiveHidden) {
          if (this.#overlay) this.#overlay.visible = false
          if (this.#viewPendingIndicator) this.#viewPendingIndicator.visible = false
        }
        else this.#updateVisibility()
      })

      this.onEffect<{ active: boolean }>('touch:dragging', ({ active }) => {
        this.#touchDragging = active
        if (active && this.#overlay && !this.#arrangeMode) this.#overlay.visible = false
      })

      // `/mobile on|off` flips which shell this is mid-session. The band is
      // retired on the phone side, so the switch has to take effect at once
      // rather than on whatever pointer event happens to come next.
      this.onEffect<{ active?: boolean }>('mobile:mode', () => {
        this.#updateVisibility()
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

      // SAMPLING — picking tiles with a finger. A pointer says "pick this too"
      // by holding ctrl; a finger has no modifiers, so this mode says it
      // instead: while armed, a press does not navigate and the tap becomes a
      // toggle. It is the same takeover the selection and the staged-removal
      // already perform, so the gesture is one the participant knows. The mode
      // only has to survive until the FIRST pick — after that `#hasSelection`
      // suppresses navigation on its own — but it stays armed so unpicking the
      // last tile doesn't silently hand navigation back mid-gesture.
      this.onEffect<{ active: boolean }>('sample:mode', (payload) => {
        this.#sampling = !!payload?.active
        this.#updateVisibility()
      })

      // SELECT MODE — the same takeover, armed from the general picker
      // (SelectModeDrone) instead of the swarm's. On touch a press on a
      // branch tile navigates on POINTERDOWN and consumes the pointer, which
      // kills every hold timer watching it — so no long-press gesture could
      // ever build a selection on a phone. This mode is the way a finger says
      // what ctrl says on a pointer.
      this.onEffect<{ active: boolean }>('select:mode', (payload) => {
        this.#selectMode = !!payload?.active
        this.#updateVisibility()
      })

      // GO INSIDE, asked for from somewhere that is not a tile press — the
      // fullscreen tile view's own verb. Entering a tile carries readiness
      // gates, the phantom-segment latch and the deferred-entry queue, all of
      // which live in #navigateInto; a second caller re-uses them rather than
      // growing a second copy that drifts.
      this.onEffect<{ label?: unknown }>('tile:enter-request', (payload) => {
        const label = String(payload?.label ?? '')
        if (label) this.#navigateInto(label)
      })

      // The Pheromones window claims the hive for as long as it is open — see
      // #pheromoneWindowOpen. Nothing else here changes: clicks still route
      // through the armed-takeover checks below, which are narrower.
      this.onEffect<{ open?: boolean }>('tags:view-state', (payload) => {
        this.#pheromoneWindowOpen = payload?.open === true
        this.#updateVisibility()
        this.#updatePerTileVisibility()
      })

      // A staged pheromone removal takes over tile clicks: while it is armed,
      // clicking a tile stages/unstages it rather than entering or opening it.
      // Same shape as the selection takeover — presses stop navigating and the
      // click becomes a toggle — so the gesture is one the participant already
      // knows. (The overlay is already down — the window is open.)
      this.onEffect<{ active?: boolean }>('tags:removal-pending', (payload) => {
        this.#tagRemovalArmed = payload?.active === true
        this.#updateVisibility()
        this.#updatePerTileVisibility()
      })

      // ── THE SWAP ────────────────────────────────────────────────────
      // While the clipboard window is open the hive is in swap mode: a click
      // on a tile TAKES it into the window (and a click on a row in the
      // window puts it back on the page). Walking still has to work — that is
      // how you get to where you want to paste — so ctrl+click enters the
      // tile instead. Two readings of one click, told apart by the modifier,
      // and the same pair the window's own rows use.
      //
      // The window announces itself on `clipboard:open` (last-value replayed,
      // so a drone that registers late is current at once).
      this.onEffect<{ open?: boolean }>('clipboard:open', (payload) => {
        this.#clipboardArmed = payload?.open === true
      })

      // (No `tags:apply-pending` listener: a bouquet in hand no longer takes
      // the hive over. Collecting rides ctrl+click in SelectionInputDrone, and
      // show-cell still reads the staged set for the future-add marks.)

      this.onEffect<{ active: boolean; groupOnly?: boolean }>('drop:dragging', ({ active, groupOnly }) => {
        this.#dropDragging = active
        this.#dropGroupOnly = active && groupOnly === true
        // Entering the drag: suppress buttons (overlay is a bare drop target).
        // Leaving it: recover — the drop may have opened the editor or rebuilt
        // the map, clearing #currentAxial; #recoverHover re-derives so the menu
        // isn't stranded hidden. (No-ops while editing — the editor:mode close
        // handler runs the recovery once the panel dismisses.)
        if (active) { this.#updatePerTileVisibility(); this.#updateVisibility() }
        // The drag is over, so there is no landing place any more. Said
        // explicitly rather than left to the last move: `drop:target` replays
        // its last value to late subscribers, so a stale ring would otherwise
        // be the FIRST thing the indicator hears about on the next drag.
        else { this.#emitDropTarget(null); this.#recoverHover() }
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
    this.#clearViewPending()
    if (this.#viewPendingIndicator) {
      this.#viewPendingIndicator.destroy({ children: true })
      this.#viewPendingIndicator = null
      this.#viewPendingRing = null
      this.#viewPendingHourglass = null
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
        if (this.#viewPendingIndicator?.visible && this.#viewPendingRing) {
          // A slow orbit and very shallow breath keep it alive without making
          // the tiny mark busy or flashy.
          this.#viewPendingRing.rotation = this.#animTime * 1.65
          if (this.#viewPendingHourglass) {
            this.#viewPendingHourglass.alpha = 0.9 + Math.sin(this.#animTime * 2.4) * 0.07
          }
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
    // COALESCE. Boot emits a burst of profile-affecting effects — link
    // actions, meeting controls, meeting state, tile actions, tile images —
    // and each one used to rebuild the whole button profile SYNCHRONOUSLY:
    // 14 full teardown-and-recreate passes before the first frame, all
    // producing the identical result. Fold a burst into one rebuild at the end
    // of the current task; the profile is still current before anything can
    // paint or be clicked, because a microtask runs before the next frame.
    if (this.#rebuildQueued) return
    this.#rebuildQueued = true
    queueMicrotask(() => {
      this.#rebuildQueued = false
      if (this.#arrangeMode) { this.#arrangeRebuildPending = true; return }
      this.#rebuildActiveProfile()
    })
  }
  #rebuildQueued = false

  /** Ask every icon provider to re-emit its descriptors, because the active
   *  order named an icon we can no longer resolve. Rate-limited: a provider
   *  that is genuinely gone (its bee was toggled off) would otherwise leave a
   *  permanent hole and turn this into a rebuild loop. One repair attempt per
   *  window is enough to recover from churn without spinning. */
  #requestReregister(): void {
    if (this.#reregisterQueued || this.#arrangeMode) return
    this.#reregisterQueued = true
    setTimeout(() => {
      this.#reregisterQueued = false
      if (!this.#arrangeMode) this.emitEffect('overlay:request-register', {})
    }, REREGISTER_REPAIR_MS)
  }
  #reregisterQueued = false

  #updateHexBg(): void {
    this.#hexBg?.update(this.#geo.circumRadiusPx, this.#flat)
  }

  /** Build the pending mark once. It is deliberately its own container rather
   *  than part of #overlay: the hover menu comes and goes with the pointer,
   *  while an accepted click remains acknowledged until its view mounts. */
  #ensureViewPendingIndicator(): void {
    if (!this.#renderContainer || this.#viewPendingIndicator) return

    const indicator = new Container()
    indicator.visible = false
    indicator.zIndex = 10001

    // A tiny six-sided glass plaque belongs to the hive geometry and occupies
    // far less visual mass than the old circular badge.
    const backing = new Graphics()
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3
      const x = Math.cos(a) * VIEW_PENDING_BACKING_RADIUS
      const y = Math.sin(a) * VIEW_PENDING_BACKING_RADIUS
      if (i === 0) backing.moveTo(x, y)
      else backing.lineTo(x, y)
    }
    backing.closePath()
    backing.fill({ color: 0x0b1520, alpha: 0.66 })
    backing.stroke({ width: 0.55, color: VIEW_PENDING_COLOR, alpha: 0.34, join: 'round' })
    indicator.addChild(backing)

    const ring = new Graphics()
    ring.arc(0, 0, VIEW_PENDING_RING_RADIUS, -0.9, 0.85)
    ring.stroke({ width: 0.85, color: VIEW_PENDING_COLOR, alpha: 0.88, cap: 'round' })
    indicator.addChild(ring)

    const glass = new Graphics()
    // Fine frame plus curved glass sides: enough silhouette to read instantly,
    // without the heavy crossed lines of the first pass.
    glass.moveTo(-2.65, -3.5)
    glass.lineTo(2.65, -3.5)
    glass.moveTo(-2.65, 3.5)
    glass.lineTo(2.65, 3.5)
    glass.moveTo(-2.15, -2.9)
    glass.bezierCurveTo(-2.05, -1.45, -0.55, -0.65, 0, 0)
    glass.bezierCurveTo(-0.55, 0.65, -2.05, 1.45, -2.15, 2.9)
    glass.moveTo(2.15, -2.9)
    glass.bezierCurveTo(2.05, -1.45, 0.55, -0.65, 0, 0)
    glass.bezierCurveTo(0.55, 0.65, 2.05, 1.45, 2.15, 2.9)
    glass.stroke({ width: 0.78, color: 0xeaf6fb, alpha: 0.94, cap: 'round', join: 'round' })
    // A restrained warm sand bed and falling thread.
    glass.moveTo(-1.7, 2.75)
    glass.lineTo(1.7, 2.75)
    glass.lineTo(0, 1.05)
    glass.closePath()
    glass.fill({ color: VIEW_PENDING_SAND, alpha: 0.92 })
    glass.moveTo(0, -0.2)
    glass.lineTo(0, 1.35)
    glass.stroke({ width: 0.62, color: VIEW_PENDING_SAND, alpha: 0.9, cap: 'round' })
    indicator.addChild(glass)

    this.#renderContainer.addChild(indicator)
    this.#renderContainer.sortableChildren = true
    this.#viewPendingIndicator = indicator
    this.#viewPendingRing = ring
    this.#viewPendingHourglass = glass
  }

  #positionViewPending(): void {
    if (!this.#viewPending || !this.#viewPendingIndicator) return
    const index = this.#cellLabels.indexOf(this.#viewPending.label)
    const coord = index >= 0 ? this.#cellCoords[index] : undefined
    if (!coord) {
      this.#viewPendingIndicator.visible = false
      return
    }
    const px = this.#axialToPixel(coord.q, coord.r)
    this.#viewPendingIndicator.position.set(
      px.x + this.#meshOffset.x,
      px.y + this.#meshOffset.y + VIEW_PENDING_Y,
    )
  }

  #clearViewPending(): void {
    this.#viewPending = null
    if (this.#viewPendingIndicator) this.#viewPendingIndicator.visible = false
    if (this.#canvas?.getAttribute('aria-busy') === 'true') {
      this.#canvas.removeAttribute('aria-busy')
    }
  }

  /** Sync read of "does this cell have notes at the current lineage?"
   *  Hits NotesService's warm cache — no localStorage parse, no async.
   *  Returns false until NotesService is loaded; the next notes:changed
   *  re-runs #updatePerTileVisibility which re-derives. */
  #hasNotesFor(cellLabel: string): boolean {
    const notesService = get<{ notesFor: (label: string) => unknown[] }>('@diamondcoreprocessor.com/NotesService')
    return (notesService?.notesFor(cellLabel)?.length ?? 0) > 0
  }


  // ── The tile's affordances, for a surface that is not the band ─────
  //
  // The band is a hover surface and a phone has no hover, so on mobile it is
  // retired (see #updateVisibility) and the tile's own screen carries what it
  // carried. That screen must show the SAME set — every provider bee registers
  // here and nowhere else — so it asks for it by label rather than keeping a
  // second, drifting list of what a tile can do.
  //
  // By LABEL, not by hover: the caller is asking about a tile it is showing
  // full-screen, which is by definition not the one under the pointer.

  /** The per-tile context `visibleWhen`/`tintWhen` are written against, built
   *  for an arbitrary label. Null when the label is not on this layer. */
  #tileContextFor(label: string): OverlayTileContext | null {
    const index = this.#cellLabels.indexOf(label)
    if (index < 0) return null
    const coord = this.#cellCoords[index]
    return {
      label,
      q: coord?.q ?? 0,
      r: coord?.r ?? 0,
      index,
      noImage: this.#noImageLabels.has(label),
      hasSubstrate: this.#substrateLabels.has(label),
      isBranch: this.#branchLabels.has(label),
      hasLink: this.#linkLabels.has(label),
      isHidden: this.#hiddenLabels.has(label),
      hasNotes: this.#hasNotesFor(label),
    }
  }

  /**
   * Every affordance this tile actually carries, in band order (main, then
   * feature, then danger — `remove` last), already filtered by each one's own
   * `visibleWhen`. NOT capped: the band stops at two rows because a hexagon is
   * only so tall, which is a constraint of that surface and not of the tile.
   */
  public actionsForTile(label: string): OverlayActionDescriptor[] {
    const ctx = this.#tileContextFor(label)
    if (!ctx) return []
    // This tile's profile, not the hovered tile's — a peer tile's adopt/hide
    // set is decided by the tile being asked about.
    const external = this.#externalLabels.has(label)
    const profile: OverlayProfileKey = this.#worldMode
      ? 'world'
      : external ? 'public-external'
      : this.#meshPublic ? 'public-own' : 'private'

    const seen = new Set<string>()
    const out: OverlayActionDescriptor[] = []
    for (const name of this.#activeOrder.get(profile) ?? []) {
      if (seen.has(name)) continue
      seen.add(name)
      const desc = this.#registeredDescriptors.get(name)
      if (!desc) continue
      if (desc.genotype && this.#genotypeVisible.get(desc.genotype) === false) continue
      if (desc.visibleWhen && !desc.visibleWhen(ctx)) continue
      out.push(desc)
    }
    const rank = (d: OverlayActionDescriptor): number =>
      d.name === 'remove' ? 3 : d.dangerRow ? 2 : d.featureRow ? 1 : 0
    return out.sort((a, b) => rank(a) - rank(b))
  }

  /** Run one of them. Goes through here rather than through the caller so the
   *  `tile:action` payload — and the one action that is not a plain emit — has
   *  exactly one definition. */
  public invokeActionForTile(name: string, label: string): void {
    const ctx = this.#tileContextFor(label)
    if (!ctx) return
    if (name === 'break-apart') {
      this.playShatterAnimation(ctx.q, ctx.r, label)
      return
    }
    this.emitEffect('tile:action', { action: name, q: ctx.q, r: ctx.r, index: ctx.index, label })
  }

  /** The tile's current tint for an affordance, or null for the default —
   *  the "this tile has notes" kind of signal the band shows by colouring. */
  public actionTintForTile(desc: OverlayActionDescriptor, label: string): number | null {
    const ctx = this.#tileContextFor(label)
    if (!ctx || !desc.tintWhen) return null
    return desc.tintWhen(ctx) ?? null
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
    let unresolved = false
    for (const name of order) {
      if (seen.has(name)) continue
      seen.add(name)
      const desc = this.#registeredDescriptors.get(name)
      // An ordered name with no descriptor is a HOLE, not a preference. Dropping
      // it silently is how the band ends up showing its label over a short (or
      // empty) icon row with nothing to explain it. Note it and ask the
      // providers to re-emit — the register handshake is additive and
      // idempotent, so a repair costs one rebuild and restores the icon.
      if (!desc) { unresolved = true; continue }
      if (desc.genotype && this.#genotypeVisible.get(desc.genotype) === false) continue
      descs.push(desc)
    }
    if (unresolved) this.#requestReregister()
    descs.sort((a, b) => (a.name === 'remove' ? 1 : 0) - (b.name === 'remove' ? 1 : 0))

    for (const desc of descs) {
      const btn = new HexIconButton({
        // Feature icons are the showcase — bigger glyph, bigger hit area.
        size: DEFAULT_ICON_SIZE,
        hoverTint: desc.hoverTint,
      })
      // Visibility belongs to the hovered tile, not the profile. Keep a newly
      // built icon out of the scene until the complete per-tile set has been
      // resolved below; otherwise the profile's full set briefly establishes
      // one band height before visibleWhen narrows it to the real row count.
      btn.visible = false
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
        labelRow: desc.labelRow,
        visibleWhen: desc.visibleWhen,
        tintWhen: desc.tintWhen,
        labelKey: desc.labelKey,
        descriptionKey: desc.descriptionKey,
        backingKey: desc.backingKey,
      })
    }

    // Resolve the complete initial icon set once. That single pass establishes
    // the band's starting row count before any icon becomes visible.
    this.#updatePerTileVisibility()
  }

  // ── Icon layout: fill a row, wrap, stop at two ─────────────────────
  // `base` = icons that passed their per-tile visibleWhen (set upstream by
  // #updatePerTileVisibility). Ordered main → feature → danger so `remove`
  // lands last, then chunked at MAX_ROW_ICONS. The rows are centred as a BLOCK
  // on ICON_Y — one half-row below the hex centre, because the name owns the
  // band's top row — so one icon row lands on the band's second row and two
  // straddle ICON_Y, one per band row. Horizontally every row shares the first
  // row's left edge (see below), so a wrap reads as one left-aligned block.

  #layoutIconRow(): void {
    const base = this.#actions.filter(a => a.button.visible)
    // Label-row icons are PINNED beside the name (placed at the bottom of this
    // pass), outside the wrapping flow — they ride the row the band always
    // has, so they never add a row or displace the centred block.
    const pinned = base.filter(a => a.labelRow)
    const flowing = base.filter(a => !a.labelRow)
    const ordered = [
      ...flowing.filter(a => !a.featureRow && !a.dangerRow),
      ...flowing.filter(a => a.featureRow),
      ...flowing.filter(a => a.dangerRow),
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
      // Say it ONCE per distinct set. The same overflow re-reported on every
      // rebuild buried the console (and each warn captures a stack, which the
      // devtools then holds), without adding a single new fact.
      const key = dropped.map(a => a.name).join(', ')
      if (key !== TileOverlayDrone.#lastOverflowReport) {
        TileOverlayDrone.#lastOverflowReport = key
        console.warn(`[tile-overlay] ${dropped.length} icon(s) past the ${MAX_ICON_ROWS}-row band, not shown:`, key)
      }
    }

    // Only what is laid out is shown, so hit-testing matches what is drawn.
    // Pinned icons are laid out too (below) — they stay.
    const inSeq = new Set<OverlayAction>([...rows.flat(), ...pinned])
    for (const a of this.#actions) a.button.visible = inSeq.has(a)

    // Tell the renderer how tall to draw this tile's band: the NAME's own row
    // plus one per icon row. A tile with no icons keeps the text's height and
    // does not grow at all. Emitted every layout so it tracks per-tile
    // visibility.
    this.#bandRows = 1 + rows.length
    // The band's OWNER — the tile whose menu is on screen right now, or null
    // when none is. This is the overlay stating the whole visual fact, not just
    // a number: THIS tile is showing THESE rows. The renderer takes the hovered
    // tile from it as well as the height, so the two cannot describe different
    // tiles. Gated on the overlay actually being visible, so a layout run while
    // the band is stood down (editing, selection, a takeover) reads as "nobody".
    const bandLabel = this.#overlay?.visible && this.#currentAxial
      ? this.#occupiedByAxial.get(
          TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r),
        )?.label ?? null
      : null
    this.emitEffect('overlay:band-rows', { rows: this.#bandRows, label: bandLabel })

    // Pin label-row icons on the NAME's row, left-aligned. The name's row
    // centre sits (bandRows − 1) × NAME_ROW_HALF above the hex centre — the
    // shader's nameShift — so the pin lands beside the name at every band
    // height, including the single-row band (no icon rows: y = 0).
    const nameRowY = Math.round(-(this.#bandRows - 1) * NAME_ROW_HALF)
    pinned.forEach((a, i) =>
      a.button.position.set(LABEL_ROW_LEFT_X + i * ICON_SPACING, nameRowY))

    if (rows.length === 0) {
      // No icons: leave the pool where a single row would have left it, so an
      // empty menu does not jump the pool around.
      this.#iconBlockBottom = ICON_Y + DEFAULT_ICON_SIZE / 2
      this.#positionPool()
      return
    }

    // ONE origin for every row: the FIRST row is centred, and each row after it
    // starts at that same x and reads left to right. The lefts line up on a
    // wrap instead of a short second row floating centred under a full first
    // one. Row 0 is always the widest (chunking fills it before wrapping), so
    // centring on it also centres the block — and a lone row is centred, which
    // is the same rule, not a special case.
    // Hex horizontal bound — the row compresses to fit.
    let spacing = ICON_SPACING
    if (rows[0].length > 1 && (rows[0].length - 1) * spacing > ICON_ROW_AVAILABLE) {
      spacing = ICON_ROW_AVAILABLE / (rows[0].length - 1)
    }
    const startX = Math.round(-(rows[0].length - 1) * spacing / 2)
    const top = ICON_Y - (rows.length - 1) * ICON_ROW_PITCH / 2
    let lastRowY = top
    rows.forEach((items, r) => {
      const y = Math.round(top + r * ICON_ROW_PITCH)
      lastRowY = y
      items.forEach((a, j) => a.button.position.set(Math.round(startX + j * spacing), y))
    })

    // Where the drawn block ACTUALLY ends — the pool hangs off this.
    this.#iconBlockBottom = lastRowY + DEFAULT_ICON_SIZE / 2
    this.#positionPool()
  }

  /** Hang the arrange pool under the icon block: its background's TOP edge —
   *  padding included — clears the lowest icon row by POOL_GAP. A wrap pushes
   *  the pool down instead of letting it overlap the band it sits below. */
  #positionPool(): void {
    if (!this.#poolContainer) return
    this.#poolContainer.position.y =
      this.#iconBlockBottom + POOL_GAP + POOL_BG_PADDING + POOL_ICON_SIZE / 2
  }

  /** Top edge of the pool background in overlay-local space — the boundary
   *  between "dropped on the action rows" and "dropped in the pool". Derived,
   *  so both drop hit-tests follow the pool wherever the layout put it. */
  #poolTop(): number {
    return (this.#poolContainer?.position.y ?? POOL_Y_OFFSET) - POOL_ICON_SIZE / 2 - POOL_BG_PADDING
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
    if (!this.#currentAxial) {
      this.#hideAllButtons()
      this.#layoutIconRow()
      return
    }

    // during image drag-over, hide all action buttons — overlay is just a drop target
    if (this.#dropDragging) {
      this.#hideAllButtons()
      this.#layoutIconRow()
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
      this.#layoutIconRow()
      return
    }

    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r))
    if (!entry) {
      this.#hideAllButtons()
      this.#layoutIconRow()
      return
    }

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

    // Arrange shows EVERY icon the profile carries, not just the ones this tile
    // passes. Go through the one visibility+layout pass — its arrange branch
    // makes them all visible AND lays them out — so the extra icons wrap into
    // rows and the band is told how tall to draw. Flipping `visible` by hand
    // left them at the positions of the smaller per-tile set, spilling out of a
    // background still sized for it.
    this.#updatePerTileVisibility()

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

    // WRAP, like the action rows do. A pool row is bounded by the same hex
    // width, and rows grow DOWNWARD from the container origin so the pool's top
    // edge — the boundary both drop hit-tests read — stays put however many
    // icons are parked in it.
    const container = this.#poolContainer
    const poolRows: IconRegistryEntry[][] = []
    for (let i = 0; i < entries.length; i += POOL_MAX_ROW_ICONS) {
      poolRows.push(entries.slice(i, i + POOL_MAX_ROW_ICONS))
    }

    // Every row shares the FIRST row's left edge, so a wrap reads as one
    // left-aligned block. Row 0 is always the widest (chunking fills it before
    // wrapping), so centring on it centres the block — and a lone row comes out
    // centred, which is the same rule rather than a special case.
    const widest = poolRows[0].length
    const startX = -(widest - 1) * POOL_SPACING / 2
    poolRows.forEach((row, r) => {
      const y = r * POOL_ROW_PITCH
      row.forEach((entry, i) => {
        const btn = new HexIconButton({
          size: POOL_ICON_SIZE,
          hoverTint: entry.hoverTint,
        })
        btn.position.set(startX + i * POOL_SPACING, y)
        btn.alpha = 0.5
        container.addChild(btn)
        void btn.load(entry.svgMarkup)

        this.#poolIcons.push({ name: entry.name, profile: entry.profile, button: btn })
      })
    })

    // Background sized to the rows it HOLDS. Drawn one row tall whatever the
    // pool contained, it left every wrapped row sitting outside its own
    // backing — icons floating on the tile with nothing behind them.
    this.#poolBackground.clear()
    const halfW = ((widest - 1) * POOL_SPACING) / 2 + POOL_ICON_SIZE / 2 + POOL_BG_PADDING
    const halfH = POOL_ICON_SIZE / 2 + POOL_BG_PADDING
    const height = (poolRows.length - 1) * POOL_ROW_PITCH + halfH * 2
    this.#poolBackground.roundRect(-halfW, -halfH, halfW * 2, height, 1.5)
    this.#poolBackground.fill({ color: POOL_BG_COLOR, alpha: POOL_BG_ALPHA })

    this.#positionPool()
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
      if (btnGlobalY < this.#poolTop()) {
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

    // Check if in the active icon row area (above the pool, around ICON_Y)
    if (centerY < this.#poolTop() && centerY > ICON_Y - 10 && centerY < ICON_Y + 15) {
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

    // #actions carries the DRAWN sequence, so it has to follow the swap before
    // anything is laid out again. Stable sort, so icons the order does not name
    // keep their relative places.
    const rank = new Map(order.map((name, i) => [name, i]))
    this.#actions.sort((a, b) =>
      (rank.get(a.name) ?? order.length) - (rank.get(b.name) ?? order.length))

    // Re-lay out through the ONE layout that knows about wrapping. Placing
    // these by hand put every icon back on a single line, so a swap silently
    // un-wrapped a two-row menu — and left the band drawn for rows that were no
    // longer there.
    this.#layoutIconRow()

    // Keep the registered descriptors' recorded positions in step with where
    // the buttons actually ended up.
    for (const action of this.#actions) {
      const desc = this.#registeredDescriptors.get(action.name)
      if (!desc) continue
      desc.x = action.button.position.x
      desc.y = action.button.position.y
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
        // Row placement survives an arrange re-register — dropping these sent
        // feature icons back into the main flow (and unpinned label-row ones).
        dangerRow: entry.dangerRow,
        featureRow: entry.featureRow,
        labelRow: entry.labelRow,
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
    // consumePointerGesture swallows pointerup at window capture, before this
    // drone's document listener can release #consumedPointerId. Hear the
    // consumer's bookkeeping-only end signal or the stale latch will discard
    // the next ordinary tile click after a press-triggered navigation.
    window.addEventListener(POINTER_GESTURE_END, this.#onConsumedGestureEnd as EventListener)
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

      // tell ImageDropDrone (and the landing indicator) what's under the cursor
      this.#emitDropTarget(axial)
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
    if (e.target !== this.#canvas) {
      this.#suppressHover()
      // A drag that wanders onto chrome has NO landing place, and the indicator
      // must say so rather than freeze on the last hex it crossed — a stuck ring
      // reads as "release here and it lands there", which is a lie the moment
      // the release happens over the panel (a cancelled drag).
      if (this.#dropDragging) this.#emitDropTarget(null)
      return
    }
    this.#hoverSuppressed = false

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
      // A POINTER drag (a row dragged out of a docked index) reports its
      // landing place here. `#onDragOverTrack` covers the HTML5 file/image
      // drag, which is a different event stream entirely — pointermove does
      // not fire during a native drag, and DragEvents never fire during a
      // pointer drag, so BOTH paths have to emit or half the drags in the app
      // are invisible to every drop consumer.
      if (this.#dropDragging) this.#emitDropTarget(axial)
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
        this.emitEffect('tile:hover', {
          q: axial.q,
          r: axial.r,
          label: entry?.label ?? null,
          bandRows: 1,
        })
        return
      }

      this.#positionOverlay(axial.q, axial.r)
      this.#updateCellLabel(axial.q, axial.r)
      this.#updatePerTileVisibility()
      // Carry the hovered tile's label so consumers (avatar swarm, contact
      // hover panel) can react without re-deriving from the occupied map.
      this.emitEffect('tile:hover', {
        q: axial.q,
        r: axial.r,
        label: entry?.label ?? null,
        bandRows: entry ? this.#bandRows : 1,
      })
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

    // An icon has one explanation, so show it as one complete card from the
    // start. A label-only phase made the same hint look like two separate
    // popups as it expanded.
    this.#expandHint()
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
        align: 'left',
        lineHeight: 4.25,
        wordWrap: true,
        wordWrapWidth: HINT_MAX_WIDTH,
      }),
      resolution: HINT_TEXT_RESOLUTION,
    })
    this.#hintDescriptionText.anchor.set(0, 0)

    // The expanded hint is one panel: the operation leads at the start and
    // its explanation flows directly underneath. Previously each line owned
    // a separate pill, which read as two overlapping popups.
    const headerGap = 1.5
    const rowGap = 1.25
    const iconSize = 4.5
    const titleHeight = this.#hintText?.height ?? HINT_FONT_SIZE
    const textWidth = Math.max(
      this.#hintText?.width ?? 0,
      this.#hintDescriptionText.width,
    )
    const contentWidth = iconSize + headerGap + textWidth
    const left = -contentWidth / 2
    const textLeft = left + iconSize + headerGap

    const sourceIcon = action.button.children.find(child => child instanceof Sprite)
    if (sourceIcon instanceof Sprite) {
      this.#hintIcon = new Sprite(sourceIcon.texture)
      this.#hintIcon.anchor.set(0.5)
      this.#hintIcon.width = iconSize
      this.#hintIcon.height = iconSize
      this.#hintIcon.tint = sourceIcon.tint
      this.#hintIcon.alpha = 0.9
      this.#hintIcon.position.set(left + iconSize / 2, HINT_Y_OFFSET + titleHeight / 2)
    }
    if (this.#hintText) {
      this.#hintText.anchor.set(0, 0)
      this.#hintText.position.set(textLeft, HINT_Y_OFFSET)
    }
    const yBelow = HINT_Y_OFFSET + titleHeight + rowGap
    this.#hintDescriptionText.position.set(textLeft, yBelow)
    this.#hintDescriptionText.alpha = 0.72

    if (this.#hintBg) {
      this.#hintBg.parent?.removeChild(this.#hintBg)
      this.#hintBg.destroy()
    }
    const panelWidth = contentWidth + HINT_PILL_PAD_X * 2
    const panelHeight = titleHeight + rowGap + this.#hintDescriptionText.height + HINT_PILL_PAD_Y * 2
    this.#hintBg = new Graphics()
    this.#hintBg.roundRect(
      -panelWidth / 2,
      HINT_Y_OFFSET - HINT_PILL_PAD_Y,
      panelWidth,
      panelHeight,
      HINT_PILL_RADIUS,
    )
    this.#hintBg.fill({ color: HINT_PILL_FILL, alpha: HINT_PILL_ALPHA })
    this.#overlay.addChildAt(this.#hintBg, this.#overlay.getChildIndex(this.#hintText!))
    if (this.#hintIcon) this.#overlay.addChild(this.#hintIcon)
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
    if (this.#hintIcon) {
      this.#hintIcon.parent?.removeChild(this.#hintIcon)
      this.#hintIcon.destroy()
      this.#hintIcon = null
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
    // What KIND of pointer is pressing, recorded before any guard can return.
    // (#pressWasTouch is set much further down, past a dozen early returns, so
    // it is only trustworthy on the path that reaches it — swap mode has to
    // ask on paths that don't, e.g. a ctrl press or a press with a live
    // selection.)
    this.#lastPressWasTouch = e.pointerType === 'touch'
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
    // Picking: the press must not navigate — a tile being picked is usually a
    // BRANCH, so without this the first pick would walk into it instead of
    // picking it. The trailing click toggles it (see #onClick).
    if (this.#picking) return
    // Armed removal: the press must not navigate — the trailing click stages
    // the tile instead (see #onClick).
    if (this.#tagRemovalArmed) return
    // A bouquet in hand is NOT a takeover: the press navigates as always.
    // Collecting is ctrl+click, owned by SelectionInputDrone.
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
    // The synthesized click carries no pointerType — record the real input kind
    // here so the leaf branch can tell a tap from a mouse click.
    this.#pressWasTouch = e.pointerType === 'touch'

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

    // ── SWAP MODE: the press decides nothing — except arming the hold ───
    // A mouse press on a branch tile normally walks straight in, right here,
    // before any click is dispatched. While the clipboard window is open the
    // decision belongs to the CLICK instead (plain = take it into the window,
    // ctrl = copy it in), so the press lets go of the instant walk and the
    // launcher open. Walking in is the LONG PRESS — the same hold-to-enter
    // gesture as everywhere else on the hive, armed here for branch and leaf
    // alike (a short release cancels it and falls through to the take).
    // Placed AFTER the overlay action-button branch so Edit / Note / the
    // feature row keep working with the window open. Touch is untouched
    // (see #clipboardSwap).
    if (this.#clipboardSwap) { this.#beginEnterHold(e, entry.label); return }

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

    // A FINGER on a branch tile: do nothing on the press. Entry happens on the
    // release (#onClick), the long press belongs to the quick-menu ring, and
    // the drag belongs to touch-move — none of which survive this drone
    // consuming the pointer here. See the touch grammar at the top.
    if (e.pointerType === 'touch') {
      this.#cancelEnterHold()
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
      if (this.#tagRemovalArmed) return
      this.#consumedPointerId = pointerId
      consumePointerGesture(pointerId)
      this.#pressCapture = null
      this.emitEffect('tile:enter-hold', { label })
      this.#navigateInto(label)
    }, TILE_ENTER_HOLD_MS)
    this.#enterHold = { label, pointerId, origin: { x: e.clientX, y: e.clientY }, generation, timer, jitter: TILE_ENTER_HOLD_JITTER_PX }
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
    if (Math.abs(e.clientX - hold.origin.x) > hold.jitter
      || Math.abs(e.clientY - hold.origin.y) > hold.jitter) this.#cancelEnterHold()
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
      // Swap mode: ctrl is the COPY. Same take gesture as the plain click,
      // but the tile STAYS on the page — it lands in the window as a sig
      // reference without the cut commit (ctrl+drag-copies-in-Explorer
      // convention). It outranks the selection toggle for as long as the
      // clipboard window is open. Walking in is the long press, the same
      // hold-to-enter as everywhere else (armed in #onPointerDown).
      if (this.#clipboardSwap) {
        this.#pressCapture = null
        this.emitEffect('clipboard:take-items', { labels: [entry.label], copy: true })
        return
      }
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

    // Selection mode must resolve every tap from the tap itself. Touch devices
    // do not reliably send the pointer-move/hover events that maintain
    // #currentAxial, so reusing that state can make a second tap toggle the
    // first tile back off instead of adding the tile under the finger.
    // A live selection normally turns every click into a selection change.
    // Swap mode outranks it — the window is open, so a click is a take. An
    // explicit PICKING mode still wins over both: it is a deliberate
    // build-a-set session with its own keep verb.
    if ((this.#hasSelection && !this.#clipboardSwap) || this.#picking) {
      const detector = this.resolve<{ pixelToAxial(px: number, py: number, flat?: boolean): Axial }>('detector')
      if (!detector) { diag('selection-no-detector'); return }
      const tapGlobal = this.#clientToPixiGlobal(e.clientX, e.clientY)
      const tapLocal = this.#renderContainer.toLocal(new Point(tapGlobal.x, tapGlobal.y))
      const tapAxial = detector.pixelToAxial(
        tapLocal.x - this.#meshOffset.x,
        tapLocal.y - this.#meshOffset.y,
        this.#flat,
      )
      const tapped = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(tapAxial.q, tapAxial.r))
      if (!tapped?.label || tapped.index >= this.#cellCount) { diag('selection-empty-hex'); return }
      this.emitEffect('tile:click', {
        q: tapAxial.q,
        r: tapAxial.r,
        label: tapped.label,
        index: tapped.index,
        ctrlKey: false,
        metaKey: false,
        // While picking, say the ADD-TO-SET intent explicitly. A plain click
        // REPLACES the selection, so without this every pick would drop the
        // one before it and the set could never grow past one.
        toggle: this.#picking,
      })
      return
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

    // ── SWAP MODE: a plain click TAKES the tile ─────────────────────────
    // The window is open, the overlay's action buttons have had their chance
    // above, and no modifier is held: this tile leaves the page and lands in
    // the clipboard window. ClipboardWorker cuts it and APPENDS, so clicking
    // one tile after another fills the window. (Ctrl already copied, higher
    // up; the long press walks in.) Branch or leaf makes no difference — a
    // take carries the subtree.
    if (this.#clipboardSwap) {
      this.emitEffect('clipboard:take-items', { labels: [entry.label] })
      return
    }

    if (
      this.#branchLabels.has(entry.label)
      || referenceTargetForLabel(entry.label) !== null
      || this.#externalLabels.has(entry.label)
    ) {
      // A branch (enter its children) OR a reference tile (portal to its
      // target). #navigateInto routes references to their pointer.
      //
      // A PEER TILE ALWAYS ROUTES HERE, branch dot or not. Structure travels
      // only by walking (MAX_PUBLISH_DEPTH=0), so what is inside somebody
      // else's tile is not on the wire until you step in and the drill serves
      // that level — "no children" here means "not asked yet", never "empty".
      // Inside, the first click on a shaded tile is the take and the second
      // is the walk in (#firstClickTakes) — refusing the route would be
      // refusing the one gesture that adds the tile.
      this.#navigateInto(entry.label)
    } else {
      // ── LEAF TILE ───────────────────────────────────────────
      // ON TOUCH, A TAP GOES TO THE TILE. Childless or not: #navigateInto
      // opens its (empty) layer, the same choke point hold-to-enter uses on
      // desktop — so one gesture means one thing everywhere on the hive and no
      // tile is a dead end. The tile's own SCREEN is a long press away (the
      // ring's centre); it is no longer what a tap produces.
      //
      // A LINK tile is the exception, and it is the tile's own doing: its
      // content is somewhere else, so `open` — which LinkOpenWorker consumes to
      // route to the viewer or the browser — is what "go to the tile" means
      // there. Walking into an empty layer instead would be walking past it.
      //
      // Mouse/pen keep the old behaviour: on desktop the hover band carries
      // every action and a fullscreen takeover would be in the way.
      if ((this.#pressWasTouch || this.#mobileMode()) && !this.#linkLabels.has(entry.label)) {
        this.#navigateInto(entry.label)
        return
      }

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

  /** Was the press that produced this click a TOUCH? Captured on pointerdown —
   *  a synthesized click carries `pointerType: ''`, so the press is the only
   *  place the real input kind is knowable. */
  #pressWasTouch = false

  /** Mobile mode per the single source of truth (pointer:coarse + phone-sized,
   *  or the `/mobile on` override) — so a touch laptop keeps desktop behaviour
   *  while a phone gets the fullscreen view even from a stylus. */
  #mobileMode(): boolean {
    try {
      const mm = window.ioc?.get?.('@diamondcoreprocessor.com/MobileMode') as { active?: boolean } | undefined
      return mm?.active === true
    } catch { return false }
  }

  // Cancel editor on right-click release (mirrors Escape cascade priority 1)
  #onPointerUp = (e: PointerEvent): void => {
    // Any armed hold-to-enter dies on the release — it only ever fires from
    // its own timer, on a press that never moved and never let go.
    this.#cancelEnterHold()
    // Suppress orphaned pointerup from navigation gesture (click/contextmenu still pending)
    if (this.#consumedPointerId === e.pointerId) return
    if (e.button !== 2) return
    if (!this.#editing) return
    const drone = window.ioc.get<{ cancelEditing(): void }>('@diamondcoreprocessor.com/TileEditorDrone')
    drone?.cancelEditing()
  }

  #onConsumedGestureEnd = (e: CustomEvent<{ pointerId?: number }>): void => {
    if (e.detail?.pointerId !== this.#consumedPointerId) return
    this.#consumedPointerId = null
    this.#pressCapture = null
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

  #navigateInto(label: string): void {
    // Navigation itself never uses a cooldown, and readiness never refuses:
    // a shaded destination is entered like any other, with the preloader
    // redirected at it on the way in.

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

    // THE SHADE NEVER REFUSES. A shaded branch says "the inside hasn't arrived
    // yet — opening this will make you wait", never "you may not open this"
    // (Jaime 2026-07-28: "just because something is shaded doesn't mean you
    // can't click it and put it in at the front of the line" / "you don't
    // necessarily have to wait for the tile to light up to navigate to it").
    // This used to `return`, and the participant experienced it as a dead
    // tile. What the press changes now is PRIORITY, not permission — see the
    // divert immediately before the entry commits below.

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
      // The target rides along for the same reason: the recent-portals list
      // (and with it Home) records where the portal LED, and after the hop
      // nothing on screen still says which portal we came through.
      this.emitEffect('tile:navigate-reference', { label, target: [...refTarget] })
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

    // ── FIRST CLICK ADOPTS, SECOND CLICK ENTERS ─────────────────────────
    // (Jaime, 2026-08-20: "the first click adopts and a second click
    // navigates. This way [you] turn on tiles easily and it's really
    // clear.") A shaded tile's click ACQUIRES — a swarm tile you don't own
    // is taken (the wand), a held tile a peer has an update for is synced —
    // and you STAY where you stand to watch it light up. The tile at full
    // strength is the page's own confirmation, and the next click walks in
    // like any other. Placed at the entry choke point so every entering
    // gesture (click, hold-to-enter, tap) obeys the same two-step; the ctrl
    // sweep survives beside it for taking several tiles at once.
    //
    // The guard opened at #beginNavigationTransition releases immediately —
    // nothing moved, and the take must not dead-lock the page.
    if (this.#firstClickTakes(label)) {
      // The likely next click is the walk in — warm the inside now.
      this.#divertPreloadTo(label)
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

    // FRONT OF THE LINE. Whatever neighbourhood the preloader was warming, the
    // tile being entered outranks it — this is the one destination we now know
    // for certain the participant wants. Fire-and-forget, immediately before
    // the entry commits: a warm destination makes this a no-op, a cold one gets
    // the preloader's full attention instead of its eventual attention.
    this.#divertPreloadTo(label)

    lineage.explorerEnter(label)
    // Processor pulse triggered by lineage change. A valid label always appends
    // a segment (explorerEnter guards empty/'.'/'..'), so this is never a no-op
    // on the normal path — the check is belt-and-braces and simply won't fire.
    this.#releaseGuardIfNoMove(before)
  }

  /** THE FIRST CLICK'S QUESTION: does this click acquire instead of enter?
   *  True = it acquired (and the caller stays put); false = walk in.
   *
   *  Two acquisitions, both riding gestures that already exist:
   *  • An external tile still receding (#swarmTakeLabels — the hover-free
   *    swarm-shade set from the render; the live shade lifts under the
   *    pointer and the click always arrives hovering) fires the wand:
   *    TRANSIENT (a replayed last-value would re-take a tile given back),
   *    tombstone-clearing, one ITEM only. `wandEligible` is the same
   *    synchronous oracle the ctrl sweep asks on pointerdown. A bundle
   *    without the sharing drones resolves nothing and takes nothing.
   *  • A HELD tile a peer has an update for (peerDivergesAt — sync-readable,
   *    fresher than any payload) fires the `sync` action: the publisher's
   *    current visuals fold in, in place. The wand emit alongside it is for
   *    the RENDERER — the lift-and-taking-rim flash — and is a held-tile
   *    no-op inside SwarmAdoptDrone's fold.
   *
   *  #wandTakenLabels bridges the gap between the take and its repaint: a
   *  second click during that window must walk in, not re-take. Location-
   *  scoped — names mean nothing across pages. Readiness shade (yours,
   *  still loading) matches neither branch and never refuses: entering a
   *  loading tile stays allowed, exactly as before. */
  #firstClickTakes(label: string): boolean {
    const here = this.#currentLocationKey()
    if (this.#wandTakenLocation !== here) {
      this.#wandTakenLabels.clear()
      this.#wandTakenLocation = here
    }
    if (this.#wandTakenLabels.has(label)) return false
    if (this.#swarmTakeLabels.has(label) && this.#externalLabels.has(label)) {
      const adopt = window.ioc?.get?.<{ wandEligible?: (l: string) => boolean }>(
        '@diamondcoreprocessor.com/SwarmAdoptDrone',
      )
      if (!adopt?.wandEligible?.(label)) return false
      this.#wandTakenLabels.add(label)
      EffectBus.emitTransient('swarm:wand', { label })
      return true
    }
    if (!this.#externalLabels.has(label) && peerDivergesAt(label)) {
      this.#wandTakenLabels.add(label)
      EffectBus.emitTransient('swarm:wand', { label })
      this.emitEffect('tile:action', { action: 'sync', label })
      return true
    }
    return false
  }

  /** Redirect the preloader at the tile we are entering. The destination is
   *  this location plus the label — the same path the entry is about to
   *  commit. Best-effort in every direction: no HistoryService, an older
   *  contract without `divertPreloadTo`, or an unresolvable lineage all mean
   *  the warm simply stays where it was, and the navigation proceeds either
   *  way. Preloading is an optimization; it never gets a vote on navigation. */
  #divertPreloadTo(label: string): void {
    try {
      const history = window.ioc.get<{ divertPreloadTo?: (segments: readonly string[]) => void }>(
        '@diamondcoreprocessor.com/HistoryService',
      )
      if (!history?.divertPreloadTo) return
      const segs = (this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
        ?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
      history.divertPreloadTo([...segs, label])
    } catch { /* never blocks navigation */ }
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

    // The Pheromones window owns the hive while it is up — hover pops that
    // tile's keyword card, and a dragged pheromone lands on the tile under the
    // pointer. The band would cover the card and eat the press, so it stands
    // down for the whole session rather than only while a takeover is armed.
    if (this.#pheromoneWindowOpen) { this.#overlay.visible = false; return }

    // Arrange mode: overlay stays visible
    if (this.#arrangeMode) {
      this.#overlay.visible = true
      return
    }

    // RETIRED ON A PHONE. This band is a HOVER affordance — it needs a pointer
    // resting on a tile to reveal itself and a second, accurate press to hit a
    // 7px icon, and a finger supplies neither. Everything it carries lives on
    // the tile's own screen instead, which one hold reaches and which sizes
    // its icons for a thumb. Arrange mode is above this deliberately: laying
    // the icons out is still how you choose what the band shows on desktop.
    if (this.#mobileMode()) {
      this.#overlay.visible = false
      this.#hexBg?.hide()
      return
    }

    // during image drag-over, show overlay as a drop target / placeholder
    if (this.#dropDragging) {
      this.#overlay.visible = !this.#dropGroupOnly
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
      // Navigation rebuilds the shader and clears its hovered index. The
      // pointer can remain perfectly still over a tile in the arriving level,
      // so no pointermove follows to restore the shader's dark label/action
      // band. Re-emit from the fresh occupied map after laying out the actions
      // (which establishes overlay:band-rows) so their background and label
      // are painted together on the first frame of the new level.
      const entry = this.#occupiedByAxial.get(
        TileOverlayDrone.axialKey(this.#currentAxial.q, this.#currentAxial.r),
      )
      this.emitEffect('tile:hover', {
        q: this.#currentAxial.q,
        r: this.#currentAxial.r,
        label: entry?.label ?? null,
        bandRows: entry ? this.#bandRows : 1,
      })
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
   *  The same pixel→axial→occupied resolution the click branches do,
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

  /** Where the tile named `label` sits ON SCREEN: its hex centre in client
   *  (viewport) coordinates plus its on-screen circumradius. The inverse of
   *  labelAtClient, for chrome that wants to stand BESIDE a tile rather than
   *  under the cursor (the pheromone card anchors with this). Null when the
   *  tile isn't on the current render. */
  clientAnchorForLabel(label: string): { x: number; y: number; radius: number } | null {
    if (!this.#renderContainer || !this.#renderer || !this.#canvas) return null
    let coord: Axial | undefined
    for (let i = 0; i < this.#cellCount; i++) {
      if (this.#cellLabels[i] === label) { coord = this.#cellCoords[i]; break }
    }
    if (!coord) return null
    const px = this.#axialToPixel(coord.q, coord.r)
    const global = this.#renderContainer.toGlobal(
      new Point(px.x + this.#meshOffset.x, px.y + this.#meshOffset.y),
    )
    // Pixi screen space → CSS client space (the canvas can render at a
    // different resolution than it displays), then offset by the canvas rect.
    const rect = this.#canvas.getBoundingClientRect()
    const screen = this.#renderer.screen
    const sx = rect.width / screen.width
    const wt = this.#renderContainer.worldTransform
    return {
      x: rect.left + global.x * sx,
      y: rect.top + global.y * (rect.height / screen.height),
      radius: this.#geo.circumRadiusPx * Math.hypot(wt.a, wt.b) * sx,
    }
  }

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
    this.emitEffect('tile:hover', { label: null, bandRows: 1 })
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

  /** Broadcast where a drag would land. `null` means NOWHERE — the pointer has
   *  left the hive for chrome — and is sent with the shape intact rather than as
   *  a null payload, because consumers destructure this on arrival. `over`
   *  carries the distinction that `occupied:false` cannot: empty hive is a
   *  perfectly good landing place, off the hive is not. Absent `over` reads as
   *  true, so every consumer written before this field behaves as it always did. */
  #emitDropTarget(axial: Axial | null): void {
    if (!axial) {
      this.emitEffect('drop:target', {
        q: 0, r: 0, occupied: false, label: null, index: -1, hasImage: false, over: false,
      })
      return
    }
    const entry = this.#occupiedByAxial.get(TileOverlayDrone.axialKey(axial.q, axial.r))
    this.emitEffect('drop:target', {
      q: axial.q,
      r: axial.r,
      occupied: !!entry,
      label: entry?.label ?? null,
      index: entry?.index ?? -1,
      hasImage: entry ? !this.#noImageLabels.has(entry.label) : false,
      over: true,
    })
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
