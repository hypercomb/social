// recipe/recipe-view.drone.ts
//
// THE RECIPE VIEW: the desk a cook writes a tile's recipe at, arranges its
// layout on, and reads along from. The recipe is the tile's own content (its
// `recipe` slot, L1), so this drone only joins what the other recipe files
// already are: it reads the tile (recipe-store.ts), mounts the page
// (recipe-page.ts), saves what the cook wrote, puts the template picker
// (recipe-picker.ts) over the page when a layout is being chosen, and says
// where the recipe is offered (recipe-entries.ts, pools/room-entries.ts).
//
// The desk has its own header, so it sits where the tile editor sits: under
// whatever band is reserved off the top, beside the shell's rail, above the
// controls.
//
// ── Opening and leaving ──────────────────────────────────────────────────
//
// It opens two ways. `view:open-for-tile` names a tile (the tile's icon, the
// word `recipe`); any other flip of the view mode to `recipe` (the toggle,
// the Views window) means the tile the cook is standing in. It opens over the
// place the cook stands and never moves them, so leaving has one destination:
// the surface that was up when it opened (presentation/tiles/view-spawn.ts).
// The page's close, Escape and the back gesture all name the hexagons, after
// the unsaved words are saved.
//
// ── Saving ───────────────────────────────────────────────────────────────
//
// Typing pauses, and the recipe is committed as ordinary hive content: new
// bytes, a new signature, a new layer, a history entry (H2). A recipe that
// says what the tile already holds commits nothing. The first save names the
// layout the recipe was written through, held first so the name resolves
// (I2). A visitor's shell, and a tile whose recipe could not be read, get the
// read-along only: nothing is saved over what could not be shown.
//
// ── The list on the left ─────────────────────────────────────────────────
//
// The desk lists the tiles of the page the recipe's tile sits on, by name
// (N1), each saying whether it holds a recipe: its mark first, the cheapest
// read there is (commands/decoration-kind-index.ts), else its own layer's
// slot. Choosing a row saves what was written and shows that tile's recipe on
// the same desk: nothing is torn down and the view mode does not change. A
// tile with no recipe opens empty in the first built-in layout, and nothing
// is saved until the cook writes.
//
// ── Where the recipe is offered ──────────────────────────────────────────
//
// A lit tile is a public tile (presentation/tiles/tile-public.ts), and only a
// lit tile is offered anywhere (T5, T8). The bulb in the header lights or
// unlights THIS tile: through the tile actions drone when the tile is on the
// page the cook stands on, and otherwise by the same marks set by route with
// the same announcement, so the swarm and the grid hear one thing.
//
// Outside a room a save sends nothing: Publish in pools mode is the only door
// to a domain. In a room a lit recipe is an entry on the room's host (T1, the
// classroom: one host, many cooks with none of their own). Each save of a lit
// recipe is shared once it lands, one share at a time; an empty recipe is not
// shared, and emptying a lit recipe takes its entry back (H4: gone, never
// deleted). The words beside the bulb say which of these is true, and a
// refusal's reason is said in the status line.
//
// UNLIGHTING A TILE TAKES ITS ENTRY BACK TOO, AND THAT TAKE-BACK IS NOT SENT
// FROM HERE. A tile is unlit on the grid far more often than on this desk, and
// this bee sleeps until its view is asked for, so recipe.queen.ts, awake on
// every hive, hears every change of lights and takes back what went dark. The
// desk's part is to stop: it forgets what the host said of a tile that is no
// longer lit, never sends a share of one, and takes back only a share of its
// own that was still on its way when the light went off.
//
// ── Browse ───────────────────────────────────────────────────────────────
//
// Browse leaves for the catalogue of what the cook's nodes offer. The way back
// is announced first (`view:spawn`, naming this view as the surface that was
// up), and the tile on the desk is remembered here, because the record says
// where the cook stood and not which tile was open.
//
// ── The picker and the domains ───────────────────────────────────────────
//
// The picker offers what is built in, what the cook keeps, and what each
// domain switched on in the domain shelf offers (T5: whom a reader takes from
// is theirs to choose; T9: the table is the union of what those hosts list).
// The shelf is asked into view while the picker is open and released when it
// closes. A domain's template is an offer until the cook presses it: that
// press is the yes (T4), and it is kept by the maker's own bytes, verified
// against its signature, before it becomes anyone's layout (M1).
//
// ── The table the desk sits on ───────────────────────────────────────────
//
// The Table control chooses which photographed table set the desk sits on
// (recipe-setting-pool.ts): a kept set, one a followed domain offers, one
// brought in from a render's files, or none, the drawn plate. The choice is
// this hive's, remembered through the store (`recipe:desk`). A set is handed
// to the page only when every picture it names is held here; otherwise the
// drawn plate stands. A domain's set is fetched with its pictures only when
// the leader presses it (T4), and domains are asked only while the control
// is open.
//
// The drone sleeps until its view is asked for (`renders`), which is why
// nothing else names its key or imports this file.

import { Drone, EffectBus, I18N_IOC_KEY, get, type I18nProvider } from '@hypercomb/core'
import { hasDecorationKindAt } from '../commands/decoration-kind-index.js'
import { SAVE_DEBOUNCE_MS, shouldCommitBody } from '../document/document-edit.js'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
import type { BackGesture } from '../navigation/back-gesture.service.js'
import {
  DOMAIN_SHELF_WANTED,
  LIGHTS_CHANGED,
  SOURCES_CHANGED,
  SOURCES_COUNTED,
  SOURCES_QUERY,
  type DomainShelfWanted,
  type SourcesCounted,
  type SourcesState,
} from '../pools/lights-contract.js'
import { liveChildrenOf } from '../pools/lit-tiles.js'
import { followedZones, readSourcesOff } from '../pools/pool-sources.js'
import { roomStanding } from '../pools/room-entries.js'
import { isBranchPublic, isCellPublic, isIndividuallyPublic, setBranchPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { HEXAGONS, VIEW_SPAWN_EFFECT, sameSegments, spawnForView, viewExitTarget, type ViewSpawn } from '../presentation/tiles/view-spawn.js'
import { isPublishedVisitorShell } from '../sharing/behavior-enablement.js'
import { mapBounded } from '../sharing/bounded-fetch.js'
import { DEFAULT_RECIPE_TEMPLATES } from './recipe-defaults.js'
import { retractRecipeFromRoom, shareRecipeWithRoom, type RecipeEntryShared } from './recipe-entries.js'
import { recipePage, type RecipePageHandle, type RecipeSettingChoice, type RecipeSettingMenu, type RecipeShared, type RecipeTileRow } from './recipe-page.js'
import { recipePicker, type RecipePickerHandle } from './recipe-picker.js'
import {
  RECIPE_TEMPLATE_MEANING,
  defaultRecipeTemplates,
  findCommunityRecipeTemplates,
  forgetRecipeTemplate,
  holdRecipeTemplate,
  keepRecipeTemplate,
  listRecipeTemplates,
  readRecipeTemplate,
  recipeTemplateStore,
  saveRecipeTemplate,
  type RecipeTemplateOffer,
} from './recipe-pool.js'
import type { RecipeSetting } from './recipe-setting.js'
import {
  findCommunityRecipeSettings,
  forgetRecipeSetting,
  importRecipeSetting,
  listRecipeSettings,
  readRecipeDeskSetting,
  readRecipeSetting,
  recipeSettingHeld,
  recipeSettingStore,
  takeCommunityRecipeSetting,
  writeRecipeDeskSetting,
  type RecipeSettingOffer,
} from './recipe-setting-pool.js'
import { RECIPE_KIND, RECIPE_OPEN_FOR_TILE, RECIPE_SLOT, RECIPE_SLOT_DECLARATION, RECIPE_VIEW } from './recipe-slot.js'
import { loadRecipeAt, recipeClipboardPictures, recipePictureUrl, saveRecipeAt, storeRecipePictures, type RecipeAtTile } from './recipe-store.js'
import { ensureRecipeStyles } from './recipe-style.js'
import { isEmptyRecipeValue, type RecipeDocument, type RecipeTemplateDocument } from './recipe-template.js'
import {
  RECIPE_PICKER_OWNER,
  RECIPE_VIEW_BROWSE,
  RECIPE_VIEW_OWNER,
  recipeViewAddress,
  recipeViewCounts,
  recipeViewFresh,
  recipeViewKey,
  recipeViewLightStep,
  recipeViewPick,
  recipeViewPickerGroups,
  recipeViewQuery,
  recipeViewSameTile,
  recipeViewShared,
  recipeViewTemplate,
  recipeViewTileRows,
  recipeViewZones,
  type RecipeViewRoomOutcome,
  type RecipeViewSources,
  type RecipeViewTemplate,
} from './recipe-view-state.js'

const HOST_ID = 'hc-recipe-view-host'
/** THE TILE EDITOR'S EDGES (editor/tile-editor.styles.ts): the desk has its own
 *  header, so its top is the safe edge or whatever band is reserved off the top
 *  (the domain shelf), never the shell header's anchor, which is an empty band
 *  while `view:active` hides that header. The shell's rail stays outside on the
 *  left, a docked panel on the right, the controls underneath. Opaque. */
/** How long leaving waits for pictures still being kept, before it saves what it has. */
const PICTURES_WAIT_MS = 8_000

const HOST_STYLE =
  'position:fixed;' +
  'top:max(var(--hc-inset-top,0px),var(--hc-safe-top,0px));' +
  'left:var(--hc-controls-left,var(--hc-inset-left,0px));' +
  'right:max(var(--hc-inset-right,0px),var(--hc-controls-right,0px));' +
  'bottom:calc(max(var(--hc-controls-bottom,0px),var(--hc-safe-bottom,0px)) + var(--hc-mobile-row-lift,0px));' +
  'z-index:60001;overflow:hidden;' +
  'background:rgb(var(--hc-panel-pane,12,19,27));'
/** Domains asked at once when the picker opens. */
const ZONES_AT_ONCE = 4
/** Tiles of one page whose own layer is read to learn whether they hold a recipe, at most and at once. */
const LIST_READS_MAX = 200
const LIST_READS_AT_ONCE = 8
/** Every join and leave path announces the tab's membership on this effect (sharing/membership.ts). */
const ROOM_CHANGED = 'mesh:public-changed'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

type HistoryShape = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}
type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = EventTarget & { explorerSegments?: () => readonly string[] }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

/** The tile asked for, where the cook stood when it was asked, and whether a walk asked. */
type Target = { segments: string[]; stoodAt: string[]; walked: boolean }

type Mount = {
  host: HTMLDivElement
  page: RecipePageHandle
  /** The tile the recipe belongs to: a save never lands anywhere else. */
  segments: string[]
  /** True for a visitor's shell, and for a tile whose recipe could not be read. */
  readOnly: boolean
  /** The layout on the page. */
  template: RecipeTemplateDocument
  /** Its signature, '' while arrange has changed it and it is not held yet. */
  shownSig: string
  /** The template the recipe names, '' until it names one. */
  named: string
  /** Arrange changed the layout since it was last held. */
  layoutChanged: boolean
  /** The recipe as the tile holds it, as canonical text: what a save is compared with. */
  savedKey: string
  timer: number | null
  /** The save in flight: the next waits for it. */
  saving: Promise<void>
  /** The names of the tiles on the page this tile sits on: the desk's list. */
  labels: readonly string[]
  /** Which of those names are known to hold a recipe. */
  holding: Set<string>
  /** The tile on the desk holds a recipe: it had one when opened, or one was saved since. */
  holds: boolean
  /** That recipe says nothing: there is nothing to share. */
  empty: boolean
  /** The tile is lit: what the bulb shows. */
  lit: boolean
  /** Counts the rows chosen: the newest choice is the one shown. */
  turn: number
}

/** What a tile's recipe is on the desk as: the part of a mount that changes when another row is chosen. */
type Opened = Pick<Mount, 'segments' | 'template' | 'shownSig' | 'named' | 'layoutChanged' | 'savedKey' | 'holds' | 'empty' | 'lit'>

/** One thing owed to a room for one tile: its entry, or its entry taken back. `where` is the room it is owed to. */
type RoomAsk = { segments: string[]; act: 'share' | 'retract'; key: string; where: string }
/** What a room's host last answered for a tile: which room, and the recipe it answered for. */
type RoomSaid = { where: string; key: string; outcome: RecipeViewRoomOutcome }

type Picker = {
  handle: RecipePickerHandle | null
  mount: Mount
  /** False for a visitor: what is on this device only, and no domain is asked. */
  community: boolean
  kept: RecipeViewTemplate[]
  zones: string[]
  /** The search words as the domain shelf announces them. */
  query: string
  /** The search words as typed into the picker. */
  typed: string
  /** What each domain asked so far offers, kept for the life of this picker. */
  offers: Map<string, readonly RecipeTemplateOffer[]>
  asking: Set<string>
  picking: boolean
  /** Stops listening to the domain shelf. */
  off: () => void
}

const live = <T>(key: string): T | undefined => {
  try { return get<T>(key) } catch { return undefined }
}

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = live<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const names = (segments: unknown): string[] =>
  Array.isArray(segments) ? segments.map(part => String(part ?? '').trim()).filter(Boolean) : []

/** One route as a key. NUL is the one character a tile name never carries. */
const routeKey = (segments: readonly string[]): string => segments.join('\u0000')

/** A tile's page and name as the public marks address them (presentation/tiles/tile-public.ts). */
const placeOf = (segments: readonly string[]): { page: string[]; location: string; label: string } => {
  const page = segments.slice(0, -1)
  return { page, location: `/${page.join('/')}`, label: segments[segments.length - 1] ?? '' }
}

/** True when the tile at a route is lit: marked on its own, or covered by a lit branch. */
const litAt = (segments: readonly string[]): boolean => {
  const { location, label } = placeOf(segments)
  try { return isCellPublic(location, label) } catch { return false }
}

const emptyDoc = (doc: RecipeDocument): boolean => Object.values(doc.values).every(isEmptyRecipeValue)

/** The room this tab is joined to and the host that keeps its entries, as one key. '' outside a room. Never the secret. */
const roomPlace = (): string => {
  const standing = roomStanding()
  return standing.joined ? `${standing.room}\u0000${standing.host}` : ''
}

/** A shell that only reads: a published site's visitor, or a hive opened read-only. */
const readOnlyShell = (): boolean =>
  isPublishedVisitorShell() || (globalThis as { __HC_READONLY__?: boolean }).__HC_READONLY__ === true

export class RecipeViewDrone extends Drone {
  /** THE VIEW THIS BEE RENDERS, and nowhere else does it act: it may sleep
   *  until the view mode enters it, or `view:open-for-tile` names it
   *  (essentials scripts/passive-queen.ts, runtime script-preloader.ts). */
  readonly renders: readonly string[] = ['recipe']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'The recipe desk. When the view mode is "recipe", opens the recipe a tile holds to write, arrange or read along, saves it into the hive, and shares a lit recipe with the room the tab is joined to.'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    viewMode: '@hypercomb.social/ViewMode',
  }
  protected override listens: string[] = [RECIPE_OPEN_FOR_TILE, VIEW_SPAWN_EFFECT, SOURCES_CHANGED, LIGHTS_CHANGED, ROOM_CHANGED]
  protected override emits: string[] = [
    'view:active', DOMAIN_SHELF_WANTED, SOURCES_QUERY, SOURCES_COUNTED,
    'keymap:hold', 'keymap:release', 'activity:log', 'tile:action',
    LIGHTS_CHANGED, VIEW_SPAWN_EFFECT,
  ]

  #bound = false
  #mount: Mount | null = null
  #picker: Picker | null = null
  #target: Target | null = null
  #defaults: readonly RecipeViewTemplate[] = []
  #viewActive = false
  /** Re-entrancy generation: a reconcile bails after any wait once a newer one started. */
  #gen = 0
  /** The surface and place this recipe was opened from: where leaving lands. */
  #spawn: ViewSpawn | null = null
  /** A recipe session is up, so an unrelated mode flip never moves anyone. */
  #session = false
  /** Leaving sets the view mode a second time, from inside the mode-change handler. */
  #restoring = false
  /** The recipe Browse left for the catalogue, and the way out it had: where coming back lands. */
  #browsed: { segments: string[]; spawn: ViewSpawn | null } | null = null
  /** What the room is still owed, one ask per tile, the newest standing. */
  #roomAsks = new Map<string, RoomAsk>()
  /** The one ask the room's host is being asked now: the rest wait their turn. */
  #roomSending: RoomAsk | null = null
  /** What a room's host last answered, by tile. Memory only. */
  #roomSaid = new Map<string, RoomSaid>()
  /** The table set the desk sits on: chosen, read and held whole here. Null: the drawn plate. */
  #setting: RecipeSetting | null = null
  /** What the Table control lists: the kept sets, then what the followed domains offer, by signature. */
  #tableKept: RecipeSettingChoice[] = []
  #tableOffers = new Map<string, RecipeSettingOffer>()
  #tableAsking = false
  /** One table choice at a time: a press while one is being brought in is not a second one. */
  #tableBusy = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) this.#bind()
    // Never awaited: a recipe still being read must not hold up the pulse.
    void this.#reconcile()
  }

  protected override dispose(): void {
    this.#teardown()
  }

  // ── binding ────────────────────────────────────────────────────────────

  #bind(): void {
    this.#bound = true
    const vm = this.#vm()
    if (vm?.addEventListener) {
      this.listen(vm, 'change', this.#onModeChange)
      // Woken by the mode itself: the session began before this bee was listening.
      if (vm.mode === RECIPE_VIEW) this.#session = true
    }
    const lineage = this.resolve<LineageShape>('lineage')
    if (lineage?.addEventListener) this.listen(lineage, 'change', this.#onLineageChange)
    this.listen(window, 'keydown', this.#onKeyDown as EventListener, true)
    // A tab put away or a page closing must not take unsaved words with it.
    this.listen(document, 'visibilitychange', this.#onHidden)
    this.listen(window, 'pagehide', this.#onPageHide)

    // Where the word that opened this recipe was said FROM. The subscription's
    // own replay is honoured only while its stamp is fresh: that is the press
    // that just woke this bee, never a record from an earlier session.
    let replay = true
    this.onEffect<{ at?: unknown }>(VIEW_SPAWN_EFFECT, payload => {
      if (replay && !recipeViewFresh(payload?.at, Date.now())) return
      const spawn = spawnForView(payload, RECIPE_VIEW)
      if (spawn) this.#spawn = spawn
    })
    replay = false

    this.onEffect<{ view?: string; segments?: unknown; at?: unknown }>(RECIPE_OPEN_FOR_TILE, payload => {
      if (payload?.view !== RECIPE_VIEW) return
      // A stamped press that is old is the bus replaying it, not the cook pressing.
      if (payload.at !== undefined && !recipeViewFresh(payload.at, Date.now())) return
      this.#target = { segments: names(payload.segments), stoodAt: this.#here(), walked: false }
      this.#vm()?.setMode(RECIPE_VIEW)
      void this.#reconcile()
    })

    // A tile was lit or unlit, here or on the grid: the bulb follows, and so does the room.
    this.onEffect(LIGHTS_CHANGED, () => {
      this.#forgetUnlit()
      if (this.#mount) this.#relight(this.#mount)
    })
    // The tab joined a room or left it: a lit recipe on the desk is owed to the room it is now in.
    this.onEffect(ROOM_CHANGED, () => {
      const mount = this.#mount
      if (!mount) return
      this.#roomStep(mount)
      this.#paintShared(mount)
    })

    // One registration feeds the right button and browser / hardware BACK
    // (navigation/back-gesture.service.ts). The owner is the one the view
    // enters `view:active` with, so the entry answers only while the page is up.
    const dropBack = live<BackGesture>('@diamondcoreprocessor.com/BackGesture')
      ?.register({ owner: RECIPE_VIEW_OWNER, back: () => this.#back() })
    if (dropBack) this.own(dropBack)
  }

  #vm(): ViewModeShape | undefined {
    return this.resolve<ViewModeShape>('viewMode')
  }

  #here(): string[] {
    return names([...(this.resolve<LineageShape>('lineage')?.explorerSegments?.() ?? [])])
  }

  // ── reactivity ─────────────────────────────────────────────────────────

  /** Track the session, and on the way out to the hexagons come back to the
   *  surface the recipe was opened from. A flip onto another view is a change
   *  of face, not a way out. */
  readonly #onModeChange = (): void => {
    if (!this.#restoring) {
      const mode = this.#vm()?.mode
      if (mode === RECIPE_VIEW) {
        this.#session = true
        // Back from the catalogue: the recipe that was on the desk, with the way out it had.
        const browsed = this.#browsed
        this.#browsed = null
        if (browsed) {
          // A tile the catalogue asked for outranks the one that was left; the way out is the same either way.
          this.#target ??= { segments: browsed.segments, stoodAt: this.#here(), walked: false }
          this.#spawn ??= browsed.spawn
        }
      } else {
        if (this.#session) {
          const spawn = this.#spawn
          this.#session = false
          this.#spawn = null
          if (spawn && mode === HEXAGONS) this.#returnToSpawn(spawn)
        }
        if (this.#browsed && mode !== RECIPE_VIEW_BROWSE) {
          // The catalogue puts this view back in the same breath it leaves in: only a
          // mode that is still neither of the two was a way out, and it forgets the desk.
          queueMicrotask(() => {
            const now = this.#vm()?.mode
            if (now !== RECIPE_VIEW && now !== RECIPE_VIEW_BROWSE) this.#browsed = null
          })
        }
      }
    }
    void this.#reconcile()
  }

  /** The recipe opened in place, so the place is where it was: only the
   *  surface comes back, and only when the cook has not walked since. */
  #returnToSpawn(spawn: ViewSpawn): void {
    const target = viewExitTarget(spawn, spawn.segments, this.#here(), HEXAGONS)
    if (!target || target.mode === RECIPE_VIEW) return
    this.#restoring = true
    try { this.#vm()?.setMode(target.mode) } finally { this.#restoring = false }
  }

  /** A walk while the recipe is up. The page sits over the place the cook
   *  stood, so a lineage change that did not move them changes nothing. */
  readonly #onLineageChange = (): void => {
    if (this.#vm()?.mode !== RECIPE_VIEW) return
    const here = this.#here()
    if (this.#target && sameSegments(this.#target.stoodAt, here)) return
    this.#target = { segments: here, stoodAt: here, walked: true }
    void this.#reconcile()
  }

  /** Escape from outside the page. Inside it, and with nothing focused, the
   *  page and its picker answer first (a menu, arrange and the picker come
   *  off before the page does); a field elsewhere keeps its own Escape. */
  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const mount = this.#mount
    if (event.key !== 'Escape' || !mount || this.#vm()?.mode !== RECIPE_VIEW) return
    const from = event.composedPath?.()[0] ?? event.target
    if (!(from instanceof Element) || from === document.body || from === document.documentElement) return
    if (mount.host.contains(from)) return
    if (from.closest('input, textarea, select, [contenteditable]')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#back()
  }

  readonly #onHidden = (): void => {
    if (document.visibilityState === 'hidden') void this.#flush(this.#mount, false)
  }

  readonly #onPageHide = (): void => { void this.#flush(this.#mount, false) }

  // ── reconcile / mount ──────────────────────────────────────────────────

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode !== RECIPE_VIEW) {
      this.#target = null
      await this.#teardownSaving()
      return
    }
    const here = this.#here()
    const target = this.#target ??= { segments: here, stoodAt: here, walked: false }
    // Already showing this tile: remounting would throw away the caret and
    // whatever was typed since the last save.
    if (this.#mount && sameSegments(this.#mount.segments, target.segments)) return

    await this.#teardownSaving()
    if (gen !== this.#gen) return
    if (!target.segments.length) {
      // The hive root has no tile to hold a recipe. Never hold an empty surface.
      EffectBus.emit('activity:log', {
        message: t('recipe.word.root', 'Select a tile or step into one first: a recipe lives on a tile.'),
        icon: 'menu_book',
      })
      this.#leave()
      return
    }

    const [loaded, defaults, labels, setting] = await Promise.all([
      loadRecipeAt(target.segments),
      defaultRecipeTemplates().catch((): readonly RecipeViewTemplate[] => []),
      // The tiles of the page this tile sits on. Never throws: a page that cannot be read lists nothing.
      liveChildrenOf()(target.segments.slice(0, -1)),
      // The table the desk sits on: read before the page is made, so it opens on it.
      this.#deskSetting(),
    ])
    const shown = await this.#layoutOf(loaded, defaults)
    if (gen !== this.#gen || this.#vm()?.mode !== RECIPE_VIEW) return

    // A walk onto a tile that holds no recipe is not a request to write one.
    if (target.walked && !loaded.recipe && !loaded.reason) { this.#leave(); return }

    this.#defaults = defaults
    this.#setting = setting
    this.#build(target, loaded, shown, labels)
  }

  /** The set this hive's desk sits on, when it reads and every picture of it is held here. Else null: the drawn plate. */
  async #deskSetting(): Promise<RecipeSetting | null> {
    try {
      const store = recipeSettingStore()
      const sig = await readRecipeDeskSetting(store)
      if (!sig) return null
      const read = await readRecipeSetting(store, sig)
      return read.ok && await recipeSettingHeld(store, read.setting) ? read.setting : null
    } catch { return null }
  }

  /** The layout a recipe is shown through: the one it names when it is held here, else a built-in. */
  async #layoutOf(loaded: RecipeAtTile, defaults: readonly RecipeViewTemplate[]): Promise<RecipeViewTemplate> {
    const named = loaded.recipe?.template
    const held = named ? await readRecipeTemplate(recipeTemplateStore(), named) : null
    return recipeViewTemplate(named, held?.ok ? { sig: held.sig, template: held.template } : null, defaults)
      ?? { sig: '', template: DEFAULT_RECIPE_TEMPLATES[0] }
  }

  /** The recipe as the page is handed it, and what the drone knows the tile by. */
  #opened(segments: readonly string[], loaded: RecipeAtTile, shown: RecipeViewTemplate): { recipe: RecipeDocument; state: Opened } {
    const named = loaded.recipe?.template ?? ''
    const recipe: RecipeDocument = { ...(named ? { template: named } : {}), values: loaded.recipe?.values ?? {} }
    return {
      recipe,
      state: {
        segments: [...segments],
        template: shown.template,
        shownSig: shown.sig,
        named,
        layoutChanged: false,
        savedKey: recipeViewKey(recipe),
        holds: !!loaded.recipe || !!loaded.reason,
        empty: emptyDoc(recipe),
        lit: litAt(segments),
      },
    }
  }

  #build(target: Target, loaded: RecipeAtTile, shown: RecipeViewTemplate, labels: readonly string[]): void {
    const segments = [...target.segments]
    // Nothing is saved over a recipe that could not be shown.
    const readOnly = readOnlyShell() || !!loaded.reason
    const { recipe, state } = this.#opened(segments, loaded, shown)
    // The tile editor opens a tile of the page the cook stands on.
    const editable = !readOnly && sameSegments(target.stoodAt, segments.slice(0, -1))
    // A visitor's hive is not theirs to light, and a published page follows no one.
    const own = !readOnlyShell()

    ensureRecipeStyles(document)
    const host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute('style', HOST_STYLE)
    // The page owns its surface: without this the hex wheel-zoom handler
    // takes the wheel and the page cannot scroll.
    host.setAttribute('data-consumes-wheel', '')

    const holding = this.#marked(segments.slice(0, -1), labels)
    const shared = own ? this.#sharedOf({ ...state, readOnly }) : undefined
    let mount: Mount
    const page = recipePage({
      title: loaded.name || segments[segments.length - 1] || '',
      address: recipeViewAddress(segments),
      recipe,
      template: shown.template,
      readOnly,
      tiles: this.#rows({ labels, holding, ...state }),
      onPickTile: label => { void this.#pickTile(mount, label) },
      ...(shared ? { shared, onToggleShared: () => this.#toggleLit(mount) } : {}),
      ...(isPublishedVisitorShell() ? {} : { onBrowse: () => { void this.#browse(mount) } }),
      say: t,
      pictureUrl: recipePictureUrl,
      onChange: () => this.#schedule(mount),
      onLayout: template => {
        mount.template = template
        mount.shownSig = ''
        mount.layoutChanged = true
        this.#schedule(mount)
      },
      takePictures: files => storeRecipePictures(files),
      clipboardPictures: () => recipeClipboardPictures(),
      onPickTemplate: () => this.#openPicker(),
      ...(readOnly ? {} : { onKeepTemplate: () => { void this.#keepTemplate(mount) } }),
      ...(editable ? { onEditTile: () => { void this.#editTile(mount) } } : {}),
      onMode: () => { void this.#flush(mount) },
      onClose: () => { void this.#backOut() },
      setting: this.#setting,
      settings: this.#tableMenu(),
      ...(readOnly ? {} : {
        table: {
          open: () => { void this.#openTable(mount) },
          choose: choice => { void this.#chooseTable(mount, choice) },
          add: files => { void this.#addTable(mount, files) },
          remove: choice => { void this.#removeTable(mount, choice) },
        },
      }),
    })
    mount = { host, page, readOnly, timer: null, saving: Promise.resolve(), labels, holding, turn: 0, ...state }
    // The page fills the host, not the viewport: the header and the shelves stay in view above it.
    page.element.style.position = 'absolute'
    host.append(page.element)
    document.body.appendChild(host)
    if (loaded.reason) page.setStatus(t('recipe.view.unreadable', 'This recipe could not be opened: {reason}', { reason: loaded.reason }), 'bad')

    this.#mount = mount
    if (!this.#viewActive) {
      this.#setViewActive(true)
      // The page's keys are its own while it is up: the hive's shortcuts stand
      // aside, so Escape and the read-along's arrows reach the page unclaimed.
      EffectBus.emitTransient('keymap:hold', { reason: RECIPE_VIEW_OWNER })
    }
    this.#roomStep(mount)
    void this.#readHeld(mount)
  }

  // ── the list on the left ───────────────────────────────────────────────

  /** The names on a page that wear the recipe mark: one synchronous look each, no read. */
  #marked(page: readonly string[], labels: readonly string[]): Set<string> {
    return new Set(labels.filter(label => hasDecorationKindAt([...page, label], RECIPE_KIND)))
  }

  /** The desk's list: the page's tiles, the open one marked and saying what the drone knows of it. */
  #rows(at: Pick<Mount, 'labels' | 'holding' | 'segments' | 'holds'>): RecipeTileRow[] {
    return recipeViewTileRows(at.labels, label => at.holding.has(label), at.segments[at.segments.length - 1] ?? '')
      .map(row => (row.current ? { ...row, hasRecipe: at.holds } : row))
  }

  #paintTiles(mount: Mount): void {
    if (this.#mount === mount) mount.page.setTiles(this.#rows(mount))
  }

  /** The tiles that wear no mark may still hold a recipe: each one's own layer says, a few at a time. */
  async #readHeld(mount: Mount): Promise<void> {
    const page = mount.segments.slice(0, -1)
    const unknown = mount.labels.filter(label => !mount.holding.has(label)).slice(0, LIST_READS_MAX)
    if (!unknown.length) return
    const history = live<HistoryShape>(HISTORY_KEY)
    if (!history) return
    const held = await mapBounded(unknown, LIST_READS_AT_ONCE, async label => {
      try {
        const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...page, label] }))
        const slot = layer?.[RECIPE_SLOT]
        return Array.isArray(slot) && slot.length > 0
      } catch { return false }
    })
    if (this.#mount !== mount || !held.some(Boolean)) return
    unknown.forEach((label, at) => { if (held[at]) mount.holding.add(label) })
    this.#paintTiles(mount)
  }

  /** A row was chosen: what was written is saved, then that tile's recipe is on the same desk. */
  async #pickTile(mount: Mount, label: string): Promise<void> {
    const current = mount.segments[mount.segments.length - 1] ?? ''
    if (this.#mount !== mount || !label.trim() || recipeViewSameTile(label, current)) return
    const segments = [...mount.segments.slice(0, -1), label]
    const turn = ++mount.turn
    this.#closePicker()
    await this.#flush(mount)
    const loaded = await loadRecipeAt(segments)
    const shown = await this.#layoutOf(loaded, this.#defaults)
    // Words written while the other tile was being read belong to the tile still on the desk.
    do { await this.#flush(mount) } while (this.#mount === mount && mount.timer !== null)
    if (this.#mount !== mount || mount.turn !== turn || this.#vm()?.mode !== RECIPE_VIEW) return

    // The tile being left keeps saying what is now known of it.
    if (mount.holds) mount.holding.add(mount.labels.find(each => recipeViewSameTile(each, current)) ?? current)
    const target: Target = { segments, stoodAt: this.#target?.stoodAt ?? this.#here(), walked: false }
    this.#target = target
    const readOnly = readOnlyShell() || !!loaded.reason
    if (readOnly !== mount.readOnly) {
      // A page is made to write or to read along, once: the other kind is a page of its own, under the same chrome.
      this.#teardown(true)
      this.#build(target, loaded, shown, mount.labels)
      return
    }
    const { recipe, state } = this.#opened(segments, loaded, shown)
    mount.page.setTitle(loaded.name || label)
    mount.page.setAddress(recipeViewAddress(segments))
    mount.page.setTemplate(shown.template)
    // Another recipe is on the desk now: the page forgets pictures still arriving for the one that left.
    mount.page.setRecipe(recipe, { fresh: true })
    mount.page.setStatus(loaded.reason ? t('recipe.view.unreadable', 'This recipe could not be opened: {reason}', { reason: loaded.reason }) : '', loaded.reason ? 'bad' : 'plain')
    Object.assign(mount, state)
    this.#paintTiles(mount)
    this.#paintShared(mount)
    this.#roomStep(mount)
  }

  // ── where the recipe is offered ────────────────────────────────────────

  /** The words beside the bulb, for a tile as the drone knows it. */
  #sharedOf(at: Pick<Mount, 'segments' | 'lit' | 'empty' | 'readOnly'>): RecipeShared {
    const standing = roomStanding()
    const said = this.#roomSaid.get(routeKey(at.segments))
    return recipeViewShared({
      lit: at.lit,
      // A recipe that is only read along is not shared from here.
      joined: standing.joined && !at.readOnly,
      room: standing.room,
      host: standing.host,
      empty: at.empty,
      // What another room's host answered says nothing about this one.
      outcome: said && said.where === roomPlace() ? said.outcome : null,
    }, t)
  }

  #paintShared(mount: Mount): void {
    if (this.#mount !== mount || readOnlyShell()) return
    mount.page.setShared(this.#sharedOf(mount))
  }

  /** The marks changed somewhere: the bulb says what is true now, and a tile just lit is owed to the room. */
  #relight(mount: Mount): void {
    const was = mount.lit
    mount.lit = litAt(mount.segments)
    if (mount.lit && !was) this.#roomStep(mount)
    this.#paintShared(mount)
  }

  /**
   * The bulb was pressed: light or unlight THIS tile. A tile of the page the
   * cook stands on is asked of the tile actions drone, the one writer of the
   * marks on that page. Any other tile, or a press nobody claimed, sets the
   * same marks by route (tile-public.ts) and makes the same announcement.
   */
  #toggleLit(mount: Mount): void {
    if (this.#mount !== mount || readOnlyShell()) return
    const { page, location, label } = placeOf(mount.segments)
    const step = recipeViewLightStep({
      own: isIndividuallyPublic(location, label),
      branch: isBranchPublic(location, label),
      lit: isCellPublic(location, label),
    })
    if (step === 'held') {
      this.#say(mount, t('recipe.shared.held', 'This tile is on because a branch above it is on. Turn that branch off to stop offering it.'), 'plain')
      return
    }
    const branch = step === 'unlight-branch'
    const want = step === 'light'
    let claimed = false
    if (sameSegments(this.#here(), page)) {
      EffectBus.emitTransient('tile:action', {
        action: branch ? 'make-branch-public' : 'make-public',
        label, q: 0, r: 0, index: 0,
        accept: () => { claimed = true },
      })
    }
    if (claimed) return
    if (branch) setBranchPublic(location, label, false)
    else setCellPublic(location, label, want)
    EffectBus.emit(LIGHTS_CHANGED, { cell: label, location, public: want, ...(branch ? { branch: true } : {}) })
  }

  /**
   * A tile that is no longer lit has no entry in the room: recipe.queen.ts
   * took it back. What the host answered for it, on the desk or not, says
   * nothing any more, so a tile lit again is owed to the room anew.
   */
  #forgetUnlit(): void {
    for (const route of [...this.#roomSaid.keys()]) {
      if (!litAt(route.split('\u0000'))) this.#roomSaid.delete(route)
    }
  }

  /**
   * What the room is owed for the tile on the desk. A lit recipe that says
   * something is an entry: shared unless the host already answered for these
   * very words. A lit one that was offered and now says nothing is taken
   * back. An unlit one is owed nothing from here: its take-back is
   * recipe.queen.ts's. Nothing is asked outside a room.
   */
  #roomStep(mount: Mount, was?: { lit: boolean; empty: boolean }): void {
    const where = roomPlace()
    if (mount.readOnly || !where) return
    const route = routeKey(mount.segments)
    const segments = [...mount.segments]
    if (mount.lit && !mount.empty) {
      const same = (at: { where: string; key: string } | null | undefined): boolean => !!at && at.where === where && at.key === mount.savedKey
      const said = this.#roomSaid.get(route)
      // Already answered for these words, or being asked for them right now.
      if (same(said) && said?.outcome !== 'failed') return
      const sending = this.#roomSending
      if (sending?.act === 'share' && routeKey(sending.segments) === route && same(sending)) return
      this.#roomSaid.delete(route)
      this.#roomAsks.set(route, { segments, act: 'share', key: mount.savedKey, where })
    } else if (mount.lit && was?.lit && !was.empty) {
      this.#roomSaid.delete(route)
      this.#roomAsks.set(route, { segments, act: 'retract', key: '', where })
    } else return
    void this.#roomTurn()
  }

  /** One share or retraction at a time, in the order the tiles asked, the newest ask of a tile standing for it. */
  async #roomTurn(): Promise<void> {
    if (this.#roomSending) return
    try {
      for (;;) {
        const next = this.#roomAsks.entries().next()
        if (next.done) break
        const [route, ask] = next.value
        this.#roomAsks.delete(route)
        // Owed to a room the tab has since left: nothing of it is sent anywhere else.
        if (ask.where !== roomPlace()) continue
        // Unlit while it waited its turn: nothing of a tile that is not lit is ever sent,
        // and its take-back is recipe.queen.ts's.
        if (!litAt(ask.segments)) continue
        this.#roomSending = ask
        const said = ask.act === 'share' ? await shareRecipeWithRoom(ask.segments) : await retractRecipeFromRoom(ask.segments)
        // Unlit while the host was being asked. The entry may have landed after the take-back
        // recipe.queen.ts sent, so the desk that sent it takes it back, and keeps no answer for it.
        const wentDark = ask.act === 'share' && !litAt(ask.segments)
        if (wentDark && said.ok && ask.where === roomPlace()) await retractRecipeFromRoom(ask.segments)
        this.#roomSending = null
        if (wentDark) continue
        // An answer about a room the tab has since left says nothing, and a newer ask of this tile answers for it.
        if (ask.where === roomPlace() && !this.#roomAsks.has(route)) this.#roomAnswered(route, ask, said)
      }
    } finally {
      this.#roomSending = null
    }
  }

  #roomAnswered(route: string, ask: RoomAsk, said: RecipeEntryShared): void {
    if (ask.act === 'share') {
      this.#roomSaid.set(route, { where: ask.where, key: ask.key, outcome: said.ok ? 'kept' : said.live ? 'live' : 'failed' })
    }
    const mount = this.#mount
    if (!mount || routeKey(mount.segments) !== route) return
    this.#paintShared(mount)
    // A host that keeps entries only for its own people is said beside the bulb, not as a failure.
    if (said.ok || said.live) return
    this.#say(mount, ask.act === 'share'
      ? said.reason
      : t('recipe.shared.retract-failed', 'Could not take the recipe back from the room: {reason}', { reason: said.reason }), 'bad')
  }

  // ── browse ─────────────────────────────────────────────────────────────

  /**
   * Browse: what the cook's nodes offer, in the catalogue. Saved first. The
   * way back is said before the surface changes (`view:spawn`, naming this
   * view), and the tile on the desk is kept here with the way out it had.
   */
  async #browse(mount: Mount): Promise<void> {
    await this.#flush(mount)
    const vm = this.#vm()
    if (this.#mount !== mount || !vm || vm.mode !== RECIPE_VIEW) return
    this.#browsed = { segments: [...mount.segments], spawn: this.#spawn }
    const spawn: ViewSpawn & { at: number } = { view: RECIPE_VIEW_BROWSE, mode: RECIPE_VIEW, segments: this.#here(), at: Date.now() }
    EffectBus.emit(VIEW_SPAWN_EFFECT, spawn)
    vm.setMode(RECIPE_VIEW_BROWSE)
  }

  // ── saving ─────────────────────────────────────────────────────────────

  /** The recipe as it would be saved: what the page says, naming the layout the drone knows it by. */
  #doc(mount: Mount): RecipeDocument {
    const values = mount.page.recipe().values
    return mount.named ? { template: mount.named, values } : { values }
  }

  #schedule(mount: Mount): void {
    if (mount.readOnly) return
    if (mount.timer !== null) window.clearTimeout(mount.timer)
    mount.timer = window.setTimeout(() => {
      mount.timer = null
      void this.#save(mount)
    }, SAVE_DEBOUNCE_MS)
  }

  /** One save at a time: each waits for the one before it. */
  #save(mount: Mount): Promise<void> {
    mount.saving = mount.saving.then(() => this.#saveNow(mount)).catch(() => undefined)
    return mount.saving
  }

  /**
   * Save now what a pause would have saved, so leaving never loses a word.
   * Pictures still being kept are waited for first, a few seconds at most, so
   * they are saved with the recipe they were chosen for. A page going away
   * (`wait` false) cannot be made to wait: it saves what it has.
   */
  async #flush(mount: Mount | null = this.#mount, wait = true): Promise<void> {
    if (!mount) return
    if (wait && !mount.readOnly) {
      await Promise.race([
        mount.page.settled().catch(() => undefined),
        new Promise<void>(done => window.setTimeout(done, PICTURES_WAIT_MS)),
      ])
    }
    if (mount.timer !== null) {
      window.clearTimeout(mount.timer)
      mount.timer = null
    }
    await this.#save(mount)
  }

  async #saveNow(mount: Mount): Promise<void> {
    if (mount.readOnly) return
    const store = recipeTemplateStore()
    if (mount.layoutChanged) {
      // Arrange made a new layout: it is held under its own signature before the recipe names it.
      const layout = mount.template
      const held = await holdRecipeTemplate(store, layout)
      if (!held.ok) { this.#saveFailed(mount, held.reason); return }
      if (mount.template === layout) {
        mount.layoutChanged = false
        mount.shownSig = held.sig
      }
      mount.named = held.sig
    }
    // An unchanged recipe spends no history entry.
    if (!shouldCommitBody(recipeViewKey(this.#doc(mount)), mount.savedKey)) return
    if (!mount.named) {
      // The first save names the layout the recipe was written through.
      const held = await holdRecipeTemplate(store, mount.template)
      if (held.ok) mount.named = mount.shownSig = held.sig
    }
    const doc = this.#doc(mount)
    const saved = await saveRecipeAt(mount.segments, doc)
    if (!saved.ok) { this.#saveFailed(mount, saved.reason); return }
    mount.savedKey = recipeViewKey(doc)
    this.#say(mount, t('recipe.view.saved', 'Saved'), 'good')

    const was = { lit: mount.lit, empty: mount.empty }
    mount.empty = emptyDoc(doc)
    if (!mount.holds) {
      mount.holds = true
      this.#paintTiles(mount)
    }
    // In a room a lit recipe is an entry: what was just saved is what the room is owed.
    this.#roomStep(mount, was)
    this.#paintShared(mount)
  }

  #saveFailed(mount: Mount, reason: string): void {
    this.#say(mount, t('recipe.view.save-failed', 'Could not save: {reason}', { reason }), 'bad')
  }

  #say(mount: Mount, words: string, tone: 'plain' | 'good' | 'bad'): void {
    if (this.#mount === mount) mount.page.setStatus(words, tone)
  }

  /** "Keep as a template": the layout on the page goes on the cook's own list. */
  async #keepTemplate(mount: Mount): Promise<void> {
    const kept = await saveRecipeTemplate(recipeTemplateStore(), mount.template)
    if (kept.ok) this.#say(mount, t('recipe.view.kept', 'Kept as a template'), 'good')
    else this.#say(mount, t('recipe.view.keep-failed', 'Could not keep the template: {reason}', { reason: kept.reason }), 'bad')
  }

  /** The tile's name and cover are edited in the tile editor, over the grid
   *  the tile stands on: the recipe is saved and put away first. Choosing to
   *  go there outranks the way back in, so the spawn is dropped. */
  async #editTile(mount: Mount): Promise<void> {
    await this.#flush(mount)
    if (this.#mount !== mount) return
    const label = mount.segments[mount.segments.length - 1]
    this.#spawn = null
    this.#teardown()
    this.#vm()?.setMode(HEXAGONS)
    EffectBus.emit('tile:action', { action: 'edit', label, q: 0, r: 0, index: 0 })
  }

  // ── the table the desk sits on ─────────────────────────────────────────

  #tableMenu(): RecipeSettingMenu {
    const offered = [...this.#tableOffers.values()]
      .filter(offer => !this.#tableKept.some(kept => kept.sig === offer.sig))
      .map((offer): RecipeSettingChoice => ({ sig: offer.sig, name: offer.setting.name, from: 'community', host: offer.host }))
    return { choices: [...this.#tableKept, ...offered], current: this.#setting?.sig ?? '', asking: this.#tableAsking }
  }

  #paintTable(mount: Mount): void {
    if (this.#mount === mount) mount.page.setSettings(this.#tableMenu())
  }

  /**
   * The Table control opened: the kept sets from this device, then what the
   * domains this hive follows and has not switched off offer. Only the set
   * documents are asked for; nothing is kept until one is pressed.
   */
  async #openTable(mount: Mount): Promise<void> {
    const listing = await listRecipeSettings(recipeSettingStore())
    this.#tableKept = listing.entries.flatMap(entry => (entry.ok ? [{ sig: entry.sig, name: entry.setting.name, from: 'kept' as const }] : []))
    this.#paintTable(mount)
    if (this.#tableAsking || readOnlyShell()) return
    this.#tableAsking = true
    this.#paintTable(mount)
    try {
      const [zones, off] = await Promise.all([followedZones().catch((): string[] => []), readSourcesOff().catch((): string[] => [])])
      const offers = await findCommunityRecipeSettings(zones.filter(zone => !off.includes(zone)))
      this.#tableOffers = new Map(offers.map(offer => [offer.sig, offer]))
    } finally {
      this.#tableAsking = false
      this.#paintTable(mount)
    }
  }

  /** Lay the desk on a set held whole here (or on the drawn plate), and remember it. Answers whether it was remembered. */
  async #layTable(mount: Mount, setting: RecipeSetting | null): Promise<boolean> {
    const remembered = await writeRecipeDeskSetting(recipeSettingStore(), setting?.sig ?? '')
    if (this.#mount !== mount) return false
    this.#setting = setting
    mount.page.setSetting(setting)
    this.#paintTable(mount)
    if (!remembered) this.#say(mount, t('recipe.setting.unremembered', 'The table is laid, but this hive could not remember the choice.'), 'bad')
    return remembered
  }

  /** A set was chosen in the Table control, or none: the drawn plate. A domain's set is kept with its pictures first (T4). */
  async #chooseTable(mount: Mount, choice: RecipeSettingChoice | null): Promise<void> {
    if (this.#tableBusy) return
    this.#tableBusy = true
    try {
      if (!choice) { await this.#layTable(mount, null); return }
      const store = recipeSettingStore()
      let setting: RecipeSetting | null = null
      let reason = ''
      if (choice.from === 'community') {
        const offer = this.#tableOffers.get(choice.sig)
        if (!offer) return
        this.#say(mount, t('recipe.setting.bringing', 'Bringing the table set in'), 'plain')
        const kept = await takeCommunityRecipeSetting(store, offer)
        if (kept.ok) {
          setting = kept.setting
          if (!this.#tableKept.some(each => each.sig === kept.sig)) this.#tableKept.push({ sig: kept.sig, name: kept.setting.name, from: 'kept' })
        } else reason = kept.reason
      } else {
        const read = await readRecipeSetting(store, choice.sig)
        if (!read.ok) reason = read.reason
        else if (!await recipeSettingHeld(store, read.setting)) reason = t('recipe.setting.reason.unheld', 'its pictures are not all held here')
        else setting = read.setting
      }
      if (this.#mount !== mount) return
      if (!setting) {
        this.#say(mount, t('recipe.setting.failed', 'Could not lay that table set: {reason}', { reason }), 'bad')
        return
      }
      if (await this.#layTable(mount, setting) && choice.from === 'community') this.#say(mount, t('recipe.setting.kept-now', 'Table set kept'), 'good')
    } finally {
      this.#tableBusy = false
    }
  }

  /** "Add a table set": a render's setting.json and its pictures, brought in, kept, and laid. */
  async #addTable(mount: Mount, files: readonly File[]): Promise<void> {
    if (this.#tableBusy) return
    this.#tableBusy = true
    try {
      this.#say(mount, t('recipe.setting.bringing', 'Bringing the table set in'), 'plain')
      const kept = await importRecipeSetting(files)
      if (this.#mount !== mount) return
      if (!kept.ok) {
        this.#say(mount, t('recipe.setting.add-failed', 'Could not add the table set: {reason}', { reason: kept.reason }), 'bad')
        return
      }
      if (!this.#tableKept.some(each => each.sig === kept.sig)) this.#tableKept.push({ sig: kept.sig, name: kept.setting.name, from: 'kept' })
      if (await this.#layTable(mount, kept.setting)) this.#say(mount, t('recipe.setting.added', 'Table set added'), 'good')
    } finally {
      this.#tableBusy = false
    }
  }

  /**
   * A kept set's remove press: it is taken off this hive's list (hidden, its
   * bytes and pictures stay: H4), so a full list always has room made in it.
   * Taking off the set the desk sits on lays the drawn plate.
   */
  async #removeTable(mount: Mount, choice: RecipeSettingChoice): Promise<void> {
    if (this.#tableBusy || choice.from !== 'kept') return
    this.#tableBusy = true
    try {
      const forgot = await forgetRecipeSetting(recipeSettingStore(), choice.sig)
      if (this.#mount !== mount) return
      if (!forgot.ok) {
        this.#say(mount, t('recipe.setting.remove-failed', 'Could not take {name} off your table sets: {reason}', { name: choice.name, reason: forgot.reason }), 'bad')
        return
      }
      this.#tableKept = this.#tableKept.filter(each => each.sig !== choice.sig)
      // The desk sat on it: the drawn plate is laid, and a choice that could not be remembered is what is said.
      if (this.#setting?.sig === choice.sig) { if (!await this.#layTable(mount, null)) return } else this.#paintTable(mount)
      if (this.#mount === mount) this.#say(mount, t('recipe.setting.removed', '{name} is off your table sets', { name: choice.name }), 'good')
    } finally {
      this.#tableBusy = false
    }
  }

  // ── the template picker ────────────────────────────────────────────────

  #sources(picker: Picker): RecipeViewSources {
    return { defaults: this.#defaults, kept: picker.kept, zones: picker.zones, offers: picker.offers }
  }

  #openPicker(): void {
    const mount = this.#mount
    if (!mount || this.#picker) return
    const picker: Picker = {
      handle: null, mount, community: !mount.readOnly,
      kept: [], zones: [], query: '', typed: '',
      offers: new Map(), asking: new Set(), picking: false,
      off: () => undefined,
    }
    picker.handle = recipePicker({
      say: t,
      current: mount.shownSig || mount.named,
      groups: this.#groups(picker),
      onPick: sig => { void this.#pick(picker, sig) },
      onQuery: query => this.#typed(picker, query),
      ...(picker.community ? { onForget: (sig: string) => { void this.#forget(picker, sig) } } : {}),
      onClose: () => this.#closePicker(),
    })
    // Inside the host, so it covers the page and leaves the domain shelf in view above it.
    picker.handle.element.style.position = 'absolute'
    mount.host.append(picker.handle.element)
    this.#picker = picker
    picker.handle.focus()
    void this.#readKept(picker)
    if (!picker.community) return
    EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: RECIPE_PICKER_OWNER, wanted: true })
    // State, not a command: the replay on subscribe is which domains are on right now.
    picker.off = EffectBus.on<SourcesState>(SOURCES_CHANGED, state => this.#onSources(picker, state))
  }

  #closePicker(): void {
    const picker = this.#picker
    if (!picker) return
    this.#picker = null
    picker.off()
    // Taken down here, or the page under it stays deaf to its own keys.
    picker.handle?.dispose()
    if (!picker.community) return
    EffectBus.emitTransient<DomainShelfWanted>(DOMAIN_SHELF_WANTED, { owner: RECIPE_PICKER_OWNER, wanted: false })
    // The pool is no longer on screen: the chips stop counting it.
    if (picker.offers.size) EffectBus.emit<SourcesCounted>(SOURCES_COUNTED, { meaning: RECIPE_TEMPLATE_MEANING, counts: {} })
  }

  #groups(picker: Picker): ReturnType<typeof recipeViewPickerGroups> {
    return recipeViewPickerGroups(this.#sources(picker), picker.query, {
      builtIn: t('recipe.picker.built-in', 'Built in'),
      yours: t('recipe.picker.yours', 'Yours'),
    })
  }

  /** Show the picker what it now has. `query` is passed only to put the shelf's words in its field. */
  #paint(picker: Picker, query?: string): void {
    if (this.#picker !== picker) return
    picker.handle?.update({
      groups: this.#groups(picker),
      current: picker.mount.shownSig || picker.mount.named,
      loading: picker.asking.size > 0,
      ...(query !== undefined ? { query } : {}),
    })
  }

  /** The templates on the cook's own list, read from this device. */
  async #readKept(picker: Picker): Promise<void> {
    const listing = await listRecipeTemplates()
    picker.kept = listing.entries.flatMap(entry => (entry.ok ? [{ sig: entry.sig, template: entry.template }] : []))
    this.#paint(picker)
  }

  /** The domain shelf said which domains are on and what is searched for. */
  #onSources(picker: Picker, state: SourcesState | undefined): void {
    if (this.#picker !== picker) return
    picker.zones = recipeViewZones(names(state?.zones))
    const query = recipeViewQuery(typeof state?.query === 'string' ? state.query : '')
    // Words typed into the picker come back in the shelf's form: the field is
    // rewritten only when the words were typed somewhere else.
    const elsewhere = query !== recipeViewQuery(picker.typed)
    picker.query = query
    if (elsewhere) picker.typed = query
    this.#paint(picker, elsewhere ? query : undefined)
    void this.#ask(picker)
  }

  /** The picker's own search: the shelf's field and this one stay one. */
  #typed(picker: Picker, query: string): void {
    picker.typed = query
    if (picker.community) EffectBus.emitTransient(SOURCES_QUERY, { query })
  }

  /** Ask each domain that is on and not asked yet what it offers. Every read
   *  is bounded and verified by the reader it stands on (pools/offered-pool.ts);
   *  what comes back is held in the picker only, and kept nowhere. */
  async #ask(picker: Picker): Promise<void> {
    const wanted = picker.zones.filter(zone => !picker.offers.has(zone) && !picker.asking.has(zone))
    if (!wanted.length) return
    for (const zone of wanted) picker.asking.add(zone)
    this.#paint(picker)
    await mapBounded(wanted, ZONES_AT_ONCE, async zone => {
      const offered = await findCommunityRecipeTemplates([zone])
      picker.asking.delete(zone)
      picker.offers.set(zone, offered)
      if (this.#picker !== picker) return
      EffectBus.emit<SourcesCounted>(SOURCES_COUNTED, { meaning: RECIPE_TEMPLATE_MEANING, counts: recipeViewCounts(picker.offers) })
      this.#paint(picker)
    })
  }

  async #pick(picker: Picker, sig: string): Promise<void> {
    const mount = picker.mount
    if (this.#picker !== picker || picker.picking) return
    const picked = recipeViewPick(sig, this.#sources(picker))
    if (!picked) return
    if (mount.readOnly) {
      // A visitor looks through another layout. Nothing is held, named or saved.
      if (picked.from === 'domain') return
      this.#closePicker()
      mount.template = picked.template
      mount.shownSig = picked.sig
      mount.page.setTemplate(picked.template)
      return
    }

    picker.picking = true
    const store = recipeTemplateStore()
    let use: RecipeViewTemplate | null = null
    let reason = ''
    if (picked.from === 'domain') {
      // The press is the yes (T4): kept by the maker's own bytes, before it is anyone's layout.
      const kept = await keepRecipeTemplate(store, picked.offer.bytes, picked.offer.sig)
      if (kept.ok) use = { sig: kept.sig, template: picked.offer.template }
      else reason = kept.reason
    } else if (picked.from === 'built-in') {
      // Held, so the signature the recipe is about to name resolves.
      const held = await holdRecipeTemplate(store, picked.template)
      if (held.ok) use = { sig: held.sig, template: picked.template }
      else reason = held.reason
    } else {
      // Already held under the signature it was kept by: writing it again could spell another.
      const read = await readRecipeTemplate(store, picked.sig)
      if (read.ok) use = { sig: read.sig, template: read.template }
      else reason = read.reason
    }
    picker.picking = false
    if (this.#mount !== mount) return

    this.#closePicker()
    if (!use) {
      this.#say(mount, t('recipe.view.template-failed', 'Could not use that template: {reason}', { reason }), 'bad')
      return
    }
    mount.template = use.template
    mount.shownSig = mount.named = use.sig
    mount.layoutChanged = false
    mount.page.setTemplate(use.template)
    await this.#flush(mount)
  }

  /** "Take off my list": hidden from the list, its bytes stay (H4). */
  async #forget(picker: Picker, sig: string): Promise<void> {
    const done = await forgetRecipeTemplate(recipeTemplateStore(), sig)
    if (!done.ok) {
      this.#say(picker.mount, t('recipe.view.forget-failed', 'Could not take it off your list: {reason}', { reason: done.reason }), 'bad')
      return
    }
    picker.kept = picker.kept.filter(entry => entry.sig !== sig)
    this.#paint(picker)
  }

  // ── leaving ────────────────────────────────────────────────────────────

  /** One step back: the picker when it is up, else the page. */
  #back(): void {
    if (this.#picker) this.#closePicker()
    else void this.#exit()
  }

  /** The page's own close obeys the arrival-face rule the right button does.
   *  Saved first, because an arrival-face back navigates and never peels. */
  async #backOut(): Promise<void> {
    await this.#flush()
    const vm = this.#vm()
    if (!vm || vm.mode !== RECIPE_VIEW) return
    const peel = (): void => {
      this.#teardown()
      vm.setMode(HEXAGONS)
    }
    const gesture = live<BackGesture>('@diamondcoreprocessor.com/BackGesture')
    if (gesture?.backOutOfView) gesture.backOutOfView(peel)
    else peel()
  }

  async #exit(): Promise<void> {
    await this.#flush()
    this.#teardown()
    this.#vm()?.setMode(HEXAGONS)
  }

  /** Nothing to show here: back to the hexagons, holding no surface. */
  #leave(): void {
    this.#target = null
    this.#vm()?.setMode(HEXAGONS)
  }

  async #teardownSaving(): Promise<void> {
    await this.#flush()
    this.#teardown()
  }

  /** Take the page down. `keepChrome`: another page of this view goes up in the same breath, so the hive's chrome and keys stay as they are. */
  #teardown(keepChrome = false): void {
    this.#closePicker()
    const mount = this.#mount
    if (mount) {
      if (mount.timer !== null) window.clearTimeout(mount.timer)
      mount.page.dispose()
      mount.host.remove()
      this.#mount = null
      if (!keepChrome) EffectBus.emitTransient('keymap:release', { reason: RECIPE_VIEW_OWNER })
    }
    if (!keepChrome) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    // Owner-counted, never a raw boolean: something closing on top of the
    // recipe must not unhide the chrome while the recipe is still open.
    const modes = live<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', RECIPE_VIEW_OWNER)
    else modes?.exit('view:active', RECIPE_VIEW_OWNER)
  }
}

window.ioc.register('@diamondcoreprocessor.com/RecipeViewDrone', new RecipeViewDrone())

// THE BEE WIRES: the slot is declared by the behaviour that reads and writes it.
window.ioc.whenReady<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry', slots => slots.register(RECIPE_SLOT_DECLARATION))
