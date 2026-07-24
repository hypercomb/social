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
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import {
  aggregateSources, getAggregateSource, sourceForLocation,
  type AggregateItem, type AggregateSource,
} from './aggregate-source'
import { dropReferenceTile, dropTagsOnTile, safeCellName } from './aggregate-drop'

/** Movement before a press counts as a drag rather than a click — small enough
 *  to feel immediate, large enough that a click that jitters still opens. */
const DRAG_THRESHOLD = 5

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type OverlayLike = { labelAtClient(x: number, y: number): string | null }

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

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
  readonly query = signal('')
  readonly creating = signal(false)
  readonly renaming = signal<string | null>(null)
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

  readonly allTags = computed(() => {
    const seen = new Set<string>()
    for (const i of this.items()) for (const t of i.tags ?? []) seen.add(t)
    return [...seen].sort((a, b) => a.localeCompare(b))
  })

  readonly hasFilter = computed(() => this.#activeTags().size > 0 || this.query().trim().length > 0)
  readonly canCreate = computed(() => !!this.source()?.create)

  readonly #cdr = inject(ChangeDetectorRef)
  readonly #activeTags = signal<ReadonlySet<string>>(new Set())
  #filterScope: 'local' | 'children' | 'global' = 'global'
  #lineage: LineageLike | null = null
  #lineageBound = false
  #atSource = false
  #cleanups: Array<() => void> = []
  #sourceChanged = (): void => { void this.reload() }
  #pending: { item: AggregateItem; x: number; y: number } | null = null
  #swallowClick = false

  constructor() {
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
    ;(ioc()?.get('@hypercomb.social/Navigation') as { goRaw?(s: readonly string[]): void } | undefined)
      ?.goRaw?.(o)
  }

  /** Whether this row is the collection currently being managed (the hive is
   *  standing in it), so the list shows WHICH one you stepped into. */
  isSelected(item: AggregateItem): boolean {
    return sameSegments(item.segments, this.here())
  }

  close(): void {
    if (!this.open()) return
    this.open.set(false)
    this.creating.set(false)
    this.renaming.set(null)
  }

  async reload(): Promise<void> {
    const src = this.source()
    if (!src || !this.open()) return
    try { this.items.set(await src.items()) } catch { /* keep the last good list */ }
    this.#cdr.markForCheck()
  }

  // ── filtering ───────────────────────────────────────────────────────────────

  onQuery(v: string): void { this.query.set(v ?? '') }
  isTagActive(tag: string): boolean { return this.#activeTags().has(tag) }

  /** Toggle a keyword on the SHARED filter — the same `tags:filter` the controls
   *  bar and Tags panel drive, at the reach they last chose, so the hive
   *  flattens to matching tiles and this list narrows from one gesture. */
  toggleTag(tag: string): void {
    const next = new Set(this.#activeTags())
    next.has(tag) ? next.delete(tag) : next.add(tag)
    this.#activeTags.set(next)
    EffectBus.emit('tags:filter', { active: [...next], scope: this.#filterScope })
  }

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

  // ── manage ──────────────────────────────────────────────────────────────────

  toggleCreate(): void {
    const next = !this.creating()
    this.creating.set(next)
    if (next) this.#focusSoon('.ai-create-input')
  }

  async create(input: HTMLInputElement): Promise<void> {
    const src = this.source()
    const name = safeCellName(input.value)
    if (!src?.create || !name) { input.focus(); return }
    try { await src.create(name) } catch { return }
    input.value = ''
    this.creating.set(false)
    await this.reload()
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
    // Dropped on empty hive → a reference to the item, here.
    await dropReferenceTile(item, here)
    await this.reload()
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
    else { this.creating.set(false); this.renaming.set(null) }
  }

  #focusSoon(selector: string): void {
    setTimeout(() => {
      const el = document.querySelector(`hc-aggregate-index ${selector}`) as HTMLInputElement | null
      el?.focus()
      el?.select?.()
    }, 0)
  }

  /** Escape unwinds the innermost thing that is OURS — a rename field, then the
   *  create field, then the panel, and the panel only when focus is inside it.
   *  The panel is docked beside a live hive, so it must not swallow the shell's
   *  escape cascade when the participant is out on the canvas. */
  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open()) return
    if (this.renaming()) { e.preventDefault(); this.renaming.set(null); return }
    if (this.creating()) { e.preventDefault(); this.creating.set(false); return }
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
