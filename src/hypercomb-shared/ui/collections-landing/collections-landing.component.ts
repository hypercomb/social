// hypercomb-shared/ui/collections-landing/collections-landing.component.ts
//
// The "Collections" entrance — a right-docked tool window over the `sets/`
// layer, listing every reference set with a filter above it. Clicking one
// portals to it.
//
// ── Why docked, not a full-screen landing (2026-07-23) ──────────────────────
// This used to be a full-screen takeover: `.landing` at `inset: 0` over opaque
// ink, plus a `render:set-hive-visible {visible:false}` that HID the Pixi hive.
// That surface is a fixed-size box, so collections simply fell off the bottom —
// and the hive was already better at exactly this job: an infinite canvas, fit,
// pan/zoom, and a real cross-page tag flatten. So `/sets` now renders as an
// ordinary hive page (collections ARE tiles) and this panel is the refined
// entrance BESIDE it. `hcDockInset` reserves the edge and the hex content is
// squeezed into what's left (pixi-host.worker #applyHostInset), so the canvas
// stays live next to the list instead of being replaced by it. This reverses
// the 2026-07-06 "keep the overlay" decision, deliberately.
//
// Because the hive owns `/sets` again, tile clicks there root-hop on their own
// (tile-overlay.drone's sets branch) — this panel and the canvas are two ways
// into the same thing, and neither is load-bearing for the other.
//
// A collection (a reference set) is its OWN ROOT lineage — the `sets/` page is
// just the index of them (the VARIABLE-ROOT hop, see entrances-and-sets.md and
// tile-overlay.drone's sets branch). So a card click navigates to `/[name]`,
// never `/sets/[name]`, and a collection's picture is resolved from its root.
//
// FILTERING is two-level, because the panel and the canvas answer different
// questions: the name field narrows THIS list (panel-local, instant), while a
// keyword chip emits the shared `tags:filter` so the HIVE flattens to every
// tile carrying it. The chips mirror that same effect, so the panel, the
// controls-bar pills and the Tags panel always agree on what's filtered.
//
// MANAGE (rename / delete): both go through the SAME per-page layer state
// machine as every other edit — a bare `cell:removed` / `cell:added` (no
// `viaUpdate`) routes through LayerCommitter's name-delta path and lands ONE
// history marker in the `/sets` bag, so each is a real, undoable commit. Rename
// = remove-old + add-new: the new name auto-mints a fresh sigbag (the sanctioned
// delete+create model — there is no in-place rename; a name is identity).
//
// Opens automatically on arrival at `/sets` (so the pools icon still lands
// somewhere useful) and on `collections:view-open` from anywhere — an entrance
// you can't reach from elsewhere isn't an entrance. Closing it is just closing
// a tool window; it never navigates. Self-registers as a shell surface (no
// app.html edit, no web/dev drift) and resolves everything through the global
// ioc at call time. Never imports essentials — every mutation goes through the
// sanctioned IoC services the command line uses.

import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { registerProximityProvider } from '../../core/proximity-registry'
import { groupRegistry } from '../../core/group-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'

/** The reserved lineage that indexes every reference set. */
const SETS = 'sets'
const TAG_DECORATION_KIND = 'tag'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void; back?: () => void }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type DecorationServiceLike = {
  list<TPayload>(opts: {
    kind: string
    segments: readonly string[]
  }): Promise<Array<{ sig: string; record: { payload?: TPayload } }>>
}
type TagRegistryLike = {
  ensureLoaded?: () => Promise<void>
  color?: (name: string) => string
}
/** The command line's create primitive — appends the membership child under the
 *  sets index. Read from IoC (essentials service); imports stay forbidden. */
type CommitterLike = {
  importTree?: (updates: { segments: readonly string[]; layer: { name?: string } }[]) => Promise<void>
  /** Canonical write surface: pass the FULL new children list for `sets/` and
   *  the committer lands ONE undoable marker. `children` names resolve at commit
   *  time, AUTO-MINTING any new name — so a rename swap mints a fresh sigbag. */
  update?: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
}

/** The per-page history cursor (essentials service). Binding it to `sets/`
 *  while the landing owns the screen makes Ctrl+Z / Ctrl+Y walk the collection
 *  index's OWN history — the landing replaces the hidden hive, so show-cell
 *  never loads this cursor otherwise. `currentLayerSig` is rewound-aware, so the
 *  grid reads the cursor's CURRENT position (not the head) to reflect an undo. */
type CursorLike = {
  load?: (locationSig: string) => Promise<void> | void
  currentLayerSig?: string
  state?: { locationSig?: string; rewound?: boolean }
}

const SIG = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)
/** Names become path segments — drop separators and control characters (mirrors
 *  the UNSAFE_CELL_NAME guard essentials uses). */
const safeCellName = (raw: string): string =>
  [...(raw ?? '')].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

const ioc = (): { get(k: string): unknown } | undefined =>
  (globalThis as { ioc?: { get(k: string): unknown } }).ioc

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

@Component({
  selector: 'hc-collections-landing',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './collections-landing.component.html',
  styleUrls: ['./collections-landing.component.scss'],
})
export class CollectionsLandingComponent implements OnDestroy {
  /** Names of the reference sets under `sets/` (the collection index). */
  readonly collections = signal<readonly string[]>([])
  /** The name field — narrows THIS list only. Case-insensitive substring; the
   *  canvas is deliberately untouched, since a typed prefix is a way of finding
   *  one collection, not a statement about what the hive should be showing. */
  readonly query = signal('')
  readonly visibleCollections = computed(() => {
    const active = this.#activeTagFilters()
    const q = this.query().trim().toLowerCase()
    let list = this.collections()
    if (active.size > 0) {
      list = list.filter(name => {
        const tags = this.tags().get(name) ?? []
        return tags.some(t => active.has(t))
      })
    }
    if (q) list = list.filter(name => name.toLowerCase().includes(q))
    return list
  })
  /** Every keyword carried by any collection in the index — the chip row. Sorted
   *  so the row doesn't reshuffle as tags resolve in. */
  readonly allTags = computed(() => {
    const seen = new Set<string>()
    for (const name of this.collections()) {
      for (const tag of this.tags().get(name) ?? []) seen.add(tag)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  })
  readonly hasFilter = computed(() => this.#activeTagFilters().size > 0 || this.query().trim().length > 0)
  readonly open = signal(false)
  readonly creating = signal(false)
  /** The collection currently being renamed (its old name), or null. */
  readonly renaming = signal<string | null>(null)
  /** collection name → object URL of its representative tile image (resolved
   *  from the collection's ROOT lineage). Revoked on destroy. */
  readonly images = signal<ReadonlyMap<string, string>>(new Map())
  /** collection name → whether its root lineage has no items yet. Rename and
   *  delete are offered ONLY for empty collections (nothing to lose). */
  readonly empty = signal<ReadonlyMap<string, boolean>>(new Map())
  readonly tags = signal<ReadonlyMap<string, readonly string[]>>(new Map())

  #lineage: LineageLike | null = null
  #lineageBound = false
  /** Whether the participant is standing ON the sets index. Drives the
   *  auto-open and gates the cursor binding — NOT the panel's visibility, which
   *  is now the participant's own (a tool window they opened or closed). */
  #atSets = signal(false)
  /** The reach the shared tag filter is currently running at. Mirrored off
   *  `tags:filter` so a chip toggled here re-broadcasts at the SAME width the
   *  controls bar / Tags panel last chose, instead of silently resetting it. */
  #filterScope: 'local' | 'children' | 'global' = 'global'
  #imageUrls = new Map<string, string>()
  #imageRequested = new Set<string>()
  #aggregateNames = new Set<string>()
  #tags = new Map<string, readonly string[]>()
  #activeTagFilters = signal<ReadonlySet<string>>(new Set())
  /** collection name → its ROOT lineage sig (`sign(['<name>'])`), memoized so the
   *  proximity provider doesn't re-sign every navigation. Each is one click from
   *  being the active root — the shell's nav-driven warmer pre-warms them. */
  #rootSigByName = new Map<string, string>()
  #unregisterProximity: (() => void) | null = null
  #empty = new Map<string, boolean>()
  /** Cached sign(['sets']) — the history location of the collection index. */
  #setsSig = ''
  #reloadScheduled = false
  #onChange = (): void => this.#refresh()
  /** Commits (create/delete/rename here, or anywhere) pulse the processor;
   *  reload the index so the grid reflects the committed state. */
  #onSynchronize = (): void => this.#scheduleReload()
  #cursorUnsub: (() => void) | null = null
  #filterUnsub: (() => void) | null = null
  #openUnsub: (() => void) | null = null
  #closeUnsub: (() => void) | null = null
  #tagsChangedUnsub: (() => void) | null = null
  #groupChanged = (): void => this.#scheduleReload()

  constructor() {
    window.addEventListener('keydown', this.#onKey, true)
    window.addEventListener('synchronize', this.#onSynchronize)
    // Undo/redo moves the history cursor; reflect it when it reaches this index.
    this.#cursorUnsub = EffectBus.on('history:cursor-changed', () => this.#scheduleReload())
    this.#filterUnsub = EffectBus.on<{ active?: readonly string[]; scope?: string }>('tags:filter', (p) => {
      this.#activeTagFilters.set(new Set((p?.active ?? []).map(t => String(t)).filter(Boolean)))
      const scope = p?.scope
      if (scope === 'local' || scope === 'children' || scope === 'global') this.#filterScope = scope
    })
    // The entrance is reachable from anywhere — that is what makes it an
    // entrance rather than a page decoration.
    this.#openUnsub = EffectBus.on('collections:view-open', () => this.openPanel())
    this.#closeUnsub = EffectBus.on('collections:view-close', () => this.close())
    this.#tagsChangedUnsub = EffectBus.on('tags:changed', () => this.#scheduleReload())
    groupRegistry.addEventListener('change', this.#groupChanged)
    // Declare our cards as proximity: while the grid is showing, every collection
    // root is one click from being the active root, so the shell's nav-driven
    // warmer pre-warms their subtrees. Off-screen we contribute nothing.
    this.#unregisterProximity = registerProximityProvider(this.#proximitySigs)
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    this.#lineage?.removeEventListener?.('change', this.#onChange)
    window.removeEventListener('keydown', this.#onKey, true)
    window.removeEventListener('synchronize', this.#onSynchronize)
    this.#unregisterProximity?.()
    this.#cursorUnsub?.()
    this.#filterUnsub?.()
    this.#openUnsub?.()
    this.#closeUnsub?.()
    this.#tagsChangedUnsub?.()
    groupRegistry.removeEventListener('change', this.#groupChanged)
    for (const url of this.#imageUrls.values()) URL.revokeObjectURL(url)
  }

  /** Deterministic per-collection accent (hue from the name) — each card gets
   *  its own identity tint, the same idea as the hive's label-derived colours. */
  accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 62% 64%)`
  }

  /** A compact identity label for a collection with no image to reflect (empty,
   *  or its picture not yet resolved) — its initial(s), tinted by the accent — so
   *  an imageless hex still says WHICH collection it is at a glance, instead of a
   *  generic icon shared by every empty set. The full name still shows below. */
  monogram(name: string): string {
    const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
    if (!words.length) return '·'
    if (words.length === 1) return [...words[0]].slice(0, 2).join('').toUpperCase()
    return ([...words[0]][0] + [...words[1]][0]).toUpperCase()
  }

  /** Rename and delete are offered only for an EMPTY collection (its root has no
   *  items) — so a manage gesture can never silently drop content. Unknown
   *  emptiness (still resolving) reads as not-manageable until confirmed. */
  manageable(name: string): boolean {
    if (this.#aggregateNames.has(name)) return false
    return this.empty().get(name) === true
  }

  tagsFor(name: string): readonly string[] {
    return this.tags().get(name) ?? []
  }

  tagColor(name: string): string {
    const registry = ioc()?.get('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    const color = registry?.color?.(name)
    if (color) return color
    let h = 5381
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 70% 62%)`
  }

  /** Open a collection root listed by the sets index. */
  openCollection(name: string): void {
    if (this.renaming() === name) return   // this card's rename field is open
    if (groupRegistry.get(name)) { groupRegistry.show(name); return }
    const nav = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    nav?.goRaw?.([name])
  }

  /** Reveal / hide the inline create field. */
  toggleCreate(): void {
    const next = !this.creating()
    this.creating.set(next)
    if (next) this.#focusSoon('.create-input')
  }

  /** Focus (and select) an input the moment Angular has rendered it. autofocus
   *  doesn't fire on dynamically-inserted fields, so drive it explicitly. There
   *  is only ever one create field / one rename field, so the selector is
   *  unambiguous; scoped to this component's own DOM. */
  #focusSoon(selector: string): void {
    setTimeout(() => {
      const el = document.querySelector(`hc-collections-landing ${selector}`) as HTMLInputElement | null
      el?.focus()
      el?.select?.()
    }, 0)
  }

  /** Create a new referenceable collection: append the membership child under
   *  the `sets/` index via the same importTree primitive the command line uses,
   *  then pulse the processor. The row is shown optimistically because a fresh
   *  index read can lag a just-made commit; the append is keyed by name and
   *  `#loadCollections` re-publishes only on a real change (`sameList`), so the
   *  authoritative read can't double it. The hive paints its own tile for the
   *  same commit — two views of one write, not two writes. */
  async create(input: HTMLInputElement): Promise<void> {
    const name = safeCellName(input.value)
    if (!name) { input.focus(); return }
    if (this.#aggregateNames.has(name)) { input.select(); return }
    if (!this.collections().includes(name)) {
      const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
      if (!committer?.importTree) return
      try {
        EffectBus.emit('cell:added', { cell: name, segments: [SETS], viaUpdate: true })
        await committer.importTree([{ segments: [SETS, name], layer: { name } }])
        await new hypercomb().act()
      } catch { return }   // commit failed — leave the field intact to retry
      this.#syncCursorToHead()
      // Show it now (a brand-new collection has no picture yet → fallback hex).
      this.collections.update(list => list.includes(name) ? list : [...list, name])
      this.#empty.set(name, true)               // brand new → empty → manageable
      this.empty.set(new Map(this.#empty))
    }
    input.value = ''
    this.creating.set(false)
  }

  /** Delete an EMPTY collection — write the new `sets/` children list (this one
   *  dropped) through the canonical `update` surface: ONE awaited, undoable
   *  history marker in the sets bag. The `cell:removed` notify (viaUpdate, so the
   *  committer doesn't double-commit) lets show-cell/substrate react. Content
   *  bytes are content-addressed and persist; this removes only the index entry. */
  async deleteCollection(name: string): Promise<void> {
    if (!this.manageable(name)) return
    const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
    if (!committer?.update) return
    const members = this.#indexMembers().filter(n => n !== name)
    try {
      EffectBus.emit('cell:removed', { cell: name, segments: [SETS], viaUpdate: true })
      await committer.update([SETS], { children: members })
      await new hypercomb().act()
    } catch { return }
    this.#syncCursorToHead()
    this.collections.set(this.collections().filter(n => n !== name))
    this.#forget(name)
  }

  /** The REAL `sets/` membership — the displayed list minus the launch-group
   *  aggregates that `#loadCollections` merges in so they're reachable here.
   *
   *  Every write to the index must compose from this, never from
   *  `collections()`: `children` is a NAME list that auto-mints at commit time,
   *  so committing the display list would materialise each aggregate as a real
   *  member of `sets/` — permanently polluting the index with launch groups
   *  that were only ever passing through the view. */
  #indexMembers(): readonly string[] {
    return this.collections().filter(n => !this.#aggregateNames.has(n))
  }

  // ── rename: re-home a collection's immutable history to a new signature pool ──

  /** Open the inline rename field on a card. Available for ANY collection — a
   *  cell is immutable/content-addressed, so rename just re-homes the same sigs
   *  under a new name; nothing is stranded, so no empty-gate. */
  startRename(name: string, ev?: Event): void {
    ev?.stopPropagation()
    this.renaming.set(name)
    this.#focusSoon('.set-rename-input')
  }

  cancelRename(): void { this.renaming.set(null) }

  /** Commit a rename by MOVING the collection's history to the new name's
   *  signature pool. A cell is immutable + content-addressed, so this is not a
   *  mutation: the new root simply references the SAME child sigs (no byte copy),
   *  and the old name's history is left intact — immutable, merely unreferenced
   *  from the index. Two awaited, undoable markers: the new root's content and
   *  the sets/ membership swap (name-resolution auto-mints the new membership,
   *  drops the old). Works for ANY collection — an established one carries its
   *  items over — so no empty-gate. */
  async renameCollection(oldName: string, input: HTMLInputElement): Promise<void> {
    const newName = safeCellName(input.value)
    if (!newName || newName === oldName) { this.renaming.set(null); return }
    if (this.#aggregateNames.has(oldName)) { this.renaming.set(null); return }
    if (this.collections().includes(newName)) { input.select(); return }  // name taken
    const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!committer?.update) { this.renaming.set(null); return }

    // The old collection's items = the child sigs on its ROOT layer. These are
    // immutable + shared, so the new root can reference them verbatim.
    let items: string[] = []
    if (history?.sign) {
      const oldRoot = await this.#readCollectionLayer(oldName, history)
      const raw = Array.isArray(oldRoot?.['children']) ? (oldRoot!['children'] as unknown[]) : []
      items = raw.map(s => String(s ?? '')).filter(s => SIG.test(s))
    }

    // Membership for the COMMIT excludes aggregates (see #indexMembers).
    const members = this.#indexMembers().map(n => n === oldName ? newName : n)
    try {
      EffectBus.emit('cell:removed', { cell: oldName, segments: [SETS], viaUpdate: true })
      EffectBus.emit('cell:added', { cell: newName, segments: [SETS], viaUpdate: true })
      // Re-home the items into the new root's signature pool (sigs, not names).
      if (items.length) await committer.update([newName], { children: items }, new Set<string>())
      // Swap the sets/ membership: new name in, old name out.
      await committer.update([SETS], { children: members })
      await new hypercomb().act()
    } catch { this.renaming.set(null); return }
    this.#syncCursorToHead()
    this.collections.set(this.collections().map(n => n === oldName ? newName : n))
    this.#forget(oldName)
    this.#empty.set(newName, items.length === 0)   // carried its items (or emptiness) over
    this.empty.set(new Map(this.#empty))
    this.renaming.set(null)
  }

  /** Drop a removed/renamed name from every per-collection cache. */
  #forget(name: string): void {
    const url = this.#imageUrls.get(name)
    if (url) { URL.revokeObjectURL(url); this.#imageUrls.delete(name); this.images.set(new Map(this.#imageUrls)) }
    this.#imageRequested.delete(name)
    this.#rootSigByName.delete(name)   // a re-created name re-signs + re-warms
    this.#tags.delete(name)
    this.tags.set(new Map(this.#tags))
    if (this.#empty.delete(name)) this.empty.set(new Map(this.#empty))
  }

  // ── open / close — a tool window, not a page ────────────────────────────────

  /** Close the entrance. It is a docked panel now, so this closes the PANEL and
   *  nothing else — it must never navigate. The old full-screen landing had to
   *  step back out of `/sets` to get off the screen; the hive is right there
   *  behind this one, already showing the same collections as tiles. */
  close(): void {
    if (!this.open()) return
    this.open.set(false)
  }

  /** Open from anywhere (`collections:view-open`, the pools icon). Loads the
   *  index on demand — off `/sets` nothing else has read it. */
  openPanel(): void {
    if (!this.open()) {
      this.open.set(true)
      void this.#activate()
    }
  }

  toggle(): void { this.open() ? this.close() : this.openPanel() }

  // ── filtering ───────────────────────────────────────────────────────────────

  /** The name field. Panel-local — see the header note on why this one does not
   *  touch the canvas. */
  onQuery(value: string): void { this.query.set(value ?? '') }

  isTagActive(tag: string): boolean { return this.#activeTagFilters().has(tag) }

  /** Toggle a keyword on the SHARED filter — the same `tags:filter` the
   *  controls-bar pills and the Tags panel drive, at whatever reach is current.
   *  So the hive flattens to every tile carrying it and this list narrows to the
   *  collections that do, from one gesture. */
  toggleTag(tag: string): void {
    const next = new Set(this.#activeTagFilters())
    next.has(tag) ? next.delete(tag) : next.add(tag)
    this.#activeTagFilters.set(next)
    EffectBus.emit('tags:filter', { active: [...next], scope: this.#filterScope })
  }

  /** Drop everything — the keyword filter (shared, so the hive unflattens too)
   *  and the local name field. */
  clearFilter(): void {
    this.query.set('')
    if (this.#activeTagFilters().size === 0) return
    this.#activeTagFilters.set(new Set())
    EffectBus.emit('tags:filter', { active: [], scope: this.#filterScope })
  }

  // ── image resolution — the collection's own tile picture (root lineage) ─────

  /** Resolve a representative image for a collection and publish its object URL.
   *  A set is its own root, so we read the ROOT layer (`[name]`) — the same
   *  `small.image` the hex renderer draws — falling back to the first child tile
   *  that carries one, so a text-only collection root still shows a picture.
   *  Best-effort and deduped per name. Shell-safe: window.ioc only. */
  async #resolveImage(name: string): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const store = ioc()?.get('@hypercomb.social/Store') as StoreLike | undefined
    if (!history?.sign || !store?.getResource) { this.#imageRequested.delete(name); return }
    const imageSig = await this.#collectionImageSig([name], history, store)
      || await this.#collectionImageSig([SETS, name], history, store)
    if (!imageSig) return
    const blob = await store.getResource(imageSig).catch(() => null)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    this.#imageUrls.set(name, url)
    this.images.set(new Map(this.#imageUrls))   // new map instance → signal fires
  }

  // ── proximity declaration — the collection roots one click from this grid ────

  /** The shell's nav-driven warmer asks every visible surface for its one-click
   *  destinations. While the grid owns the screen, ours are the collection ROOTS
   *  (`sign(['<name>'])` — a set is its own root, the variable-root hop). Sigs are
   *  memoized per name so this stays cheap when polled on each navigation; the
   *  actual bounded subtree walk happens once, in the shell handler. Off-screen we
   *  return nothing, so we stop contributing the moment the landing closes. */
  #proximitySigs = async (): Promise<string[]> => {
    // Standing on the index counts even with the panel closed — the hive is
    // showing the same collections as tiles, so they're still one click away.
    if (!this.open() && !this.#atSets()) return []
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign) return []
    const out: string[] = []
    for (const name of this.collections()) {
      let sig = this.#rootSigByName.get(name)
      if (!sig) {
        sig = await history.sign({ explorerSegments: () => [name] }).catch(() => '')
        if (sig) this.#rootSigByName.set(name, sig)
      }
      if (sig) out.push(sig)
    }
    return out
  }

  async #collectionImageSig(segments: readonly string[], history: HistoryLike, store: StoreLike): Promise<string> {
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => '')
    if (!locSig) return ''
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return ''
    const own = await this.#imageSigFromLayer(layer, store)
    if (own) return own
    const children = Array.isArray(layer['children']) ? (layer['children'] as unknown[]) : []
    let scanned = 0
    for (const entry of children) {
      if (scanned >= 16) break
      const csig = String(entry ?? '')
      if (!SIG.test(csig)) continue
      scanned++
      const childLayer = history.getLayerBySig ? await history.getLayerBySig(csig).catch(() => null) : null
      if (!childLayer) continue
      const img = await this.#imageSigFromLayer(childLayer, store)
      if (img) return img
    }
    return ''
  }

  /** Pull a tile image sig out of a layer's properties blob — the same
   *  `small.image` (point-top hex thumbnail) the hex renderer reads, with the
   *  flat-orientation thumbnail and the full-size image as fallbacks. */
  async #imageSigFromLayer(layer: Record<string, unknown>, store: StoreLike): Promise<string> {
    const propsArr = layer['properties']
    const propSig = Array.isArray(propsArr) ? String(propsArr[0] ?? '') : ''
    if (!SIG.test(propSig)) return ''
    const blob = await store.getResource(propSig).catch(() => null)
    if (!blob) return ''
    try {
      const props = JSON.parse(await blob.text()) as {
        small?: { image?: unknown }
        flat?: { small?: { image?: unknown } }
        large?: { image?: unknown }
      }
      const sig = props?.small?.image ?? props?.flat?.small?.image ?? props?.large?.image
      return (typeof sig === 'string' && SIG.test(sig)) ? sig : ''
    } catch { return '' }
  }

  /** Preferred collection layer is the first-level root /<name>. A /sets/<name>
   *  fallback keeps data made during the nested-path experiment readable. */
  async #readCollectionLayer(name: string, history: HistoryLike): Promise<Record<string, unknown> | null> {
    const preferredSig = await history.sign({ explorerSegments: () => [name] }).catch(() => '')
    const preferred = preferredSig ? await history.currentLayerAt(preferredSig).catch(() => null) : null
    if (preferred) return preferred
    const legacySig = await history.sign({ explorerSegments: () => [SETS, name] }).catch(() => '')
    return legacySig ? await history.currentLayerAt(legacySig).catch(() => null) : null
  }

  /** Resolve whether a collection's layer has any items — drives the
   *  empty-only gate on rename/delete. Null layer (never visited) reads empty. */
  async #resolveEmptiness(name: string): Promise<void> {
    if (this.#aggregateNames.has(name)) {
      if (this.#empty.delete(name)) this.empty.set(new Map(this.#empty))
      return
    }
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign) return
    const layer = await this.#readCollectionLayer(name, history)
    const children = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    const isEmpty = children.filter(s => SIG.test(String(s ?? ''))).length === 0
    if (this.#empty.get(name) === isEmpty) return   // no change → no signal churn
    this.#empty.set(name, isEmpty)
    this.empty.set(new Map(this.#empty))
  }

  async #resolveTags(name: string): Promise<void> {
    const decorations = ioc()?.get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (!decorations?.list) return
    const registry = ioc()?.get('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    void registry?.ensureLoaded?.()
    const names = new Set<string>()
    for (const segments of [[name], [SETS, name]] as const) {
      const records = await decorations.list<{ name?: unknown }>({
        kind: TAG_DECORATION_KIND,
        segments,
      }).catch(() => [])
      for (const r of records) {
        const tag = r.record.payload?.name
        if (typeof tag === 'string' && tag.trim()) names.add(tag.trim())
      }
    }
    const next = [...names].sort((a, b) => a.localeCompare(b))
    const prev = this.#tags.get(name) ?? []
    if (sameList(prev, next)) return
    this.#tags.set(name, next)
    this.tags.set(new Map(this.#tags))
  }

  // ── membership index — the names under `sets/` ──────────────────────────────

  /** Read the collection names from the `sets/` layer's `children` (each child's
   *  `name`). Inlines the essentials `childNamesOf` walk — shared can't import
   *  it — reading through the parent's children (the authoritative membership
   *  path the renderer uses). */
  async #loadCollections(): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign) { this.collections.set([]); return }
    if (!this.#setsSig) this.#setsSig = await history.sign({ explorerSegments: () => [SETS] }).catch(() => '')
    const layer = await this.#readSetsLayer(history, this.#setsSig)
    const childSigs = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    const names: string[] = []
    for (const sig of childSigs) {
      const csig = String(sig ?? '')
      if (!SIG.test(csig)) continue
      const child = history.getLayerBySig ? await history.getLayerBySig(csig).catch(() => null) : null
      const nm = child?.['name']
      if (typeof nm === 'string' && nm.length > 0) names.push(nm)
    }
    this.#aggregateNames = new Set(
      groupRegistry.all()
        .filter(group => group.members().length > 0)
        .map(group => group.id)
        .filter(Boolean),
    )
    for (const name of this.#aggregateNames) {
      if (!names.includes(name)) names.push(name)
    }
    // Only publish when the membership actually changed — a reactive reload on
    // an unrelated synchronize must not churn the grid (flicker) or fight an
    // in-flight rename field.
    if (!sameList(names, this.collections())) this.collections.set(names)

    for (const name of names) {
      // Picture: resolve once (rarely changes), deduped across reloads.
      if (!this.#imageRequested.has(name)) {
        this.#imageRequested.add(name)
        void this.#resolveImage(name)
      }
      // Emptiness: re-resolve every reload — items get added/removed inside a
      // collection between visits, flipping whether it can be managed here.
      void this.#resolveEmptiness(name)
      void this.#resolveTags(name)
    }
  }

  /** The `sets/` layer to render FROM: the history cursor's CURRENT position
   *  (rewound-aware) when the cursor is bound to this index — so an undo/redo
   *  shows the index as-of that step — else the live head. */
  async #readSetsLayer(history: HistoryLike, setsSig: string): Promise<Record<string, unknown> | null> {
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as CursorLike | undefined
    if (cursor?.currentLayerSig && cursor.state?.locationSig === setsSig && history.getLayerBySig) {
      const l = await history.getLayerBySig(cursor.currentLayerSig).catch(() => null)
      if (l) return l
    }
    return setsSig ? await history.currentLayerAt(setsSig).catch(() => null) : null
  }

  // ── history-cursor binding — undo/redo target THIS index while it's open ─────

  /** Load the grid, binding the sets/ cursor ONLY while standing on the index.
   *
   *  The bind exists because the old full-screen landing REPLACED the hive, so
   *  show-cell never loaded this location's cursor and Ctrl+Z walked whatever
   *  page was last rendered. Now the hive renders `/sets` itself and loads the
   *  same cursor — binding there is idempotent (same sig) and harmless, and it
   *  keeps working if show-cell ever doesn't.
   *
   *  Off `/sets` it would be a REAL bug: the panel is a tool window you can open
   *  anywhere, and binding the cursor to the collection index from, say,
   *  `/music` would silently point that page's undo at the wrong bag. */
  async #activate(): Promise<void> {
    if (this.#atSets()) await this.#bindSetsCursor()
    await this.#loadCollections()
  }

  async #bindSetsCursor(): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as CursorLike | undefined
    if (!history?.sign) return
    if (!this.#setsSig) this.#setsSig = await history.sign({ explorerSegments: () => [SETS] }).catch(() => '')
    if (this.#setsSig && cursor?.load) { try { await cursor.load(this.#setsSig) } catch { /* head fallback */ } }
  }

  /** After a commit here, re-bind the cursor to the fresh head so it picks up the
   *  new marker and any rewound state clears (append-only: an edit lands at head). */
  #syncCursorToHead(): void {
    // Same rule as #activate: never point another page's cursor at the sets bag.
    if (!this.#atSets()) return
    const cursor = ioc()?.get('@diamondcoreprocessor.com/HistoryCursorService') as CursorLike | undefined
    if (cursor?.load && this.#setsSig) { try { void cursor.load(this.#setsSig) } catch { /* ignore */ } }
  }

  // ── activation / lifecycle ──────────────────────────────────────────────────

  // Lineage may not be registered at construction; resolve + bind lazily.
  #ensureLineage(): void {
    if (this.#lineageBound) return
    const l = ioc()?.get('@hypercomb.social/Lineage') as LineageLike | undefined
    if (l?.addEventListener) {
      this.#lineage = l
      l.addEventListener('change', this.#onChange)
      this.#lineageBound = true
    }
  }

  /** Coalesce reactive reloads (a synchronize/undo burst fires many times). */
  #scheduleReload(): void {
    if (!this.open() || this.#reloadScheduled) return
    this.#reloadScheduled = true
    queueMicrotask(() => {
      this.#reloadScheduled = false
      if (this.open()) void this.#loadCollections()
    })
  }

  /** Escape unwinds the innermost thing: a rename field, then the create field,
   *  then the panel.
   *
   *  This listener is on `window` in the CAPTURE phase, which was fine when the
   *  landing owned the whole screen — nothing else could want the key. Docked
   *  beside a live hive it must not swallow the shell's escape cascade, so it
   *  only claims Escape for state that is actually ours: an open field always,
   *  and the panel itself only when the focus is inside it. Escape pressed out
   *  on the canvas falls through to the hive, which is what you'd expect while
   *  the panel is just sitting there. */
  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open()) return
    if (this.renaming()) { e.preventDefault(); this.renaming.set(null); return }
    if (this.creating()) { e.preventDefault(); this.creating.set(false); return }
    const target = e.target as Node | null
    const panel = document.querySelector('hc-collections-landing .collections-panel')
    if (!panel || !target || !panel.contains(target)) return
    e.preventDefault()
    this.close()
  }

  #refresh(): void {
    this.#ensureLineage()
    const segs = (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const atSets = segs.length === 1 && segs[0] === SETS
    const arrived = atSets && !this.#atSets()
    this.#atSets.set(atSets)

    // NOTE: the hive is never hidden here any more. `/sets` renders as an
    // ordinary hive page and this panel sits beside it (see the header note) —
    // `render:set-hive-visible` belongs to takeover surfaces like the website
    // landing and the screensaver, not to this one.

    // Arriving at the index opens the entrance; leaving it does NOT close it (a
    // tool window you opened stays open while you walk around). Closing it
    // while standing on /sets sticks — only a fresh ARRIVAL re-opens it.
    if (arrived) this.open.set(true)

    if (this.open()) void this.#activate()
    else {
      // Keep the directory warm. Re-opening should show the cached list
      // immediately, then #activate refreshes it against history in background.
      this.creating.set(false)
      this.renaming.set(null)
    }
  }
}

registerShellSurface({
  name: 'hc-collections-landing',
  owner: '@hypercomb.shared/CollectionsLandingComponent',
  component: CollectionsLandingComponent,
  order: 61,
})
