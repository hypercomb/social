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
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import {
  aggregateSources, getAggregateSource, sourceForLocation,
  type AddedRows, type AggregateItem, type AggregateSource, type AggregateVersion, type StagedEntry,
} from './aggregate-source'
import { dropReferenceTile, dropTagsOnTile, safeCellName } from './aggregate-drop'
import { onSelection, withSelectionService } from '../../core/selection-context'

/** Movement before a press counts as a drag rather than a click — small enough
 *  to feel immediate, large enough that a click that jitters still opens. */
const DRAG_THRESHOLD = 5

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
   *  the same place would be a duplicate row. Adding INTO a collection only
   *  skips the collection itself; a tile can legitimately be a member of many
   *  collections, and that is the whole point. Empty unless the active source
   *  actually supports adding. */
  readonly staged = computed<readonly StagedEntry[]>(() => {
    if (!this.source()?.add) return []
    const into = this.destination()
    if (into) {
      const self = into.segments.join(KEY_SEP)
      return this.selection().filter(e => e.segments.join(KEY_SEP) !== self)
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
  /** The page the staged capture was taken on — how an empty selection update
   *  from a NAVIGATION is told apart from a real deselect (see the constructor). */
  #stagedAt: readonly string[] | null = null
  #pending: { item: AggregateItem; x: number; y: number } | null = null
  #swallowClick = false

  constructor() {
    // Selection is last-value replayed, so opening the panel after selecting
    // still stages what is already picked.
    //
    // THE TRAY IS A CAPTURE, NOT A MIRROR — and this is what makes the whole
    // destination flow possible. SelectionService is derived from the URL: every
    // `navigate` reconciles it against what the new address carries, which for a
    // fresh page is nothing. So walking into a collection to add tiles TO it
    // arrived here as "selection is now empty", the tray emptied, and both
    // buttons vanished at the exact moment they were meant to be pressed —
    // "select tiles, step into the collection, press Add" could never complete
    // (verified on the dev hive: the staged tray was gone the instant the row
    // was clicked). Capturing each entry with its own absolute `segments` was
    // always half of the fix; keeping the capture across the hop is the other.
    //
    // An empty update is only honoured when it arrives AT THE PAGE THE CAPTURE
    // WAS MADE ON — a real deselect out on the canvas. Verified in a real
    // browser: Lineage has already moved by the time the clear event fires, so
    // this comparison distinguishes the two cases with no timing guess. Every
    // other way the tray empties is deliberate: completing an Add or a Move,
    // going back to the origin, or closing the window.
    this.#cleanups.push(onSelection(({ selected }) => {
      const here = this.#segments()
      if (selected.length === 0 && this.selection().length > 0
        && this.#stagedAt && !sameSegments(this.#stagedAt, here)) return
      this.selection.set(selected.map(label => ({ label, segments: [...here, label] })))
      if (selected.length > 0) this.#stagedAt = here
      this.#cdr.detectChanges()
    }))
    this.#cleanups.push(EffectBus.on<{ id?: string }>('aggregate:view-open', (p) => this.openPanel(p?.id)))
    this.#cleanups.push(EffectBus.on<{ id?: string }>('aggregate:view-toggle', (p) => this.togglePanel(p?.id)))
    this.#cleanups.push(EffectBus.on('aggregate:view-close', () => this.close()))
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
    window.addEventListener('keydown', this.#onKey, true)
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    for (const off of this.#cleanups) off()
    aggregateSources.removeEventListener('change', this.#sourceChanged)
    this.#boundSource?.changed?.removeEventListener('change', this.#sourceChanged)
    window.removeEventListener('synchronize', this.#sourceChanged)
    window.removeEventListener('navigate', this.#onLineage)
    window.removeEventListener('keydown', this.#onKey, true)
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
    // Explicitly, because the tray now SURVIVES navigation: this control's whole
    // purpose is to drop what is staged and start again, so it must say so
    // rather than rely on a clear that no longer reaches the tray.
    this.#dropStaged()
    ;(ioc()?.get('@hypercomb.social/Navigation') as { goRaw?(s: readonly string[]): void } | undefined)
      ?.goRaw?.(o)
  }

  /** Empty the tray on purpose — after a completed gesture, or on the way back
   *  to the origin. The one place `#stagedAt` is forgotten with it. */
  #dropStaged(): void {
    withSelectionService(s => s.clear())
    this.selection.set([])
    this.#stagedAt = null
  }

  /** Whether this row is the collection currently being managed (the hive is
   *  standing in it), so the list shows WHICH one you stepped into. */
  isSelected(item: AggregateItem): boolean {
    return sameSegments(item.segments, this.here())
  }

  close(): void {
    if (!this.open()) return
    this.open.set(false)
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
      // Dropped ON a tile → attach this item's keywords, making that tile a
      // member of everything parameterised by them.
      const tags = item.tags ?? []
      if (!tags.length) {
        // A collection with no keyword has no pheromone to give, so there is
        // nothing to relate. Deliberately NOT auto-minting one from the name —
        // relating things is a pheromone act you do on purpose (Jaime: don't
        // create things on the fly here, it's already complicated). But dying
        // in silence made the drop feel broken, so narrate the task that
        // remains instead.
        const i18n = ioc()?.get('@hypercomb.social/I18n') as
          { t(k: string, p?: Record<string, unknown>): string } | undefined
        EffectBus.emit('toast:show', {
          type: 'info',
          title: i18n?.t('aggregate.drop-no-keyword.title') ?? 'No keyword yet',
          message: i18n?.t('aggregate.drop-no-keyword.message', { name: item.label })
            ?? `"${item.label}" carries no keyword — give it one first; its pheromones are what make a tile a member.`,
        })
        return
      }
      await dropTagsOnTile(tags, [...here, label])
      EffectBus.emit('tags:changed', { segments: [...here, label] })
      return
    }
    // Dropped on empty hive → a plain reference to the item, here. It demands
    // NOTHING at birth: what a reference filters its target by is a pheromone
    // act, and pheromones come from the pheromone panel, not from a palette this
    // window keeps of its own (see the note above `hasFilter`).
    //
    // The pulse is HERE rather than inside the write: one gesture, one repaint
    // (see dropReferenceTile). The re-read isn't awaited — the tile is on the
    // hive already, and this list only changes if the drop landed in the index.
    await dropReferenceTile(item, here)
    await new hypercomb().act()
    void this.reload()
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

  #onLineage = (): void => this.#refresh()

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
  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open()) return
    if (this.renaming()) { e.preventDefault(); this.renaming.set(null); return }
    if (this.query()) { e.preventDefault(); this.query.set(''); return }
    const target = e.target as Node | null
    const panel = document.querySelector('hc-aggregate-index .ai-panel')
    if (!panel || !target || !panel.contains(target)) return
    e.preventDefault()
    this.close()
  }
}

registerShellSurface({
  name: 'hc-aggregate-index',
  owner: '@hypercomb.shared/AggregateIndexComponent',
  component: AggregateIndexComponent,
  order: 61,
})
