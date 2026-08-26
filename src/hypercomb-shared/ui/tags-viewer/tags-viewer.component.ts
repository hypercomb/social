// hypercomb-shared/ui/tags-viewer/tags-viewer.component.ts
//
// Right-docked "Tags" panel — the management view for the tag system. Opened
// by the `/tags` command (`tags:view-open`). Lists every tag the participant
// knows (the global TagRegistry ∪ whatever is on the current page), each with:
//   • a colour swatch that doubles as a recolour control,
//   • the count of currently-visible tiles carrying it,
//   • a filter toggle (drives the same cross-page tag flatten as the
//     controls-bar pills, via `tags:filter`),
//   • a remove control, which ARMS a staged removal rather than acting at once
//     (see below).
//
// ── Staged removal ────────────────────────────────────────────────────────
// Removing a keyword used to be one-way and invisible: the × dropped the tag
// from the master registry while every tile kept its decoration, and there was
// no UI path to take a keyword back off the tiles. Now the × arms a removal:
// the hive filters to that keyword (so every tile carrying it is on screen),
// clicking a tile stages it — the tile paints struck-through and the panel's
// list grows — and only then does Remove commit. Cancel throws it away; the
// hive was never written to.
//
// This panel owns the review surface (the list + the two buttons); the staging
// itself lives in TagRemovalDrone (essentials), which resolves each staged
// tile's location and splices the decoration on commit. `tags:removal-pending`
// is the shared truth between the two, and the renderer marks the same set.
//
// ── The bouquet in hand, and the shaded hive ──────────────────────────────
// Putting pheromones ON tiles is one gesture now: gather the pheromones you
// want (＋ on each row, or click a saved bouquet), and the hive itself becomes
// the review surface — every tile already wearing the WHOLE set stays lit,
// every tile missing any of it shades out, and clicking a shaded tile scents
// it at once (an immediate write, like a drop — the shade already showed
// exactly what the click would do). Lit tiles stay ordinary ground: clicking
// one walks in as always, so you can keep moving while marking. This replaced
// the painter/collecting-walk (a staged ctrl+click grouping with a Done
// commit): the shade IS the staging review, so the ceremony went.
//
// WHAT IS IN HAND IS ALWAYS A BOUQUET — a bee never emits one compound, and
// neither do you. One mark or six, the gathered set has an identity from the
// first mark (bouquet-registry.ts derives it), before anyone decides to name
// it. Naming is a separate, later act — it commits the bytes and makes the
// bouquet easy to pick up again. Saved bouquets list below the pheromones;
// clicking one takes it in hand, and a bouquet is just another pheromone to
// the drag — pull it onto a tile and the whole set lands there.
//
// Shell UI, so it must NOT import essentials — it reads the TagRegistry and
// emits tag effects over IoC / EffectBus, exactly like the controls bar. Tag
// names come from `tags:registry` (the registry's broadcast) and counts from
// `render:tags` (show-cell's per-page aggregation); both are sticky on the bus
// so a freshly-opened panel hydrates immediately.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { NgTemplateOutlet } from '@angular/common'
import { ChangeDetectorRef, Component, computed, ElementRef, inject, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { onSelection } from '../../core/selection-context'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { type WindowSession } from '@hypercomb/core'
import { PHONE_QUERY, isPhoneViewport } from '@hypercomb/core'
import { bouquetMatchesQuery, filterNamespaceGroups, filterRowsByQuery, looseMarks, namespaceGroupsOf } from './tag-grouping'

interface TagRow {
  name: string
  color: string
  count: number
}

/** How wide a pheromone filter reaches. Mirrors the controls-bar / show-cell
 *  vocabulary exactly — this is the same value that rides `tags:filter`. */
type Scope = 'local' | 'children' | 'global'

/** Movement before a press on a pheromone row counts as a drag rather than a
 *  click — small enough to feel immediate, large enough that a click that
 *  jitters still filters. */
const DRAG_THRESHOLD = 5

/** A named group of pheromones — the brush's picked set, saved. See
 *  bouquet-registry.ts for why that is the word. */
interface BouquetRow {
  name: string
  sig: string
  marks: string[]
  /** Its marks as full rows, so an opened bouquet offers exactly what the loose
   *  list offers — same swatch, count, gather and remove controls. A bouquet is
   *  a way of ORGANISING the vocabulary, not a second, weaker view of it. */
  rows: TagRow[]
}

/** A namespace group — every mark whose name is prefixed `<namespace>:`.
 *
 *  These are NOT bouquets and must never be confused with them. A bouquet is
 *  gathered on purpose and carries a name someone chose; a namespace is
 *  DERIVED from the mark's own spelling (`visual:website:page` → `visual`) and
 *  nobody curates it. Behaviours mint these to say what a tile IS, so they
 *  group themselves — which is precisely why they are collapsed by default and
 *  kept out of the loose list: hand-filing them would be curating a set the
 *  system already names. */
interface NamespaceGroup {
  name: string
  rows: TagRow[]
}

type TagEntry = { color?: string; enabled?: boolean; accent?: string }
type TagRegistryLike = {
  ensureLoaded(): Promise<void>
  all: Record<string, TagEntry>
  color(name: string): string
  add(name: string, color?: string): Promise<void>
  remove(name: string): Promise<void>
}

type BouquetLike = { name: string; sig: string; marks: string[] }
type BouquetRegistryLike = {
  ensureLoaded(): Promise<void>
  all: BouquetLike[]
  signatureOf(marks: readonly string[]): Promise<string | null>
  save(name: string, marks: readonly string[]): Promise<string | null>
  remove(name: string): Promise<void>
}

@Component({
  selector: 'hc-tags-viewer',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './tags-viewer.component.html',
  styleUrls: ['./tags-viewer.component.scss'],
})
export class TagsViewerComponent implements OnDestroy {

  readonly visible = signal(false)

  /** Put away while the hive needs the edge. Only the showing stops: a staged
   *  removal or an armed brush stays armed, where `close()` disarms them.
   *
   *  Built by hand rather than with `signalSession` for ONE reason — the park
   *  has to be distinguishable from a close ON THE WIRE. Both announce
   *  `open:false`, and the drone that owns the tile-side brush cannot read our
   *  intent from that alone, so it disarmed on either and the promise above was
   *  quietly broken for every park the shell made (lane eviction, a rail flyout,
   *  the installer). `parked:true` is the whole fix; the drone leaves an armed
   *  brush alone when it sees it. */
  readonly session: WindowSession = {
    park: () => {
      // Parked rows never get their pointerleave (see endPreview at close()).
      this.endPreview()
      this.visible.set(false)
      EffectBus.emit('tags:view-state', { open: false, parked: true })
    },
    unpark: () => {
      this.visible.set(true)
      EffectBus.emit('tags:view-state', { open: true })
    },
    dismiss: () => this.dismiss(),
    close: () => this.close(),
    // The palette is not a window — it is the PAINT. Every other tool window
    // is put away when one opens; this one may stay beside it, because a mark
    // is applied by dragging FROM here ONTO what is open (a note in the notes
    // window, a tile on the canvas). See window-rule.ts.
    companion: true,
  }

  /** Per-page tag counts, last value from `render:tags`. */
  readonly #counts = signal<Map<string, number>>(new Map())
  /** Registry version bump — forces `rows` to re-read the registry. */
  readonly #registryVersion = signal(0)
  /** Active tag filters (mirrors `tags:filter` so the panel and the
   *  controls-bar pills agree on what's filtered). */
  readonly #active = signal<Set<string>>(new Set())
  /** How wide a filter reaches. This panel is the control surface for it — the
   *  controls-bar glyph used to cycle it blind. Mirrors `tags:filter`, so bar
   *  and panel can never disagree. Non-sticky, same as the bar. */
  readonly #scope = signal<Scope>('local')

  /** The keyword whose removal is armed, or null. Mirrors
   *  `tags:removal-pending` so the panel can never disagree with the renderer
   *  about what is staged. */
  readonly #removalTag = signal<string | null>(null)
  /** Tiles staged to lose that keyword — the list that grows as you click. */
  readonly #removalCells = signal<string[]>([])
  /** The pheromones gathered into the bouquet in hand. Gathering IS arming —
   *  the moment anything is picked, the hive shades what is missing it. */
  readonly #selected = signal<Set<string>>(new Set())
  /** The keywords currently armed. Mirrors `tags:apply-pending`
   *  (PheromoneTilesDrone). Scenting and removal are the two takeovers of the
   *  tile click, mutually exclusive so they never fight over the same tap. */
  readonly #applyTags = signal<string[]>([])

  /** The search over the vocabulary — ONE field, filtering bouquets, loose
   *  keywords and namespace groups alike. The whole lens: no type chips, no
   *  tag cloud — the search is good enough. View state, never truth. */
  readonly query = signal('')

  /** What is being dragged onto the hive, or null — one pheromone or a whole
   *  bouquet (`count` says which). Drives the ghost chip that follows the
   *  cursor — the drag IS the gesture, so it has to be visible the whole way
   *  from the list to the tile. */
  readonly #dragging = signal<{ name: string; color: string; count: number } | null>(null)
  readonly #dragPos = signal<{ x: number; y: number }>({ x: 0, y: 0 })

  /** Saved bouquets, mirrored from `bouquets:registry`. */
  readonly #bouquets = signal<BouquetLike[]>([])
  /** The naming field is open (the bouquet in hand is being given a name). */
  readonly #naming = signal(false)
  /** The signature of the bouquet in hand. Derived the moment anything is
   *  picked — the gathered set IS a bouquet, named or not — so the identity is
   *  never something a later Save has to invent. */
  readonly #bouquetSig = signal<string | null>(null)

  readonly scope = this.#scope.asReadonly()
  readonly removalTag = this.#removalTag.asReadonly()
  readonly painting = computed(() => this.#applyTags().length > 0)
  readonly selectedNames = computed(() => [...this.#selected()].sort((a, b) => a.localeCompare(b)))
  /** The picked set as swatch+name pairs — a pheromone reads the same here as
   *  in the list row, the drag ghost and the on-tile card: square, then label. */
  readonly selectedChips = computed(() => {
    this.#registryVersion()
    const registry = this.#registry()
    return this.selectedNames().map(name => ({ name, color: this.#colorOf(name, registry) }))
  })
  readonly selectedCount = computed(() => this.#selected().size)
  readonly dragging = this.#dragging.asReadonly()
  readonly dragPos = this.#dragPos.asReadonly()
  readonly removalCells = this.#removalCells.asReadonly()
  readonly removalCount = computed(() => this.#removalCells().length)
  readonly naming = this.#naming.asReadonly()
  /** The identity of the bouquet in hand, shortened. Shown because it is the
   *  proof that a bouquet exists before it has a name — and because two people
   *  who gather the same marks will see the same one. */
  readonly bouquetShortSig = computed(() => this.#bouquetSig()?.slice(0, 8) ?? '')
  /** The bouquets as rows, each mark carrying its own colour and count. */
  readonly bouquets = computed<BouquetRow[]>(() => {
    const byName = new Map(this.rows().map(r => [r.name, r]))
    const registry = this.#registry()
    return this.#bouquets().map(b => ({
      ...b,
      // A mark can sit in a bouquet without being on any tile yet (or without
      // being in the registry at all), so a missing row is synthesised at zero
      // rather than dropped — a bouquet must show everything it holds.
      rows: b.marks.map(name => byName.get(name)
        ?? { name, color: this.#colorOf(name, registry), count: 0 }),
    }))
  })
  /** Is the picked set exactly this bouquet? Marks the row that is loaded, and
   *  is why saving the same set twice under one name is a no-op rather than a
   *  duplicate — the bouquet's identity is its (sorted) contents. */
  readonly loadedBouquet = computed(() => {
    const picked = this.selectedNames().join('\u0000')
    if (!picked) return null
    return this.bouquets().find(b => [...b.marks].sort((a, c) => a.localeCompare(c)).join('\u0000') === picked)?.name ?? null
  })

  readonly activeNames = computed(() => [...this.#active()].sort((a, b) => a.localeCompare(b)))
  readonly hasFilter = computed(() => this.#active().size > 0)

  /** The three reaches in cycle order — the toggle's walk, and each stage's
   *  glyph. Same ids and glyphs as every other reach control. */
  readonly scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'blur_on' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]

  /** The glyph for the reach currently in force — the toggle's readout. */
  readonly scopeIcon = computed(() => this.scopeOptions.find(o => o.id === this.#scope())!.icon)

  /** Sorted tag rows: every registry tag plus any page tag not yet registered,
   *  each with its colour and current visible count. */
  readonly rows = computed<TagRow[]>(() => {
    this.#registryVersion()
    const counts = this.#counts()
    const registry = this.#registry()
    const names = new Set<string>()
    if (registry) for (const n of Object.keys(registry.all)) names.add(n)
    for (const n of counts.keys()) names.add(n)
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ name, color: this.#colorOf(name, registry), count: counts.get(name) ?? 0 }))
  })

  readonly totalTags = computed(() => this.rows().length)

  // ── how the vocabulary is ORGANISED ─────────────────────────────────────────
  //
  // One flat alphabetical list stopped being readable the moment marks started
  // arriving from three different places: ones you gathered, ones you typed
  // once, and ones behaviours mint to say what a tile IS. The rule for which
  // part a mark lands in lives in tag-grouping.ts — it is a doctrine, not a
  // layout detail, and it is tested there without an Angular harness.

  /** Every mark held by at least one saved bouquet. */
  readonly #gathered = computed(() => {
    const held = new Set<string>()
    for (const b of this.#bouquets()) for (const m of b.marks) held.add(m)
    return held
  })

  /** Plain keywords nobody has gathered yet — the fallback list. */
  readonly looseRows = computed(() => looseMarks(this.rows(), this.#gathered()))

  /** Namespaced marks, grouped by their prefix. Complete by construction: a
   *  namespaced mark appears here whether or not it is also in a bouquet. */
  readonly namespaceGroups = computed<NamespaceGroup[]>(() => namespaceGroupsOf(this.rows()))

  // ── the search ──────────────────────────────────────────────────────────────
  //
  // One field over the whole vocabulary — bouquets, loose keywords, namespace
  // groups alike. Pure view state: nothing here writes, arms or filters the
  // hive. The matching rules live in tag-grouping.ts beside the grouping
  // doctrine, tested there.

  readonly searching = computed(() => this.query().trim().length > 0)

  /** A bouquet matches on its own name OR any mark it holds — searching for a
   *  keyword must surface the bouquets that would land it. */
  readonly visibleBouquets = computed<BouquetRow[]>(() =>
    this.bouquets().filter(b => bouquetMatchesQuery(b.name, b.marks, this.query())))

  readonly visibleLooseRows = computed<TagRow[]>(() =>
    filterRowsByQuery(this.looseRows(), this.query()))

  readonly visibleNamespaceGroups = computed<NamespaceGroup[]>(() =>
    filterNamespaceGroups(this.namespaceGroups(), this.query()))

  /** The search left nothing — the state that needs its own line, or the
   *  panel reads as having lost the data. */
  readonly nothingVisible = computed(() =>
    this.rows().length > 0
    && this.visibleBouquets().length === 0
    && this.visibleLooseRows().length === 0
    && this.visibleNamespaceGroups().length === 0)

  /** Which bouquets are opened to show their marks, and which namespace groups
   *  are unfolded. Both view state, both closed by default — the panel opens as
   *  a short list of names, and you unfold what you came for. */
  readonly #openBouquets = signal<Set<string>>(new Set())
  readonly #openNamespaces = signal<Set<string>>(new Set())

  isBouquetOpen(name: string): boolean { return this.#openBouquets().has(name) }
  /** A search reaches INSIDE the folded groups, so while one is running every
   *  surviving group stands open — its matches are the whole reason it is
   *  still listed. Clearing the search folds them back as they were. */
  isNamespaceOpen(name: string): boolean { return this.searching() || this.#openNamespaces().has(name) }

  toggleBouquetOpen(name: string, event?: Event): void {
    event?.stopPropagation()
    this.#openBouquets.update(s => {
      const next = new Set(s)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  toggleNamespaceOpen(name: string): void {
    this.#openNamespaces.update(s => {
      const next = new Set(s)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  /** Canvas-selection response (documentation/selection-tool-windows.md) —
   *  distinct from `#selected`, which is this panel's own picked keywords.
   *  While the brush is armed and tiles are selected on the canvas, one press
   *  stages every selected tile — instead of clicking each one. */
  readonly #canvasSelection = signal<readonly string[]>([])
  readonly canvasSelectionCount = computed(() => this.#canvasSelection().length)

  #cleanups: (() => void)[] = []

  // The shell is ZONELESS, so a signal written from a plain `document` pointer
  // listener or an EffectBus callback does not schedule a render on its own —
  // the drag ghost stuck on screen and the per-tag counts went stale after a
  // drop until some Angular-bound event happened to tick. Same remedy the other
  // bus-driven panels use (see format-painter): flush this view explicitly.
  readonly #cdr = inject(ChangeDetectorRef)
  readonly #host = inject(ElementRef) as ElementRef<HTMLElement>
  #flush(): void {
    try { this.#cdr.detectChanges() } catch { /* view already destroyed */ }
  }

  constructor() {
    this.#phoneQuery?.addEventListener('change', this.#phoneHandler)
    this.#cleanups.push(onSelection(({ selected }) => {
      this.#canvasSelection.set(selected)
      this.#cdr.markForCheck()
    }))
    this.#cleanups.push(EffectBus.on('tags:view-open', () => {
      void this.#registry()?.ensureLoaded().then(() => this.#registryVersion.update(v => v + 1))
      void this.#bouquetRegistry()?.ensureLoaded()
      this.#registryVersion.update(v => v + 1)
      this.visible.set(true)
      // Broadcast open-state (last-value replayed) so the header toggle lights.
      EffectBus.emit('tags:view-state', { open: true })
    }))
    this.#cleanups.push(EffectBus.on('tags:view-close', () => this.close()))

    // Sticky: last per-page counts replay on subscribe.
    this.#cleanups.push(EffectBus.on<{ tags: { name: string; count: number }[] }>('render:tags', (p) => {
      const map = new Map<string, number>()
      for (const t of p?.tags ?? []) if (t?.name) map.set(t.name, t.count ?? 0)
      this.#counts.set(map)
      this.#flush()
    }))

    // Saved bouquets (sticky) — the BouquetRegistry owns them, this panel
    // renders them and hands one back to the brush on click.
    this.#cleanups.push(EffectBus.on<{ bouquets?: BouquetLike[] }>('bouquets:registry', (p) => {
      this.#bouquets.set(Array.isArray(p?.bouquets) ? [...p.bouquets] : [])
      this.#flush()
    }))

    // Registry changed (add / recolor / remove) → re-read.
    this.#cleanups.push(EffectBus.on('tags:registry', () => {
      this.#registryVersion.update(v => v + 1)
      this.#flush()
    }))

    // Mirror the active filter set AND the reach (sticky) so the toggles
    // reflect whatever the controls-bar pills set, and vice-versa.
    this.#cleanups.push(EffectBus.on<{ active: string[]; scope?: Scope }>('tags:filter', (p) => {
      this.#active.set(new Set(Array.isArray(p?.active) ? p.active : []))
      if (p?.scope) this.#scope.set(p.scope)
    }))

    // Staging state (sticky): the drone is the owner, this panel renders it.
    this.#cleanups.push(EffectBus.on<{ tag: string | null; cells: string[]; active: boolean }>(
      'tags:removal-pending', (p) => {
        this.#removalTag.set(p?.active ? (p.tag ?? null) : null)
        this.#removalCells.set(Array.isArray(p?.cells) ? [...p.cells] : [])
        this.#flush()
      },
    ))

    // Which tile the cursor is over — the drop target for a dragged pheromone
    // when the pointer is on the hive rather than on a tile's own card.
    this.#cleanups.push(EffectBus.on<{ label?: string | null }>('tile:hover', (p) => {
      this.#hoverLabel = p?.label ?? null
    }))

    // Armed state (sticky): PheromoneTilesDrone owns it, this panel reflects
    // which keywords are in hand. When the drone puts the bouquet down (a
    // selection commit finished, an Escape out on the hive, a close), the
    // gathered set here follows the truth — a picked-but-disarmed panel would
    // show marks the hive is no longer shading for.
    this.#cleanups.push(EffectBus.on<{ tag?: string | null; tags?: string[]; cells?: string[]; active: boolean }>(
      'tags:apply-pending', (p) => {
        const armed = p?.active === true
        const tags = armed
          ? (Array.isArray(p?.tags) && p.tags.length ? p.tags : (p?.tag ? [p.tag] : []))
          : []
        this.#applyTags.set([...tags])
        if (!armed && this.#selected().size > 0) {
          this.#selected.set(new Set())
          this.#bouquetSig.set(null)
          this.#naming.set(false)
        }
        this.#flush()
      },
    ))
  }

  ngOnDestroy(): void {
    // A row that is torn down never gets its pointerleave, so the hive would
    // hold the preview forever.
    this.endPreview()
    for (const c of this.#cleanups) c()
    this.#phoneQuery?.removeEventListener('change', this.#phoneHandler)
  }

  #registry(): TagRegistryLike | undefined {
    return get('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
  }

  #bouquetRegistry(): BouquetRegistryLike | undefined {
    return get('@hypercomb.social/BouquetRegistry') as BouquetRegistryLike | undefined
  }

  #colorOf(name: string, registry: TagRegistryLike | undefined): string {
    const c = registry?.color(name)
    if (c) return c
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    return '#7eb6d6'
  }

  // ── drag a pheromone (or a bouquet) onto a tile ────────────────────
  //
  // The direct-manipulation path: pick the pheromone up out of the list and
  // drop it on the tile you mean. A bouquet is just another pheromone to this
  // gesture — dragging its row carries every mark it holds, and the drop lands
  // the whole set. Pointer events (not HTML5 drag-and-drop), because the drop
  // target is a WebGL canvas with no DOM nodes to land on — the tile under the
  // cursor is whatever `tile:hover` last reported, and a drop onto a tile's
  // own pheromone card resolves via `data-pheromone-tile`.
  //
  // A press only becomes a drag past DRAG_THRESHOLD px, so clicking the name
  // still filters (or loads the bouquet); the trailing click is swallowed when
  // a drag did happen.

  /** Candidate press, promoted to a real drag once the pointer moves far enough. */
  #pending: { marks: string[]; name: string; color: string; x: number; y: number } | null = null
  /** A drag just ended — swallow the click it would otherwise fire. */
  #swallowClick = false
  /** Tile currently under the cursor, mirrored from `tile:hover`. */
  #hoverLabel: string | null = null

  /** Phone-shaped viewport — small in EITHER dimension (a phone on its side is
   *  wide but short). One spelling, shared with the lane (breakpoints.ts).
   *
   *  Public and a SIGNAL because the template binds it: on a phone this panel
   *  is a full-bleed sheet, and a sheet has no business holding a place in the
   *  lane or an offset it ignores. */
  readonly isPhone = signal(isPhoneViewport())

  #isPhone(): boolean { return this.isPhone() }

  /** Keep the sheet-mode signal current — rotating a phone crosses the
   *  threshold in both directions, and a lane place held by a full-bleed sheet
   *  is a place nothing can use. */
  readonly #phoneQuery = typeof window !== 'undefined' ? window.matchMedia(PHONE_QUERY) : null
  readonly #phoneHandler = (e: MediaQueryListEvent): void => { this.isPhone.set(e.matches) }

  onRowPointerDown(event: PointerEvent, row: TagRow): void {
    this.#beginDragCandidate(event, [row.name], row.name, row.color)
  }

  /** A bouquet drags exactly like a single pheromone — the whole set rides the
   *  ghost and the drop lands all of it. */
  onBouquetPointerDown(event: PointerEvent, bouquet: BouquetRow): void {
    this.#beginDragCandidate(event, bouquet.marks, bouquet.name, this.bouquetColor(bouquet))
  }

  #beginDragCandidate(event: PointerEvent, marks: readonly string[], name: string, color: string): void {
    if (event.button !== 0) return
    // Drag-to-scent is a POINTER affordance and is switched off on phones.
    // Leaving it armed here would be actively harmful: on touch, dragging a row
    // IS the scroll gesture, so scrolling this list past the drag threshold
    // would drop a pheromone onto whatever tile sits underneath.
    if (this.#isPhone()) return
    const clean = marks.filter(Boolean)
    if (clean.length === 0) return
    this.#pending = { marks: [...clean], name, color, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    // If the browser takes the gesture (a native drag, a touch pan), we get a
    // pointercancel and NEVER a pointerup — without this the ghost would hang
    // on screen and the listeners would leak until the next drag.
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragCancel = (): void => {
    this.#pending = null
    this.#detachDrag()
    if (this.#dragging()) {
      this.#dragging.set(null)
      EffectBus.emit('drop:dragging', { active: false })
      this.#flush()
    }
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging()) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      // Promote to a drag. `drop:dragging` puts the tile overlay into its bare
      // drop-target mode (icons hidden) — the same mode file drops use — so the
      // hive reads as a surface to land on rather than a menu. The MARKS ride
      // along: show-cell shades every tile that doesn't already wear the whole
      // dragged set for as long as the drag lasts, so where the drop would DO
      // something is visible before anything is released — the same shade the
      // armed bouquet wears, with no messaging anywhere.
      this.#dragging.set({ name: p.name, color: p.color, count: p.marks.length })
      EffectBus.emit('drop:dragging', { active: true, marks: [...p.marks], color: p.color })
    }
    this.#dragPos.set({ x: event.clientX, y: event.clientY })
    this.#flush()
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.#dragging() !== null
    this.#pending = null
    this.#detachDrag()
    if (!wasDragging || !p) return

    this.#dragging.set(null)
    this.#flush()
    EffectBus.emit('drop:dragging', { active: false })
    this.#swallowClick = true

    // Where did it land? A tile's own pheromone card wins — it names its tile
    // explicitly. Otherwise the hive, and we send the RELEASE POINT rather than
    // the last hovered tile: the drag begins on this panel, and crossing chrome
    // makes the overlay broadcast `tile:hover {label:null}`, so the remembered
    // label is routinely stale-null at exactly the moment we need it. The drone
    // resolves the point against the hex map (TileOverlayDrone.labelAtClient).
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null

    // A NOTE landed under the pointer — the notes reader advertises each of
    // its rows with `data-pheromone-note`. Checked FIRST because the reader
    // floats over the hive: falling through to the hex map would put the
    // keyword on whatever tile happens to sit behind the card. Notes carry
    // their own `tags` slot, so this is a different write, not a tile one.
    // A bouquet lands mark by mark — the note write is per-keyword.
    const noteRow = el?.closest?.('[data-pheromone-note]') as HTMLElement | null
    if (noteRow) {
      const noteId = noteRow.getAttribute('data-pheromone-note') ?? ''
      const cellLabel = noteRow.getAttribute('data-pheromone-note-cell') ?? ''
      if (noteId && cellLabel) {
        for (const tag of p.marks) EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: true })
        return
      }
    }

    const card = el?.closest?.('[data-pheromone-tile]') as HTMLElement | null
    const label = card?.getAttribute('data-pheromone-tile') || this.#hoverLabel || undefined
    // `tag` stays in the payload for readers that only ever knew one keyword;
    // `tags` is the truth and carries the whole bouquet.
    EffectBus.emit('pheromone:drop', { label, tag: p.marks[0], tags: [...p.marks], x: event.clientX, y: event.clientY })
  }

  isFiltered(name: string): boolean {
    return this.#active().has(name)
  }

  // ── Point at a mark, see its tiles ────────────────────────────────────────
  //
  // Every pheromone listed here is the same question — WHICH TILES CARRY THIS?
  // — and this panel cannot answer it: the answer is the hive. So pointing at
  // one asks the hive, and the hive answers on itself (show-cell `tags:preview`
  // → the carriers light in the mark's own colour, the rest of the page
  // recedes behind them). Nothing is written, armed or staged; moving off puts
  // the page back exactly as it was.
  //
  // Kept here as well as on the wire so the row you are pointing at wears the
  // SAME colour the hive is wearing — one gesture, not two surfaces that
  // happen to agree.

  readonly #previewing = signal<readonly string[]>([])

  isPreviewing(name: string): boolean { return this.#previewing().includes(name) }

  /** Ask for one mark (a row) or a whole set (a bouquet — every mark it holds
   *  at once). The hive treats both the same, which is what makes a bouquet
   *  legible: point at it and see everything any of its marks reaches. */
  preview(event: PointerEvent, marks: readonly string[], color: string): void {
    // A MOUSE hovers; a finger does not. Touch fires pointerenter on tap and
    // never a matching pointerleave, so on a phone the tap that filters (or
    // paints) would light the hive and leave it lit with no way back.
    if (event.pointerType !== 'mouse') return
    const next = marks.filter(Boolean)
    const now = this.#previewing()
    if (next.length === now.length && next.every((m, i) => m === now[i])) return
    this.#previewing.set(next)
    EffectBus.emit('tags:preview', { marks: next, color })
  }

  endPreview(): void {
    if (this.#previewing().length === 0) return
    this.#previewing.set([])
    EffectBus.emit('tags:preview', { marks: [] })
  }

  /** A bouquet's colour for the preview: its first mark's. The hive lights ONE
   *  colour at a time, and the bouquet's own row shows every swatch beside the
   *  name, so the set stays readable there. */
  bouquetColor(bouquet: BouquetRow): string {
    return bouquet.rows[0]?.color ?? '#7eb6d6'
  }

  /** A pheromone row was CLICKED (not dragged). The click is the FILTER verb,
   *  always — gathering is the ＋, dragging is the drop, and a selection is
   *  served by the strip's place button, never by overloading this tap. One
   *  gesture, one meaning. */
  onRowClick(name: string): void {
    // The click that ends a drag must not also act on the row.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    this.#toggleFilter(name)
  }

  /** Toggle a tag in the active filter set and broadcast it — same effect the
   *  controls-bar pills emit, so the cross-page flatten reacts identically.
   *  Always carries `scope`: emitting without it made show-cell fall back to
   *  'local', so filtering from this panel silently reset the reach to
   *  page-only however wide the participant had just set it. */
  #toggleFilter(name: string): void {
    const next = new Set(this.#active())
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#active.set(next)
    this.#emitFilter(next)
  }

  /** Step to the next reach and wrap — local → children → global → local.
   *  One button carries the three stages — the same walk the lane ladder does. */
  cycleScope(): void {
    const at = this.scopeOptions.findIndex(o => o.id === this.#scope())
    this.setScope(this.scopeOptions[(at + 1) % this.scopeOptions.length].id)
  }

  /** Pick a reach. Re-broadcasts immediately so a live filter re-scans at the
   *  new width; with nothing filtered it still emits, which is what keeps the
   *  controls-bar glyph in step. */
  setScope(id: Scope): void {
    if (this.#scope() === id) return
    this.#scope.set(id)
    this.#emitFilter(this.#active())
  }

  /** Drop every active filter and return to the unfiltered view. */
  clearFilter(): void {
    if (this.#active().size === 0) return
    this.#active.set(new Set())
    this.#emitFilter(new Set())
  }

  #emitFilter(active: ReadonlySet<string>): void {
    EffectBus.emit('tags:filter', { active: [...active], scope: this.#scope() })
  }

  /** Recolour a tag from the native colour input. Writing through the registry
   *  re-broadcasts `tags:registry`, which repaints the pills + on-tile badges. */
  recolor(name: string, event: Event): void {
    const color = (event.target as HTMLInputElement | null)?.value
    if (!color) return
    void this.#registry()?.add(name, color)
  }

  isStaging(name: string): boolean {
    return this.#removalTag() === name
  }

  /** Is this keyword loaded in the brush right now (i.e. every tile click is
   *  landing it)? Distinct from `isSelected` — picked but not yet painting. */
  isApplying(name: string): boolean {
    return this.#applyTags().includes(name)
  }

  isSelected(name: string): boolean {
    return this.#selected().has(name)
  }

  // ── the bouquet in hand ────────────────────────────────────────────
  //
  // Pick pheromones (which IS arming — no separate step) and the hive answers
  // at once: tiles missing any of the set shade out, tiles wearing it all stay
  // lit. Clicking a shaded tile scents it immediately — a real write, no
  // staging, no Done — and the bouquet stays in hand for the next tile. Put it
  // down by emptying the set, pressing Put down, or Escape.
  //
  // WHAT IS IN HAND IS ALWAYS A BOUQUET — one mark or six, named or not. So
  // arming goes through one place, which works out the bouquet's signature and
  // sends it along with the marks. The signature is DERIVED while gathering and
  // only committed as a resource when the bouquet is named: content addressing
  // means identity is a property of the bytes, not of having stored them, so a
  // half-gathered set costs nothing.

  /** Hold on to the signature of what is in hand. DERIVED, not stored — while
   *  you are still gathering, every intermediate set would otherwise leave a
   *  resource behind. Saving is what commits bytes. */
  #identify(marks: readonly string[]): Promise<string | null> {
    const reg = this.#bouquetRegistry()
    if (!reg) return Promise.resolve(null)
    return reg.signatureOf(marks).then(sig => { this.#bouquetSig.set(sig); this.#flush(); return sig })
  }

  /** Take a bouquet in hand: arm at once, then work out its signature.
   *
   *  Arming first is deliberate — the hive must shade for the set on the same
   *  tick as the click, and hashing is async. The identity is re-announced
   *  when it arrives, but ONLY if the same bouquet is still in hand: a
   *  one-shot arm→paint→commit (the selection path) has already put it down by
   *  then, and re-announcing would silently re-arm the hive.
   *
   *  `color` rides along so the shade can light the matching tiles in the
   *  bouquet's own colour — the first mark's, the same face the bouquet row
   *  and the hover preview wear. */
  #armBouquet(marks: readonly string[]): void {
    const tags = [...marks]
    if (tags.length === 0) { this.#standDown(); return }
    const color = this.#colorOf(tags[0], this.#registry())
    EffectBus.emit('tags:apply-begin', { tags, color })
    const held = tags.join('\u0000')
    void this.#identify(tags).then(sig => {
      if (!sig || !this.painting()) return
      if (this.#applyTags().join('\u0000') !== held) return
      EffectBus.emit('tags:apply-begin', { tags, bouquet: sig, color })
    })
  }

  /** Put whatever is in hand down. */
  #standDown(): void {
    this.#bouquetSig.set(null)
    EffectBus.emit('tags:apply-cancel', {})
  }

  /** Put the bouquet down: empty the gathered set and disarm the hive. The
   *  ONE way out of the armed state — nothing was staged, so there is nothing
   *  to discard or commit; every scent already landed as it was clicked. */
  putDown(): void {
    this.#selected.set(new Set())
    this.#naming.set(false)
    this.#standDown()
  }

  /** THE PLACE BUTTON: put the bouquet in hand on every canvas-selected tile,
   *  in one transaction — instead of clicking each shaded tile, the selection
   *  IS the target set. The commit disarms drone-side; the pending-inactive
   *  echo clears the gathered set here, so the whole gesture reads as one
   *  act. This is the ONLY selection path — no row tap is overloaded for it. */
  applyBouquetToSelection(): void {
    if (!this.painting() || this.canvasSelectionCount() === 0) return
    for (const label of this.#canvasSelection()) {
      EffectBus.emit('tags:apply-paint', { label, add: true })
    }
    EffectBus.emit('tags:apply-commit', {})
  }

  /** Gather / release a pheromone. Gathering IS arming — from the first mark
   *  the hive shades every tile missing the set and a click scents it;
   *  emptying the set puts the bouquet down. */
  togglePheromone(name: string): void {
    if (this.#removalTag()) this.cancelRemoval()
    const next = new Set(this.#selected())
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#selected.set(next)
    this.#armBouquet([...next])
  }

  // ── bouquets ───────────────────────────────────────────────────────
  //
  // The brush already carried a SET; a bouquet is that set with a name, so it
  // survives the session and can be put on the next tile without re-picking.
  // Every verb here goes through the picked set — load fills it, save reads it
  // — which keeps ONE notion of "the pheromones in hand" and means painting a
  // bouquet is not a separate code path from painting anything else.

  /** Open the naming field for the picked set — and put the caret in it, since
   *  pressing the button IS the intent to type a name. */
  beginNaming(): void {
    if (this.selectedCount() === 0) return
    this.#naming.set(true)
    // The field is behind an `@if`, so it does not exist yet in this tick (a
    // `detectChanges()` here is too early — verified on 4250), and the command
    // line reclaims focus during the same frame. Same ladder the command line
    // itself uses for the same reason (`#focusShellSoon`): try repeatedly
    // across the frame rather than guess which beat wins.
    const focus = (): void => {
      const input = this.#host.nativeElement.querySelector('.bouquet-name-input') as HTMLInputElement | null
      input?.focus()
      input?.select()
    }
    queueMicrotask(focus)
    requestAnimationFrame(focus)
    setTimeout(focus, 60)
  }

  cancelNaming(): void {
    this.#naming.set(false)
  }

  /** Name the picked set. Re-using an existing name replaces it — the name IS
   *  the address, so this is an update, never a second bouquet. */
  async saveBouquet(name: string): Promise<void> {
    const marks = this.selectedNames()
    if (!name.trim() || marks.length === 0) return
    this.#naming.set(false)
    await this.#bouquetRegistry()?.save(name, marks)
    this.#flush()
  }

  /** Put a bouquet in hand: the picked set BECOMES its marks, which arms it
   *  exactly as picking them one at a time would. Clicking the loaded bouquet
   *  again puts it down. With tiles selected, taking it in hand is still all
   *  this does — the strip's place button is the verb that lands it. */
  loadBouquet(row: BouquetRow): void {
    // The click that ends a bouquet drag must not also load the bouquet.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    if (this.#removalTag()) this.cancelRemoval()
    const marks = row.marks.filter(Boolean)
    if (this.loadedBouquet() === row.name) {
      this.putDown()
      return
    }
    if (marks.length === 0) return
    this.#selected.set(new Set(marks))
    // Already minted — its sig IS the row's identity, so arm with it directly.
    this.#bouquetSig.set(row.sig)
    EffectBus.emit('tags:apply-begin', { tags: marks, bouquet: row.sig, color: this.bouquetColor(row) })
  }

  /** Forget the name. The marks themselves are untouched — they are keywords in
   *  their own right, and the bouquet was only ever a way to hold several. */
  async forgetBouquet(name: string, event: Event): Promise<void> {
    event.stopPropagation()
    await this.#bouquetRegistry()?.remove(name)
    this.#flush()
  }

  /** Arm a removal: filter the hive to this keyword — so every tile carrying it
   *  is on screen at the current reach — and hand the staging to the drone.
   *  Nothing is written; clicking tiles builds the list, Remove commits it. */
  beginRemoval(name: string): void {
    if (this.#removalTag() === name) { this.commitRemoval(); return }
    if (this.selectedCount() > 0 || this.painting()) this.putDown()
    const only = new Set([name])
    this.#active.set(only)
    this.#emitFilter(only)
    EffectBus.emit('tags:removal-begin', { tag: name })
  }

  /** Stage every tile currently on screen — the "all of them" shortcut for a
   *  keyword that was applied by mistake. */
  stageAllShown(): void {
    EffectBus.emit('tags:removal-select-all', {})
  }

  /** Apply the staged removals. The drone splices each tile's decoration and
   *  re-runs the filter, so the committed tiles drop out of view. */
  commitRemoval(): void {
    if (this.removalCount() === 0) { this.cancelRemoval(); return }
    EffectBus.emit('tags:removal-commit', {})
  }

  cancelRemoval(): void {
    EffectBus.emit('tags:removal-cancel', {})
  }

  /** Forget the keyword itself — drop it from the master registry so it stops
   *  appearing in this list and the controls-bar pills. Tiles keep whatever
   *  decorations they carry; use the staged removal above to take it off them.
   *  Only offered while a removal is armed, so it can't be hit by accident. */
  forgetTag(name: string): void {
    this.cancelRemoval()
    void this.#registry()?.remove(name)
    if (this.#active().has(name)) {
      const next = new Set(this.#active())
      next.delete(name)
      this.#active.set(next)
      this.#emitFilter(next)
    }
  }

  /** Closing the panel disarms any takeover — a staged removal or the bouquet
   *  in hand — since the panel is the review surface and leaving tile clicks
   *  hijacked would strand the participant. */
  close(): void {
    if (this.#removalTag()) this.cancelRemoval()
    if (this.selectedCount() > 0 || this.painting()) this.putDown()
    this.endPreview()
    this.visible.set(false)
    EffectBus.emit('tags:view-state', { open: false })
  }

  /** One level back per press: shut the naming field, then put the bouquet
   *  down, then drop an armed removal. False means nothing of ours was open,
   *  and the shell cascade carries on past us — clearing a selection before it
   *  ever closes this window. Reached from the session; there is no listener
   *  here. */
  dismiss(): boolean {
    if (this.#naming()) { this.cancelNaming(); return true }
    if (this.selectedCount() > 0 || this.painting()) { this.putDown(); return true }
    if (this.#removalTag()) { this.cancelRemoval(); return true }
    return false
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-tags-viewer',
  owner: '@hypercomb.shared/TagsViewerComponent',
  component: TagsViewerComponent,
  order: 130,
})
