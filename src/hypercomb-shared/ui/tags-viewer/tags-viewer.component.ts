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
// ── Scenting, and the bouquet ─────────────────────────────────────────────
// Putting pheromones ON tiles is deliberately explicit: open the surface,
// gather the pheromones you want (any number — ＋ on each row), then walk the
// tiles. Every click leaves the whole gathered set at once, scented tiles mark
// on the hive as they land (show-cell reads the same `tags:apply-pending`), and
// the panel lists them as it goes.
//
// WHAT IS IN HAND IS ALWAYS A BOUQUET — a bee never emits one compound, and
// neither do you. One mark or six, the gathered set has an identity from the
// first mark (bouquet-registry.ts derives it), before anyone decides to name
// it. Naming is a separate, later act — it commits the bytes and makes the
// bouquet easy to pick up again. Saved bouquets list below the pheromones, and
// clicking one takes it in hand.
//
// Shell UI, so it must NOT import essentials — it reads the TagRegistry and
// emits tag effects over IoC / EffectBus, exactly like the controls bar. Tag
// names come from `tags:registry` (the registry's broadcast) and counts from
// `render:tags` (show-cell's per-page aggregation); both are sticky on the bus
// so a freshly-opened panel hydrates immediately.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { ChangeDetectorRef, Component, computed, ElementRef, inject, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { onSelection } from '../../core/selection-context'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'

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
  /** The marks as swatch+name pairs, so a bouquet reads like everything else. */
  chips: { name: string; color: string }[]
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
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './tags-viewer.component.html',
  styleUrls: ['./tags-viewer.component.scss'],
})
export class TagsViewerComponent implements OnDestroy {

  readonly visible = signal(false)

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
  /** The painter tray is open — the surface where pheromones are picked and the
   *  brush is loaded. Local to the panel: nothing is armed until Paint. */
  readonly #painterOpen = signal(false)
  /** The pheromones picked for the brush. Purely the participant's choice until
   *  Paint hands it to the drone. */
  readonly #selected = signal<Set<string>>(new Set())
  /** The keywords currently armed as a brush. Mirrors `tags:apply-pending`
   *  (PheromoneTilesDrone). Painting and removal are the two takeovers of the
   *  tile click, mutually exclusive so they never fight over the same tap. */
  readonly #applyTags = signal<string[]>([])
  /** Tiles painted so far this session — the drone's running list, echoed here
   *  so the panel shows the pheromones landing, not just a toast that fades. */
  readonly #paintedCells = signal<string[]>([])

  /** The pheromone being dragged onto the hive, or null. Drives the ghost chip
   *  that follows the cursor — the drag IS the gesture, so it has to be visible
   *  the whole way from the list to the tile. */
  readonly #dragging = signal<{ name: string; color: string } | null>(null)
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
  readonly painterOpen = this.#painterOpen.asReadonly()
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
  readonly paintedCells = this.#paintedCells.asReadonly()
  readonly paintedCount = computed(() => this.#paintedCells().length)
  readonly dragging = this.#dragging.asReadonly()
  readonly dragPos = this.#dragPos.asReadonly()
  readonly removalCells = this.#removalCells.asReadonly()
  readonly removalCount = computed(() => this.#removalCells().length)
  readonly naming = this.#naming.asReadonly()
  /** The identity of the bouquet in hand, shortened. Shown because it is the
   *  proof that a bouquet exists before it has a name — and because two people
   *  who gather the same marks will see the same one. */
  readonly bouquetShortSig = computed(() => this.#bouquetSig()?.slice(0, 8) ?? '')
  /** The bouquets as rows, each mark carrying its own colour. */
  readonly bouquets = computed<BouquetRow[]>(() => {
    this.#registryVersion()
    const registry = this.#registry()
    return this.#bouquets().map(b => ({
      ...b,
      chips: b.marks.map(name => ({ name, color: this.#colorOf(name, registry) })),
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

  /** The three reaches, each named and explained. The whole point of the panel:
   *  a reach you can read instead of a glyph you have to decode. */
  readonly scopeOptions: readonly { id: Scope; icon: string }[] = [
    { id: 'local', icon: 'blur_on' },
    { id: 'children', icon: 'account_tree' },
    { id: 'global', icon: 'public' },
  ]

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

    // Apply-brush state (sticky): PheromoneTilesDrone owns it, this panel
    // reflects which keywords are armed and which tiles they have landed on.
    this.#cleanups.push(EffectBus.on<{ tag?: string | null; tags?: string[]; cells?: string[]; active: boolean }>(
      'tags:apply-pending', (p) => {
        const armed = p?.active === true
        const tags = armed
          ? (Array.isArray(p?.tags) && p.tags.length ? p.tags : (p?.tag ? [p.tag] : []))
          : []
        this.#applyTags.set([...tags])
        this.#paintedCells.set(armed && Array.isArray(p?.cells) ? [...p.cells] : [])
        this.#flush()
      },
    ))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
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

  // ── drag a pheromone onto a tile ───────────────────────────────────
  //
  // The direct-manipulation path: pick the pheromone up out of the list and
  // drop it on the tile you mean. Pointer events (not HTML5 drag-and-drop),
  // because the drop target is a WebGL canvas with no DOM nodes to land on —
  // the tile under the cursor is whatever `tile:hover` last reported, and a
  // drop onto a tile's own pheromone card resolves via `data-pheromone-tile`.
  //
  // A press only becomes a drag past DRAG_THRESHOLD px, so clicking the name
  // still filters; the trailing click is swallowed when a drag did happen.

  /** Candidate press, promoted to a real drag once the pointer moves far enough. */
  #pending: { name: string; color: string; x: number; y: number } | null = null
  /** A drag just ended — swallow the click it would otherwise fire. */
  #swallowClick = false
  /** Tile currently under the cursor, mirrored from `tile:hover`. */
  #hoverLabel: string | null = null

  /** Phone-shaped viewport — small in EITHER dimension (a phone on its side is
   *  wide but short). Matches the app-wide mobile detection. */
  #isPhone(): boolean {
    try { return window.matchMedia('(max-width: 599px), (max-height: 449px)').matches }
    catch { return false }
  }

  onRowPointerDown(event: PointerEvent, row: TagRow): void {
    if (event.button !== 0) return
    // Drag-to-paint is a POINTER affordance and is switched off on phones,
    // where the painter isn't offered at all (see the phone block in the SCSS).
    // Leaving it armed here would be actively harmful: on touch, dragging a row
    // IS the scroll gesture, so scrolling this list past the drag threshold
    // would drop a pheromone onto whatever tile sits underneath.
    if (this.#isPhone()) return
    this.#pending = { name: row.name, color: row.color, x: event.clientX, y: event.clientY }
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
      // hive reads as a surface to land on rather than a menu.
      this.#dragging.set({ name: p.name, color: p.color })
      EffectBus.emit('drop:dragging', { active: true })
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
    const card = el?.closest?.('[data-pheromone-tile]') as HTMLElement | null
    const label = card?.getAttribute('data-pheromone-tile') || this.#hoverLabel || undefined
    EffectBus.emit('pheromone:drop', { label, tag: p.name, x: event.clientX, y: event.clientY })
  }

  isFiltered(name: string): boolean {
    return this.#active().has(name)
  }

  /** A pheromone row was CLICKED (not dragged). What that means depends on the
   *  painter, which is itself the mode switch — no separate filter/apply toggle
   *  for the participant to manage:
   *    • painter OPEN  → pick the pheromone into the brush.
   *    • painter CLOSED → toggle the hive filter.
   *  Filtering while the painter is open is exactly the trap Jaime hit: it
   *  flattens the hive to one keyword, hiding the very tiles you are trying to
   *  paint. So in painter mode the click never filters — it picks. (Dragging a
   *  row still applies directly, in either mode; that is a separate gesture.) */
  onRowClick(name: string): void {
    // The click that ends a drag must not also act on the row.
    if (this.#swallowClick) { this.#swallowClick = false; return }
    if (this.#painterOpen()) { this.togglePheromone(name); return }
    // SELECTION IS THE TARGET. With tiles picked on the canvas, tapping a
    // pheromone puts it on all of them — the touch answer to "pick a brush,
    // then drag across the hive", which a finger cannot perform because on
    // touch a drag IS the scroll gesture. Filtering by the mark would be the
    // wrong read of the tap here: you picked tiles in order to DO something
    // to them. Unpicked, the tap still filters exactly as before.
    if (this.canvasSelectionCount() > 0) { this.applyToSelection(name); return }
    this.#toggleFilter(name)
  }

  /** Put one pheromone on every canvas-selected tile, in one transaction. One
   *  mark is still a bouquet — it is minted like any other, so the tap that
   *  looks simplest is not a special case underneath.
   *  Fires the drone's arm → stage → commit triple synchronously (EffectBus
   *  dispatches inline), so the hive is never left sitting in paint-takeover
   *  mode waiting for a Done that a phone has no way to press. */
  applyToSelection(name: string): void {
    const labels = [...this.#canvasSelection()]
    if (labels.length === 0) return
    EffectBus.emit('tags:apply-begin', { tags: [name] })
    for (const label of labels) EffectBus.emit('tags:apply-paint', { label, add: true })
    EffectBus.emit('tags:apply-commit', {})
    void this.#identify([name])
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

  isScope(id: Scope): boolean {
    return this.#scope() === id
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

  // ── scenting ───────────────────────────────────────────────────────
  //
  // Open it, pick pheromones (which IS arming — no separate step), then
  // hold-and-walk across the tiles to scent them. Scenting only STAGES: the
  // tiles mark on the hive as you go, and `Done` persists them in one layer
  // transaction. Close / Escape / closing the window all discard.
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
   *  Arming first is deliberate — the hive must become a scenting surface on
   *  the same tick as the click, and hashing is async. The identity
   *  is re-announced when it arrives, but ONLY if the same bouquet is still in
   *  hand: a one-shot arm→paint→commit (the selection path) has already put it
   *  down by then, and re-announcing would silently re-arm the hive. */
  #armBouquet(marks: readonly string[]): void {
    const tags = [...marks]
    if (tags.length === 0) { this.#standDown(); return }
    EffectBus.emit('tags:apply-begin', { tags })
    const held = tags.join('\u0000')
    void this.#identify(tags).then(sig => {
      if (!sig || !this.painting()) return
      if (this.#applyTags().join('\u0000') !== held) return
      EffectBus.emit('tags:apply-begin', { tags, bouquet: sig })
    })
  }

  /** Put whatever is in hand down. */
  #standDown(): void {
    this.#bouquetSig.set(null)
    EffectBus.emit('tags:apply-cancel', {})
  }

  openPainter(): void {
    if (this.#removalTag()) this.cancelRemoval()
    this.#painterOpen.set(true)
  }

  /** Persist the painted tiles — one commit — and finish. This is the ONLY
   *  path that writes; the drone stages everything until now. */
  donePaint(): void {
    EffectBus.emit('tags:apply-commit', {})
    this.#painterOpen.set(false)
    this.#selected.set(new Set())
    this.#naming.set(false)
    this.#bouquetSig.set(null)
  }

  /** Stage every canvas-selected tile under the armed brush in one press —
   *  the selection response: instead of clicking each selected tile, the
   *  selection IS the target set. Emits the same `tags:apply-paint` the
   *  overlay's paint stroke emits per tile, so the drone stages + the hive
   *  marks identically; Done still commits in one transaction. */
  stageSelection(): void {
    if (!this.painting()) return
    for (const label of this.#canvasSelection()) {
      EffectBus.emit('tags:apply-paint', { label, add: true })
    }
  }

  /** Leave the painter WITHOUT persisting — the staged tiles are thrown away.
   *  (Done is the only save; Close is the discard.) */
  closePainter(): void {
    this.#standDown()
    this.#painterOpen.set(false)
    this.#selected.set(new Set())
    this.#naming.set(false)
  }

  /** Pick / unpick a pheromone for the brush. Opens the painter if it was shut,
   *  so the ＋ on any row is a valid way in. Picking IS arming — a non-empty
   *  brush turns the hive into a paint surface at once; emptying it stands the
   *  brush down. The drone keeps the staged tiles across a re-arm, so "actually,
   *  this one too" costs one click, not a restart. */
  togglePheromone(name: string): void {
    if (this.#removalTag()) this.cancelRemoval()
    const next = new Set(this.#selected())
    if (next.has(name)) next.delete(name); else next.add(name)
    this.#selected.set(next)
    this.#painterOpen.set(true)
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

  /** Put a bouquet in hand: the picked set BECOMES its marks, which arms the
   *  brush exactly as picking them one at a time would. Clicking the loaded
   *  bouquet again puts it down.
   *
   *  SELECTION IS THE TARGET here too — with tiles picked on the canvas, a
   *  bouquet lands on all of them in one transaction rather than arming a
   *  brush, the same read the pheromone rows already take. That is what makes
   *  bouquets usable on a phone, where the painter is withheld: pick tiles,
   *  tap a bouquet, done. */
  loadBouquet(row: BouquetRow): void {
    if (this.#removalTag()) this.cancelRemoval()
    const marks = row.marks.filter(Boolean)
    if (this.canvasSelectionCount() > 0 && marks.length > 0) {
      EffectBus.emit('tags:apply-begin', { tags: marks })
      for (const label of this.#canvasSelection()) EffectBus.emit('tags:apply-paint', { label, add: true })
      EffectBus.emit('tags:apply-commit', {})
      return
    }
    if (this.loadedBouquet() === row.name) {
      this.#selected.set(new Set())
      this.#standDown()
      return
    }
    if (marks.length === 0) return
    this.#selected.set(new Set(marks))
    this.#painterOpen.set(true)
    // Already minted — its sig IS the row's identity, so arm with it directly.
    this.#bouquetSig.set(row.sig)
    EffectBus.emit('tags:apply-begin', { tags: marks, bouquet: row.sig })
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
    if (this.#painterOpen()) this.closePainter()
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

  /** Closing the panel disarms any takeover — a staged removal or the apply
   *  brush — since the panel is the review surface and leaving tile clicks
   *  hijacked would strand the participant. */
  close(): void {
    if (this.#removalTag()) this.cancelRemoval()
    if (this.#painterOpen()) this.closePainter()
    this.visible.set(false)
    EffectBus.emit('tags:view-state', { open: false })
  }

  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape steps back exactly one level: shut the naming field, then the
    // painter (discarding its staging — Done is the only save), then drop an
    // armed removal, and only close the panel once nothing is open inside it.
    if (this.#naming()) { this.cancelNaming(); return }
    if (this.#painterOpen()) { this.closePainter(); return }
    if (this.#removalTag()) { this.cancelRemoval(); return }
    this.close()
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
