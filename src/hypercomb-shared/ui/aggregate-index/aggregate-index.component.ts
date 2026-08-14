// hypercomb-shared/ui/aggregate-index/aggregate-index.component.ts
//
// The ONE aggregate index panel — left-docked, one line per item, rows you drag
// onto the hive to create meaning. Collections and Websites both render through
// it; neither owns any chrome of its own (see aggregate-source.ts for why).
//
// ── The drag ─────────────────────────────────────────────────────────────────
//
// POINTER events, not HTML5 drag — the same gesture the pheromone panel already
// uses (tags-viewer #onRowPointerDown → #onDragMove → #onDragUp), so a row-drag
// behaves identically wherever it starts. Crossing the threshold promotes to a
// drag and emits `drop:dragging {active:true}`, which puts the tile overlay into
// its bare drop-target mode (icons hidden) — the hive reads as a surface to land
// on rather than a menu.
//
// **Resolve the drop from the RELEASE COORDINATES, never a remembered hover.**
// The drag starts on this panel, and crossing chrome makes the overlay broadcast
// `tile:hover {label:null}`, so the remembered label is routinely stale-null at
// exactly the moment it's needed. `TileOverlayDrone.labelAtClient(x, y)` resolves
// the release point against the live hex map instead.
//
// What a drop MEANS is in aggregate-drop.ts:
//   • released over a TILE  → attach the item's keywords to it (a pheromone on a
//     tile is what makes that tile a member)
//   • released over EMPTY   → mint a reference tile here, pointing at the item
//
// Shell UI — resolves everything through `window.ioc` at call time, never
// imports essentials.

import { ChangeDetectorRef, Component, computed, inject, signal, type OnDestroy } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import type { RecentPortalsStore } from '../../core/recent-portals.store'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { signalSession } from '../window-session'
import {
  aggregateSources, getAggregateSource, sourceForLocation,
  type AddedRows, type AggregateItem, type AggregateSource, type AggregateVersion, type StagedEntry,
} from './aggregate-source'
import { dropContextOnTile, dropReferenceTile, dropTagsOnTile, safeCellName } from './aggregate-drop'
import { onSelection, withSelectionService } from '../../core/selection-context'

/** Movement before a press counts as a drag rather than a click — small enough
 *  to feel immediate, large enough that a click that jitters still opens. */
const DRAG_THRESHOLD = 5

/** The Portals view. The only source whose rows may be pinned as home — every
 *  source's `segments` is "what this row points at", so the mechanism would
 *  work anywhere, but a home that is a tag row or a search hit is not a place
 *  you meant to keep. */
const PORTALS_SOURCE_ID = 'collections'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type OverlayLike = { labelAtClient(x: number, y: number): string | null }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/** Joins segments into a comparable location key. NUL is the one character a
 *  tile name can never carry, so the join is unambiguous — a space would
 *  collide with any name containing one. Same separator and same reasoning as
 *  the decoration index's own location keys, and an ESCAPE SEQUENCE rather than
 *  a literal control byte (doctrine ratchet). */
const KEY_SEP = '\u0000'

@Component({
  selector: 'hc-aggregate-index',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './aggregate-index.component.html',
  styleUrls: ['./aggregate-index.component.scss'],
})
export class AggregateIndexComponent implements OnDestroy {
  readonly open = signal(false)

  /** Put away while the hive is covered; back on the same source, same filter,
   *  same origin — `close()` also drops a rename in progress, parking doesn't. */
  readonly session = signalSession(this.open, undefined, { dismiss: () => this.dismiss(), close: () => this.close() })
  readonly items = signal<readonly AggregateItem[]>([])
  /** The ONE field. There is no create mode — see `creatable`. */
  readonly query = signal('')
  readonly renaming = signal<string | null>(null)
  /** The row whose version chain is showing, by key — at most one. */
  readonly versionsFor = signal<string | null>(null)
  readonly versions = signal<readonly AggregateVersion[]>([])
  readonly versionsLoading = signal(false)
  /** The item currently being dragged, and where the ghost sits. */
  readonly dragging = signal<AggregateItem | null>(null)
  readonly dragPos = signal<{ x: number; y: number }>({ x: 0, y: 0 })

  readonly source = signal<AggregateSource | null>(null)

  /** Where the participant stood when this panel opened — the page they meant
   *  to drop references ONTO. Opening the panel never navigates, so this is
   *  simply "here"; it only becomes meaningful once a row is clicked and the
   *  hive moves to that collection to manage it. */
  readonly origin = signal<readonly string[] | null>(null)
  /** The hive's current location, mirrored so the template can react. */
  readonly here = signal<readonly string[]>([])

  /** True once opening a collection has moved the hive off the origin page —
   *  the only state in which the return control has anything to do. */
  readonly awayFromOrigin = computed(() => {
    const o = this.origin()
    return !!o && !sameSegments(o, this.here())
  })

  /** Last segment of the origin, for the return label. Root reads as "home". */
  readonly originLabel = computed(() => {
    const o = this.origin()
    return o && o.length ? o[o.length - 1] : 'home'
  })

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase()
    const active = this.#activeTags()
    let list = this.items()
    if (active.size > 0) list = list.filter(i => (i.tags ?? []).some(t => active.has(t)))
    if (q) list = list.filter(i => i.label.toLowerCase().includes(q))
    return list
  })

  // ── no mark palette here, deliberately ──────────────────────────────────────
  //
  // This window used to carry its own copy of the hive's pheromone vocabulary,
  // to "arm" the marks a dropped reference would demand. It is gone. Pheromones
  // have ONE home — the pheromone panel — and every index that grew a private
  // palette made the same gesture mean something slightly different in a third
  // place. Marks will reach a reference by being dragged from that one surface.
  //
  // The reference payload still carries `requiredMarks` (see aggregate-drop.ts);
  // what was removed is this window's private way of setting them, so nothing
  // downstream changed shape — references written before simply keep the marks
  // they were born with.

  readonly hasFilter = computed(() => this.#activeTags().size > 0 || this.query().trim().length > 0)
  readonly canCreate = computed(() => !!this.source()?.create)

  // ── typing IS naming ────────────────────────────────────────────────────────
  //
  // There is no create MODE. The field you search in is the field you name in,
  // because looking for something and not finding it is the same gesture as
  // deciding to make it — you have already typed the name by the time you know
  // it isn't there. Flipping a mode first made you say twice what you had
  // already said once.
  //
  // So the + means one thing at all times: MAKE WHAT I TYPED. It is live exactly
  // when that is a real act — there is a name, and nothing already answers to it.
  // Narrowing to existing rows and creating are not alternatives here: a query
  // that matches "music-archive" can still create "music", because a name that
  // reads like part of another name is not the same name. That is the whole
  // reason the + stays available while the list is showing matches.

  /** The name the + would make: what is typed, cleaned the way a cell name must
   *  be (a name becomes a path segment). Empty when there is nothing to make. */
  readonly draft = computed(() => safeCellName(this.query()))

  /** Whether a row already answers to the drafted name — the only thing that
   *  makes creating meaningless. Compared case-insensitively against BOTH the
   *  address and the reading: a row titled "Jazz" over the address `jazz-1` is
   *  a duplicate to the person looking at it either way. */
  readonly draftExists = computed(() => {
    const name = this.draft().toLowerCase()
    if (!name) return false
    return this.items().some(i => i.key.toLowerCase() === name || i.label.toLowerCase() === name)
  })

  /** Is the + a live act right now? */
  readonly creatable = computed(() => this.canCreate() && !!this.draft() && !this.draftExists())

  /** A tile is being dragged by its handle (PortalCarryDrone) — while true the
   *  Portals rows present themselves as drop zones. */
  readonly portalCarryActive = signal(false)

  /** Are the rows portals? Only the Portals view accepts a carried tile —
   *  every other aggregate's rows mean something else. */
  readonly portalDropView = computed(() => this.source()?.id === PORTALS_SOURCE_ID)

  /** Labels currently selected on the canvas, with the location they were
   *  selected AT. Captured rather than derived on read: a selection outlives
   *  navigation, and resolving `here + label` later would name whatever tile
   *  happens to share the name on the page you have since walked to. */
  readonly selection = signal<readonly StagedEntry[]>([])

  /** The collection we are STANDING IN, if the current location is one of our
   *  rows. This is what makes "drill into a collection and add tiles" work: the
   *  destination is simply where you are, so there is no target to pick and no
   *  mode to leave. Selection is captured with its own segments, so tiles chosen
   *  on one page are still addable after walking into the collection. */
  readonly destination = computed<AggregateItem | null>(() => {
    const here = this.here().join(KEY_SEP)
    if (!here) return null
    return this.items().find(i => i.segments.join(KEY_SEP) === here) ?? null
  })

  /** The selection, minus what would be a no-op.
   *
   *  Adding to the INDEX skips anything already indexed — a second reference to
   *  the same place would be a duplicate row. Adding INTO a collection skips
   *  the collection itself AND its own children: a tile selected while standing
   *  inside the collection is already in it, so offering "Add to <here>" for it
   *  reads as broken. A tile can still be a member of many OTHER collections —
   *  that is the whole point. Empty unless the active source actually supports
   *  adding. */
  readonly staged = computed<readonly StagedEntry[]>(() => {
    if (!this.source()?.add) return []
    const into = this.destination()
    if (into) {
      const self = into.segments.join(KEY_SEP)
      return this.selection().filter(e =>
        e.segments.join(KEY_SEP) !== self
        && e.segments.slice(0, -1).join(KEY_SEP) !== self)
    }
    const known = new Set(this.items().map(i => i.key))
    return this.selection().filter(e => !known.has(e.label))
  })

  /** Is filing the staged tiles away a live act right now?
   *
   *  Only ever INTO a collection — moving needs somewhere for the tiles to land,
   *  and the index itself is a list of pointers, not a place content lives. So
   *  the Move button appears exactly when you have walked into a collection and
   *  have tiles picked, which is also the moment it reads as obvious: the
   *  destination is the page in front of you. */
  readonly canMove = computed<boolean>(() =>
    !!this.source()?.move && !!this.destination() && this.staged().length > 0)

  /** Can the page we are standing on be saved into the index? The canvas route
   *  cannot reach it — you would have to stand on its PARENT and select it —
   *  so a page can only add itself from in here. Hidden at the hive root (not a
   *  collection) and once it is already a member. */
  readonly canAddHere = computed<boolean>(() => {
    const src = this.source()
    if (!src?.add || this.here().length === 0) return false
    return !this.destination()
  })

  /** The current page's own name, for the "add this page" affordance. */
  readonly hereLabel = computed<string>(() => {
    const segs = this.here()
    return segs.length ? segs[segs.length - 1] : ''
  })

  // ── carrying: choose here, travel, apply there ──────────────────────────────
  //
  // Dragging one row at a time answers "put this there". It does not answer
  // "put these twelve there", and it forces the destination to be on screen at
  // the moment you decide — which it usually isn't, because deciding what
  // belongs together and finding where it goes are different acts.
  //
  // So: pick rows, walk the hive to wherever they belong, press Apply.
  //
  // ── THIS SURVIVES NAVIGATION, AND THE STAGED TRAY MUST NOT ──────────────────
  //
  // `#dropStaged()` deliberately empties on every hop (2026-07-28): a tray that
  // follows you around keeps offering to file tiles you picked on a page you
  // have since left, and the offer reads as live because the buttons are lit.
  // That rule is right for THAT tray and wrong for this one, and the difference
  // is the DIRECTION OF TRAVEL:
  //
  //   "file these tiles I picked HERE"  → leaving INVALIDATES it.
  //   "carry these somewhere ELSE"      → leaving COMPLETES it.
  //
  // Same-shaped state, opposite meaning, so they are kept as two baskets rather
  // than one with a flag. What this one owes in exchange for surviving is being
  // impossible to forget: the count rides in the header, the bar names the page
  // it would land on, and Apply empties it.

  /** Rows picked up to be applied elsewhere. Order is the order they were
   *  picked — the batch lands the way you built it. */
  readonly carried = signal<readonly AggregateItem[]>([])
  readonly carryCount = computed(() => this.carried().length)

  /** The marks the scenting brush is holding, mirrored from `tags:apply-pending`
   *  (sticky). A bouquet in hand at the moment you press Apply lands on the
   *  references as they are created — see `applyCarried`. */
  readonly #brushMarks = signal<readonly string[]>([])
  readonly brushMarks = computed(() => [...this.#brushMarks()])

  readonly #cdr = inject(ChangeDetectorRef)
  readonly #activeTags = signal<ReadonlySet<string>>(new Set())
  #filterScope: 'local' | 'children' | 'global' = 'global'
  #lineage: LineageLike | null = null
  #lineageBound = false
  #atSource = false
  #cleanups: Array<() => void> = []
  #sourceChanged = (): void => { void this.reload() }
  /** The in-flight row read, and whether anything asked for another while it ran.
   *  See `reload` — re-reading the index is expensive and every trigger used to
   *  start its own pass. */
  #reloading: Promise<void> | null = null
  #reloadAgain = false
  /** The source whose `changed` we are subscribed to, so switching aggregates
   *  doesn't leave us listening to the old one. */
  #boundSource: AggregateSource | null = null
  #pending: { item: AggregateItem; x: number; y: number } | null = null
  #swallowClick = false

  constructor() {
    // Selection is last-value replayed, so opening the panel after selecting
    // still stages what is already picked.
    //
    // THE TRAY IS A CAPTURE, NOT A MIRROR — each entry keeps its own absolute
    // `segments`, so a staged tile names itself rather than "whatever is called
    // that on the page I am looking at now".
    //
    // It does NOT outlive a hop: `#onLineage` drops it on every navigation (see
    // the note there for why, and for the one flow that costs). So an empty
    // update is always honoured — there is no longer a stale capture for it to
    // be told apart from.
    this.#cleanups.push(onSelection(({ selected }) => {
      const here = this.#segments()
      this.selection.set(selected.map(label => ({ label, segments: [...here, label] })))
      this.#cdr.detectChanges()
    }))
    // Bouquet in hand (sticky). Read-only here — the pheromone panel owns the
    // brush; this window only asks what it is holding when Apply is pressed.
    this.#cleanups.push(EffectBus.on<{ tags?: string[]; tag?: string | null; active?: boolean }>(
      'tags:apply-pending', (p) => {
        const armed = p?.active === true
        const marks = armed
          ? (Array.isArray(p?.tags) && p.tags.length ? p.tags : (p?.tag ? [p.tag] : []))
          : []
        this.#brushMarks.set(marks.map(String).filter(Boolean))
        this.#cdr.markForCheck()
      }))
    this.#cleanups.push(EffectBus.on<{ id?: string }>('aggregate:view-open', (p) => this.openPanel(p?.id)))
    // A tile is riding the pointer (the drag handle PortalCarryDrone owns) —
    // light the portal rows as drop zones while it does, and land the drop.
    this.#cleanups.push(EffectBus.on('portal-carry:drag-start', () => {
      this.portalCarryActive.set(true)
      this.#cdr.detectChanges()
    }))
    this.#cleanups.push(EffectBus.on('portal-carry:drag-end', () => {
      this.portalCarryActive.set(false)
      this.#cdr.detectChanges()
    }))
    this.#cleanups.push(EffectBus.on<{ label?: string; segments?: string[]; targetKey?: string }>(
      'portal-carry:drop', (p) => { void this.#onPortalCarryDrop(p) }))
    this.#cleanups.push(EffectBus.on<{ id?: string }>('aggregate:view-toggle', (p) => this.togglePanel(p?.id)))
    this.#cleanups.push(EffectBus.on('aggregate:view-close', () => this.close()))
    // The home pin can move from outside this window (the rail's Home menu, or
    // forgetting the pinned portal), and the lit row has to follow it.
    this.#cleanups.push(EffectBus.on('portals:recent-changed', () => this.#cdr.markForCheck()))
    this.#cleanups.push(EffectBus.on<{ active?: readonly string[]; scope?: string }>('tags:filter', (p) => {
      this.#activeTags.set(new Set((p?.active ?? []).map(String).filter(Boolean)))
      const s = p?.scope
      if (s === 'local' || s === 'children' || s === 'global') this.#filterScope = s
      this.#cdr.markForCheck()
    }))
    aggregateSources.addEventListener('change', this.#sourceChanged)
    window.addEventListener('synchronize', this.#sourceChanged)
    // Lineage's own `change` does not fire for every hop (verified: a row click
    // moved the hive but left `here()` stale, so the return control never
    // appeared). `navigate` is the shell-wide signal, so track that too — the
    // panel's location mirror has to be right or the way back is invisible.
    window.addEventListener('navigate', this.#onLineage)
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    for (const off of this.#cleanups) off()
    aggregateSources.removeEventListener('change', this.#sourceChanged)
    this.#boundSource?.changed?.removeEventListener('change', this.#sourceChanged)
    window.removeEventListener('synchronize', this.#sourceChanged)
    window.removeEventListener('navigate', this.#onLineage)
    this.#lineage?.removeEventListener?.('change', this.#onLineage)
    this.#detachDrag()
  }

  // ── open / close ────────────────────────────────────────────────────────────

  /** Show the window. NEVER navigates — see the note on ControlsBar.openPools:
   *  the page you are standing on is the drop surface, so opening the index must
   *  leave it exactly as it was. Anchors the origin on a FRESH open only, so
   *  re-emitting `aggregate:view-open` while it is already up can't move the
   *  return target out from under you. */
  openPanel(id?: string): void {
    const next = id ? getAggregateSource(id) : this.source()
    // A chain belongs to the row it was opened from — switching aggregates
    // leaves it pointing at a key this index has never heard of.
    if (next && next !== this.source()) this.#closeVersions()
    if (next) this.source.set(next)
    if (!this.source()) return
    if (!this.open()) this.origin.set(this.#segments())
    this.open.set(true)
    // Announce the SHOWN view. Surfaces outside this window key on it — the
    // portal-carry drag handle rides tiles only while the portals view is up.
    // EffectBus replays the last value, so a late subscriber still learns the
    // current state; emitted on every open so switching aggregates while the
    // window stays up also reaches them.
    EffectBus.emit('aggregate:view-state', { id: this.source()?.id ?? null, open: true })
    void this.reload()
  }

  /** The control that opens this index is a TOGGLE — press it again to put the
   *  window away. If clicking a row walked the hive into a collection, closing
   *  ALSO steps back to the page the panel was opened from, so the same button
   *  is a quick way home rather than only a way to hide the list.
   *
   *  Pressing a DIFFERENT aggregate's control while this one is up switches to
   *  it instead of closing — that press asked for that index, not for nothing. */
  togglePanel(id?: string): void {
    const current = this.source()
    if (this.open() && id && current && current.id !== id) { this.openPanel(id); return }
    if (!this.open()) { this.openPanel(id); return }
    if (this.awayFromOrigin()) this.returnToOrigin()
    this.close()
  }

  /** Go back to the page the panel was opened from and drop the selection, so
   *  dragging references can resume where it started. The panel stays open —
   *  this clears a selection, it does not close a tool. */
  returnToOrigin(): void {
    const o = this.origin()
    if (!o) return
    // Explicitly, before the hop rather than relying on it: this control's whole
    // purpose is to drop what is staged and start again, and saying so here
    // keeps it true no matter what the navigation clear does.
    this.#dropStaged()
    ;(ioc()?.get('@hypercomb.social/Navigation') as { goRaw?(s: readonly string[]): void } | undefined)
      ?.goRaw?.(o)
  }

  /** Empty the tray — after a completed gesture, on the way back to the
   *  origin, or on any navigation. Clears the canvas selection with it, so the
   *  tray and the highlighted tiles can never disagree. */
  #dropStaged(): void {
    withSelectionService(s => s.clear())
    this.selection.set([])
  }

  /** Whether this row is the collection currently being managed (the hive is
   *  standing in it), so the list shows WHICH one you stepped into. */
  isSelected(item: AggregateItem): boolean {
    return sameSegments(item.segments, this.here())
  }

  close(): void {
    if (!this.open()) return
    this.open.set(false)
    // The counterpart announcement to openPanel's — see the note there.
    EffectBus.emit('aggregate:view-state', { id: this.source()?.id ?? null, open: false })
    this.renaming.set(null)
    this.#closeVersions()
  }

  /** Re-read the rows — SINGLE-FLIGHT.
   *
   *  A full read is expensive (a layer plus a reference decoration per row), and
   *  it has many triggers: the awaited call after a write, the `synchronize` the
   *  same write's pulse dispatches, a navigation, the source announcing a late
   *  picture. Each used to start its OWN pass, so one Add ran the whole rebuild
   *  about three times over, all racing for the same OPFS files and the last one
   *  to finish deciding what you saw.
   *
   *  So a caller arriving mid-read JOINS it instead, and its request is honoured
   *  as ONE trailing pass afterwards — never dropped, because a trigger that
   *  landed during the read may be reporting a commit that read just missed. */
  async reload(): Promise<void> {
    if (this.#reloading) {
      this.#reloadAgain = true
      return this.#reloading
    }
    const run = async (): Promise<void> => {
      do {
        this.#reloadAgain = false
        await this.#readRows()
      } while (this.#reloadAgain)
    }
    this.#reloading = run().finally(() => { this.#reloading = null })
    return this.#reloading
  }

  async #readRows(): Promise<void> {
    const src = this.source()
    if (!src || !this.open()) return
    this.#bindSourceChanges(src)
    try { this.items.set(await src.items()) } catch { /* keep the last good list */ }
    this.#cdr.markForCheck()
  }

  /** Listen to the ACTIVE source's own change signal — how it reports pictures,
   *  keywords and titles that resolved after `items()` had already answered. One
   *  subscription at a time: a source we have switched away from has no business
   *  making this panel re-read. */
  #bindSourceChanges(src: AggregateSource): void {
    if (this.#boundSource === src) return
    this.#boundSource?.changed?.removeEventListener('change', this.#sourceChanged)
    this.#boundSource = src
    src.changed?.addEventListener('change', this.#sourceChanged)
  }

  // ── filtering ───────────────────────────────────────────────────────────────

  onQuery(v: string): void { this.query.set(v ?? '') }

  // No tag toggles here. This window still LISTENS to `tags:filter` (below), so a
  // keyword chosen on the one pheromone surface still narrows the list — it just
  // has no second set of chips of its own to choose it from.

  clearFilter(): void {
    this.query.set('')
    if (this.#activeTags().size === 0) return
    this.#activeTags.set(new Set())
    EffectBus.emit('tags:filter', { active: [], scope: this.#filterScope })
  }

  // ── rows ────────────────────────────────────────────────────────────────────

  openItem(item: AggregateItem): void {
    if (this.#swallowClick) { this.#swallowClick = false; return }
    if (this.renaming() === item.key) return
    this.source()?.open(item)
  }

  /** Deterministic per-item accent (hue from the label) — each row gets its own
   *  identity tint, the same idea as the hive's label-derived colours. */
  accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 62% 64%)`
  }

  /** Initial(s) for an item with no picture, so an imageless row still says
   *  WHICH item it is rather than showing a generic icon. */
  monogram(label: string): string {
    const w = (label ?? '').trim().split(/\s+/).filter(Boolean)
    if (!w.length) return '·'
    if (w.length === 1) return [...w[0]].slice(0, 2).join('').toUpperCase()
    return ([...w[0]][0] + [...w[1]][0]).toUpperCase()
  }

  canRemove(item: AggregateItem): boolean {
    const src = this.source()
    if (!src?.remove) return false
    return src.canRemove ? src.canRemove(item) : true
  }

  canRename(item: AggregateItem): boolean { return !!this.source()?.rename }

  // ── versions ────────────────────────────────────────────────────────────────
  //
  // One row at a time. The list is a chain, and two of them open at once reads
  // as one long list of versions belonging to nothing in particular.

  canPickVersion(): boolean { return !!this.source()?.versions }

  /** Open (or put away) the chain behind a row. Loading is signalled rather than
   *  awaited silently — a site with a long lineage takes a moment, and an empty
   *  panel that later fills in reads as "no versions". */
  async toggleVersions(item: AggregateItem, ev?: Event): Promise<void> {
    ev?.stopPropagation()
    if (this.versionsFor() === item.key) { this.#closeVersions(); return }

    const src = this.source()
    if (!src?.versions) return
    this.versionsFor.set(item.key)
    this.versions.set([])
    this.versionsLoading.set(true)
    this.#cdr.markForCheck()

    let rows: readonly AggregateVersion[] = []
    try { rows = await src.versions(item) } catch { /* an unreadable chain is an empty one */ }
    // The row may have been closed (or another opened) while we read.
    if (this.versionsFor() !== item.key) return
    this.versions.set(rows)
    this.versionsLoading.set(false)
    this.#cdr.markForCheck()
  }

  /** The rows of ONE chain, in the order the source gave them. Split rather than
   *  concatenated so the two never read as a single timeline. */
  versionsOf(origin: AggregateVersion['origin']): readonly AggregateVersion[] {
    return this.versions().filter(v => v.origin === origin)
  }

  /** "2026-07-26 14:03", or nothing when the chain doesn't know. */
  versionTime(at?: number): string {
    if (!at) return ''
    const d = new Date(at)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  /** Choose a version. The chain is re-read afterwards rather than patched in
   *  place: what "active" now means is the source's answer, not ours — a
   *  published pick can be refused by the installer and the list must say so. */
  async chooseVersion(item: AggregateItem, version: AggregateVersion): Promise<void> {
    const src = this.source()
    if (!src?.useVersion || version.active) return
    this.versionsLoading.set(true)
    this.#cdr.markForCheck()
    try { await src.useVersion(item, version) } catch { /* fall through — the re-read tells the truth */ }
    if (this.versionsFor() !== item.key) return
    try { this.versions.set(await src.versions?.(item) ?? []) } catch { /* keep the last good list */ }
    this.versionsLoading.set(false)
    await this.reload()
  }

  #closeVersions(): void {
    this.versionsFor.set(null)
    this.versions.set([])
    this.versionsLoading.set(false)
  }

  // ── manage ──────────────────────────────────────────────────────────────────

  /** Make what is typed. The + and Enter are the same act — there is only one
   *  thing this field can commit — and both are inert unless `creatable`, so
   *  Enter while merely narrowing the list does nothing rather than minting a
   *  second row for a name that is already there.
   *
   *  The field is CLEARED on success, which also drops the filter: you have just
   *  made the thing you were looking for, so the list should show it among its
   *  siblings rather than stay narrowed to the one word you typed. */
  async submitCreate(): Promise<void> {
    if (!this.creatable()) return
    const src = this.source()
    const name = this.draft()
    if (!src?.create || !name) return
    let added: AddedRows
    // A failed create leaves the typing intact so it can be retried.
    try { added = await src.create(name) } catch { return }
    this.query.set('')
    this.#showAdded(added)
    this.#focusSoon('.ai-filter-input')
  }

  startRename(item: AggregateItem, ev?: Event): void {
    ev?.stopPropagation()
    this.renaming.set(item.key)
    this.#focusSoon('.ai-rename-input')
  }

  cancelRename(): void { this.renaming.set(null) }

  async commitRename(item: AggregateItem, input: HTMLInputElement): Promise<void> {
    const src = this.source()
    const next = safeCellName(input.value)
    if (!src?.rename || !next || next === item.label) { this.renaming.set(null); return }
    try { await src.rename(item, next) } catch { /* fall through — close the field */ }
    this.renaming.set(null)
    await this.reload()
  }

  // ── carrying ────────────────────────────────────────────────────────────────

  isCarried(item: AggregateItem): boolean {
    return this.carried().some(c => c.key === item.key)
  }

  /** Pick a row up, or put it back down. Its own control, never the row body:
   *  the body already means open, and a press-and-move already means drag. */
  toggleCarry(item: AggregateItem, event?: Event): void {
    event?.stopPropagation()
    this.carried.update(list => this.isCarried(item)
      ? list.filter(c => c.key !== item.key)
      : [...list, item])
  }

  dropCarried(): void {
    this.carried.set([])
  }

  // ── pin as home ─────────────────────────────────────────────────────────────
  //
  // Home follows the last portal you walked, which is right while you are still
  // finding the thing and wrong once you have found it — dip into something
  // else and home moves off what you meant. Pinning stops the drift: the pin
  // outranks the walk.
  //
  // Portals only. Every source's `segments` is "what this row points at", so
  // the mechanism would work anywhere, but a home that is a tag row or a search
  // hit is not a place you meant to keep.

  private get portals(): RecentPortalsStore | undefined {
    return get('@hypercomb.social/RecentPortalsStore') as RecentPortalsStore | undefined
  }

  /** Whether this view's rows can be pinned as home. */
  canPinHome(): boolean {
    return this.source()?.id === PORTALS_SOURCE_ID && !!this.portals
  }

  isHome(item: AggregateItem): boolean {
    return !!this.portals?.isPinned(item.segments)
  }

  /** Pin this row as home, or release it if it already is. Mutually exclusive
   *  by construction — the store holds ONE pin, so pinning another is what
   *  releases this one; nothing here has to hunt down the previous row. */
  toggleHome(item: AggregateItem, event?: Event): void {
    event?.stopPropagation()
    this.portals?.togglePin(item.label, item.segments)
    this.#cdr.markForCheck()
  }

  /**
   * Apply everything carried, here — one reference per item, at the page in
   * front of you.
   *
   * WHAT LANDS, AND WHAT DOES NOT:
   *
   *   • A reference per item. Nothing is copied; the target is untouched.
   *   • The bouquet in hand, if any, onto the NEW REFERENCE CELLS. Applying a
   *     batch is exactly when a shared mark earns its keep — that batch is the
   *     subset you will want to see alone later — and the mark belongs on the
   *     incidence, never on the target.
   *   • NOT the marks the source references carry. A mark on `friends/susan`
   *     says something about THAT membership; copying it here would assert the
   *     same thing about a different one. If it should be true here too, it is
   *     something you say here.
   *
   * One pulse for the whole batch (see `dropReferenceTile`): a pulse awaits
   * every bee and repaints the hive, so it is priced per gesture.
   */
  async applyCarried(): Promise<void> {
    const items = this.carried()
    if (items.length === 0) return
    const here = this.#segments()

    // ── A NAME IS AN ADDRESS, so an occupied one must be REFUSED ─────────────
    //
    // `sha256(lineageKey([...here, name]))` is the whole identity of the tile
    // this would create. If something already answers to that name here, the
    // commit does not make a second tile — it appends a marker to the EXISTING
    // one, quietly turning that tile into a reference and stamping the batch's
    // marks on it. Caught in the browser: applying `people` at the root wrote
    // into the real `people` collection.
    //
    // So an occupied address is skipped and counted, never merged and never
    // auto-suffixed: `people-2` is a name nobody chose. Wanting a second alias
    // under one parent is a naming act, and the drag path asks for the name.
    const seen = new Set<string>()
    const created: string[] = []
    let skipped = 0
    for (const item of items) {
      const name = safeCellName(item.label)
      // Two rows can carry the same label from different collections; the
      // second would land on the first's address.
      if (!name || seen.has(name)) { skipped++; continue }
      seen.add(name)
      if (await this.#addressTaken([...here, name])) { skipped++; continue }
      const made = await dropReferenceTile(item, here)
      if (made) created.push(made)
    }
    if (created.length === 0) {
      this.dropCarried()
      if (skipped > 0) this.#toast('aggregate.apply.none.title', 'aggregate.apply.none.message',
        { count: skipped }, 'Nothing applied', `${skipped} already answer to that name here.`)
      return
    }

    // Scent the batch BEFORE the pulse, so the references and their marks reach
    // the hive in the same repaint rather than as a tile that flickers unmarked.
    const marks = this.#brushMarks()
    if (marks.length) for (const name of created) await dropTagsOnTile(marks, [...here, name])

    await new hypercomb().act()
    this.dropCarried()
    // `tags:changed` carries `{updates:[{cell,tag}]}` — every other emitter in
    // the app sends that shape and its handlers iterate it, so a `{segments}`
    // payload throws inside the bus handler instead of failing visibly.
    if (marks.length) {
      EffectBus.emit('tags:changed', {
        updates: created.flatMap(cell => marks.map(tag => ({ cell, tag }))),
      })
    }

    const page = this.hereLabel() || 'home'
    const tail = skipped > 0 ? ' ' + (this.#t('aggregate.applied.skipped', { count: skipped })
      ?? `${skipped} skipped — already named here.`) : ''
    this.#toast(
      'aggregate.applied.title',
      marks.length ? 'aggregate.applied.marked' : 'aggregate.applied.message',
      { count: created.length, page, marks: marks.join(', ') },
      `Applied ${created.length}`,
      marks.length
        ? `${created.length} references, scented ${marks.join(', ')}.`
        : `${created.length} references landed on ${page}.`,
      tail,
    )
    void this.reload()
  }

  /** Is this location already spoken for? A bag that has ever been committed
   *  answers, which is deliberately conservative: committing onto a name whose
   *  tile was removed resurrects that lineage rather than starting a new one. */
  async #addressTaken(segments: readonly string[]): Promise<boolean> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as {
      sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
      currentLayerAt(sig: string): Promise<unknown | null>
    } | undefined
    if (!history?.sign) return false
    try {
      const sig = await history.sign({ explorerSegments: () => [...segments] })
      return !!(await history.currentLayerAt(sig))
    } catch { return false }   // unknowable → let the write decide
  }

  #t(key: string, params?: Record<string, unknown>): string | undefined {
    const i18n = ioc()?.get('@hypercomb.social/I18n') as
      { t(k: string, p?: Record<string, unknown>): string } | undefined
    return i18n?.t(key, params)
  }

  #toast(titleKey: string, messageKey: string, params: Record<string, unknown>,
         titleFallback: string, messageFallback: string, tail = ''): void {
    EffectBus.emit('toast:show', {
      type: 'info',
      title: this.#t(titleKey, params) ?? titleFallback,
      message: (this.#t(messageKey, params) ?? messageFallback) + tail,
    })
  }

  /** Commit the staged selection as members. The canvas selection is cleared
   *  afterwards: the staged rows have become real ones, and leaving them
   *  selected would offer to add what was just added. */
  async addStaged(): Promise<void> {
    const src = this.source()
    const entries = this.staged()
    if (!src?.add || entries.length === 0) return
    // Destination is the page we are standing on when that page is one of our
    // collections; otherwise the index itself.
    let added: AddedRows = undefined
    try { added = await src.add(entries, this.destination() ?? undefined) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#dropStaged()
    this.#showAdded(added)
  }

  /** A tile was dropped (via its drag handle) onto one of our portal rows —
   *  add it to THAT portal, wherever we happen to be standing. Same write as
   *  Add: a reference in the portal, pointing at where the tile lives.
   *
   *  Guards mirror the staged-tray rule from the other direction: the portal
   *  itself, and a tile that already lives inside it, are already "in there" —
   *  the drop says so instead of minting a duplicate doorway. */
  async #onPortalCarryDrop(p: { label?: string; segments?: string[]; targetKey?: string } | null): Promise<void> {
    const src = this.source()
    if (!src?.add || !this.portalDropView()) return
    const item = this.items().find(i => i.key === String(p?.targetKey ?? ''))
    const label = String(p?.label ?? '').trim()
    const segments = (p?.segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (!item || !label || segments.length === 0) return
    if (sameSegments(segments, item.segments) || sameSegments(segments.slice(0, -1), item.segments)) {
      EffectBus.emit('activity:log', { message: `"${label}" is already in "${item.label}"`, icon: '○' })
      return
    }
    try { await src.add([{ label, segments }], item) }
    catch { return }
    EffectBus.emit('activity:log', { message: `added "${label}" to "${item.label}"`, icon: '◈' })
    void this.reload()
  }

  /** File the staged tiles away INTO the collection we are standing in — they
   *  leave the page they were picked on and land here.
   *
   *  No optimistic row: a move does not change THIS list (the collection is
   *  already a row in it), it changes what that collection holds — and the tiles
   *  land on the page in front of you, which is feedback enough. The selection is
   *  cleared for the same reason Add clears it: those tiles are somewhere else
   *  now, and offering to move them again would name tiles that have moved. */
  async moveStaged(): Promise<void> {
    const src = this.source()
    const into = this.destination()
    const entries = this.staged()
    if (!src?.move || !into || entries.length === 0) return
    try { await src.move(entries, into) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#dropStaged()
    this.#cdr.markForCheck()
    void this.reload()
  }

  /** Save the page we are standing on into the index. */
  async addHere(): Promise<void> {
    const src = this.source()
    const segments = this.here()
    if (!src?.add || !this.canAddHere()) return
    let added: AddedRows = undefined
    try { added = await src.add([{ label: this.hereLabel(), segments }]) }
    catch { /* fall through — the re-read shows the truth */ }
    this.#showAdded(added)
  }

  /** Put what a gesture just wrote on screen NOW, then re-read in the background.
   *
   *  The write is a few milliseconds of local OPFS; re-deriving every row is not.
   *  Awaiting the re-read before showing anything is what made the Organizer feel
   *  slow — the row you asked for existed almost immediately but stayed invisible
   *  until every OTHER row had been re-resolved too.
   *
   *  Rows are shown only AFTER the write resolved, never before: an optimistic row
   *  for a commit that failed is a lie the panel would have no way to take back.
   *  The re-read is deliberately not awaited — it only adds pictures and keywords
   *  to rows that are already correct. */
  #showAdded(added: AddedRows): void {
    const rows = added ?? []
    if (rows.length) {
      const known = new Set(this.items().map(i => i.key))
      const fresh = rows.filter(r => !known.has(r.key))
      if (fresh.length) this.items.update(list => [...list, ...fresh])
    }
    this.#cdr.markForCheck()
    void this.reload()
  }

  async remove(item: AggregateItem, ev?: Event): Promise<void> {
    ev?.stopPropagation()
    const src = this.source()
    if (!src?.remove || !this.canRemove(item)) return
    try { await src.remove(item) } catch { return }
    await this.reload()
  }

  // ── drag → drop meaning ─────────────────────────────────────────────────────

  onRowPointerDown(event: PointerEvent, item: AggregateItem): void {
    if (event.button !== 0) return
    if (this.renaming() === item.key) return
    this.#pending = { item, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    // A native drag or touch pan steals the gesture and we get pointercancel
    // with no pointerup — without this the ghost hangs and the listeners leak.
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #onDragCancel = (): void => {
    this.#pending = null
    this.#detachDrag()
    if (this.dragging()) {
      this.dragging.set(null)
      EffectBus.emit('drop:dragging', { active: false })
      this.#cdr.detectChanges()
    }
  }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.dragging()) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      this.dragging.set(p.item)
      EffectBus.emit('drop:dragging', { active: true })
    }
    this.dragPos.set({ x: event.clientX, y: event.clientY })
    this.#cdr.detectChanges()
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.dragging() !== null
    this.#pending = null
    this.#detachDrag()
    if (!wasDragging || !p) return

    this.dragging.set(null)
    EffectBus.emit('drop:dragging', { active: false })
    this.#cdr.detectChanges()
    this.#swallowClick = true
    const groupTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (groupTarget?.closest?.('hc-filter-configurations')) {
      EffectBus.emit('filter-config:place-drop', { item: p.item })
      return
    }

    // RELEASE POINT, not a remembered hover — see the header note.
    const overlay = ioc()?.get('@diamondcoreprocessor.com/TileOverlayDrone') as OverlayLike | undefined
    const label = overlay?.labelAtClient?.(event.clientX, event.clientY) ?? null

    // A release still over this panel is a cancelled drag, not a drop on the
    // hive — otherwise letting go on the list would silently write.
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    if (el?.closest?.('hc-aggregate-index')) return

    void this.#applyDrop(p.item, label)
  }

  async #applyDrop(item: AggregateItem, label: string | null): Promise<void> {
    const here = (this.#lineage?.explorerSegments?.() ?? []).map(String)
    if (label) {
      // ── Dropped ON a tile → the item becomes that tile's CONTEXT ──────────
      //
      // There is no room on an occupied hex, so this drop cannot mean "put it
      // here"; it says something about the TILE — that answering questions
      // about it means knowing about the dropped place too. Written as a live
      // pointer (see `dropContextOnTile`), so the context follows the source
      // rather than freezing a copy of it.
      //
      // This used to copy the item's KEYWORDS onto the tile (membership). That
      // meaning moved out entirely rather than being kept behind a modifier:
      // marks belong to the pheromone panel, where painting one is deliberate.
      const attached = await dropContextOnTile(item, [...here, label])
      await new hypercomb().act()
      this.#toast(
        attached ? 'aggregate.context.added.title' : 'aggregate.context.failed.title',
        attached ? 'aggregate.context.added.message' : 'aggregate.context.failed.message',
        { name: item.label, cell: label },
        attached ? 'Context attached' : 'Could not attach',
        attached
          ? `"${item.label}" now informs questions about "${label}".`
          : `"${item.label}" could not be attached to "${label}".`,
      )
      return
    }
    // ── Dropped on empty hive → THE NAME IS ASKED FOR ──────────────────────
    //
    // A reference mints a new LOCATION, and a location's name IS its address
    // (`sha256(lineageKey(segments))`). So the name cannot be an afterthought:
    // renaming later is a title decoration, which changes the reading and not
    // the address, and dropping the same target twice under one parent would
    // land on the same bag instead of making two references.
    //
    // Rather than grow a dialog mid-gesture, the drop COMPOSES the command that
    // already does this correctly and hands it over with the name selected:
    // Enter takes the target's own name, typing replaces it. One writer
    // (`/reference <name> = <path>`, race-free create+decorate in essentials),
    // one place where the name is decided, and the composable path stays open —
    // whatever else you can type on that line still works.
    //
    // ── THE FILTER, AND WHY IT IS PRE-WRITTEN ────────────────────────────────
    //
    // A portal can demand pheromones of what it shows ("People, but only
    // family"), and the line is where that is said: `+ family, @field-notes`,
    // completed live from the pheromone and bouquet pools (see
    // `ReferenceQueenBee.slashComplete`).
    //
    // A tail nobody knows about is a tail nobody types, so the BRUSH writes the
    // first one. If the pheromone panel has marks in hand at the moment of the
    // drop, they arrive already spelled out on the line — the same marks
    // `applyCarried` lands on a batch, said out loud instead of applied
    // invisibly. You can delete them; what you cannot do is fail to notice that
    // the syntax exists.
    const path = item.segments.map(s => String(s ?? '')).filter(Boolean).join('/')
    const name = safeCellName(item.label) || (item.segments[item.segments.length - 1] ?? '')
    if (!path || !name) return
    const head = '/reference '
    const marks = this.#brushMarks()
    const tail = marks.length ? ` + ${marks.join(', ')}` : ''
    EffectBus.emit('search:prefill', {
      value: `${head}${name} = ${path}${tail}`,
      focus: true,
      // The NAME is selected, never the tail: naming is the decision the drop
      // could not make for you, and the filter is one you have already made (or
      // left empty). Enter accepts both.
      select: [head.length, head.length + name.length],
      // The dragged row's own face, in the glyph slot — so the line says WHAT
      // it is about while you are busy deciding what to call it.
      subject: { previewUrl: item.image, label: item.label, icon: 'conversion_path' },
    })
  }

  // ── activation ──────────────────────────────────────────────────────────────

  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onLineage)
      this.#lineageBound = true
    }
  }

  /** NAVIGATION DROPS THE CAPTURE (Jaime, 2026-07-28): "save tile to
   *  organizer or places … has to reset and lose that selection when
   *  navigation happens." A tray that follows you around the hive keeps
   *  offering to file tiles you picked on a page you have since left, and the
   *  offer reads as live because the buttons are still lit.
   *
   *  This REVERSES the survive-the-hop behaviour the tray used to have, and
   *  the cost is one flow: "select tiles → step INTO the collection → press
   *  Add" can no longer complete, because the step in is now what clears the
   *  tray. Picking the destination from the panel's own row (Add to <name>)
   *  does the same job without moving the hive, and still works. */
  #onLineage = (): void => {
    this.#dropStaged()
    this.#refresh()
  }

  /** Arriving at a source's own location opens its index; leaving does NOT close
   *  the panel (a tool window you opened stays open while you walk around).
   *  Only a fresh ARRIVAL re-opens it after a close. */
  /** The hive's current location as clean segments. */
  #segments(): readonly string[] {
    this.#ensureLineage()
    return (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #refresh(): void {
    const segs = this.#segments()
    this.here.set(segs)
    const src = sourceForLocation(segs)
    const arrived = !!src && !this.#atSource
    this.#atSource = !!src

    if (src) this.source.set(src)
    // Walking ONTO the index page (e.g. /sets) still opens it. That arrival is
    // its own origin — there is nowhere else to go back to.
    if (arrived) {
      if (!this.open()) this.origin.set(segs)
      this.open.set(true)
    }
    if (this.open()) void this.reload()
    else this.renaming.set(null)
  }

  #focusSoon(selector: string): void {
    setTimeout(() => {
      const el = document.querySelector(`hc-aggregate-index ${selector}`) as HTMLInputElement | null
      el?.focus()
      el?.select?.()
    }, 0)
  }

  /** Escape unwinds the innermost thing that is OURS — a rename field, then what
   *  is typed in the search field, then the panel, and the panel only when focus
   *  is inside it. The panel is docked beside a live hive, so it must not swallow
   *  the shell's escape cascade when the participant is out on the canvas.
   *
   *  Only the LOCAL query is cleared, never the keyword filter: that one is
   *  shared with the controls bar and the hive, so unwinding it from in here
   *  would silently unflatten the canvas too. */
  /** One level back per press: the rename field, then the query. False = we
   *  had nothing open, and the shell cascade carries on past us.
   *
   *  This used to be a window listener that ended with its own
   *  `panel.contains(target)` test — the focus gate, hand-rolled, and the proof
   *  the gate is the right rule. It is the cascade's job now, so the listener
   *  and the test are both gone. */
  dismiss(): boolean {
    if (!this.open()) return false
    if (this.renaming()) { this.renaming.set(null); return true }
    if (this.query()) { this.query.set(''); return true }
    return false
  }
}

registerShellSurface({
  name: 'hc-aggregate-index',
  owner: '@hypercomb.shared/AggregateIndexComponent',
  component: AggregateIndexComponent,
  order: 61,
})
