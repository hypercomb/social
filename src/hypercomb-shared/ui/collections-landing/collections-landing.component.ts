// hypercomb-shared/ui/collections-landing/collections-landing.component.ts
//
// The "Collections" landing — the welcome page of the `sets/` layer, the sibling
// of the Websites landing (hc-website-landing) but for reference sets. Instead
// of dropping the participant onto a bare hive page, `sets/` opens a clean,
// centred directory: a title above, every existing collection as its own hex
// tile below, and a create row so a new referenceable collection is one line
// away. Clicking a collection portals to it.
//
// A collection (a reference set) is its OWN ROOT lineage — the `sets/` page is
// just the index of them (the VARIABLE-ROOT hop, see entrances-and-sets.md and
// tile-overlay.drone's sets branch). So a card click navigates to `/[name]`,
// never `/sets/[name]`, and a collection's picture is resolved from its root.
//
// MANAGE (rename / delete): both go through the SAME per-page layer state
// machine as every other edit — a bare `cell:removed` / `cell:added` (no
// `viaUpdate`) routes through LayerCommitter's name-delta path and lands ONE
// history marker in the `/sets` bag, so each is a real, undoable commit. Rename
// = remove-old + add-new: the new name auto-mints a fresh sigbag (the sanctioned
// delete+create model — there is no in-place rename; a name is identity). Both
// are gated on the collection being EMPTY so nothing is silently lost.
//
// Shows ONLY while the participant is AT the sets index (segments === ['sets']),
// mirroring the Websites landing's location gate — never over the hive on boot.
// Self-registers as a shell surface (no app.html edit, no web/dev drift) and
// resolves everything through the global ioc at call time. Never imports
// essentials — every mutation goes through the sanctioned IoC services the
// command line uses.

import { Component, OnDestroy, signal } from '@angular/core'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'

/** The reserved lineage that indexes every reference set. */
const SETS = 'sets'

type LineageLike = EventTarget & { explorerSegments?: () => readonly string[] }
type NavigationLike = { goRaw?: (segments: readonly string[]) => void; back?: () => void }
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
  getLayerBySig?(sig: string): Promise<Record<string, unknown> | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
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
  imports: [TranslatePipe],
  templateUrl: './collections-landing.component.html',
  styleUrls: ['./collections-landing.component.scss'],
})
export class CollectionsLandingComponent implements OnDestroy {
  /** Names of the reference sets under `sets/` (the collection index). */
  readonly collections = signal<readonly string[]>([])
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

  #lineage: LineageLike | null = null
  #lineageBound = false
  /** Only hide the Pixi hive while the landing actually owns the screen, and
   *  reliably restore it when it doesn't. */
  #hidHive = false
  #imageUrls = new Map<string, string>()
  #imageRequested = new Set<string>()
  #empty = new Map<string, boolean>()
  /** Cached sign(['sets']) — the history location of the collection index. */
  #setsSig = ''
  #reloadScheduled = false
  #onChange = (): void => this.#refresh()
  /** Commits (create/delete/rename here, or anywhere) pulse the processor;
   *  reload the index so the grid reflects the committed state. */
  #onSynchronize = (): void => this.#scheduleReload()
  #cursorUnsub: (() => void) | null = null

  constructor() {
    window.addEventListener('keydown', this.#onKey, true)
    window.addEventListener('synchronize', this.#onSynchronize)
    // Undo/redo moves the history cursor; reflect it when it reaches this index.
    this.#cursorUnsub = EffectBus.on('history:cursor-changed', () => this.#scheduleReload())
    this.#ensureLineage()
    this.#refresh()
  }

  ngOnDestroy(): void {
    this.#lineage?.removeEventListener?.('change', this.#onChange)
    window.removeEventListener('keydown', this.#onKey, true)
    window.removeEventListener('synchronize', this.#onSynchronize)
    this.#cursorUnsub?.()
    if (this.#hidHive) EffectBus.emit('render:set-hive-visible', { visible: true })
    for (const url of this.#imageUrls.values()) URL.revokeObjectURL(url)
  }

  /** Deterministic per-collection accent (hue from the name) — each card gets
   *  its own identity tint, the same idea as the hive's label-derived colours. */
  accent(label: string): string {
    let h = 5381
    for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0
    return `hsl(${(h >>> 0) % 360} 62% 64%)`
  }

  /** Rename and delete are offered only for an EMPTY collection (its root has no
   *  items) — so a manage gesture can never silently drop content. Unknown
   *  emptiness (still resolving) reads as not-manageable until confirmed. */
  manageable(name: string): boolean {
    return this.empty().get(name) === true
  }

  /** Open a collection — the VARIABLE-ROOT hop: a set is its own root, so we
   *  travel to `/[name]`, not `/sets/[name]` (matches tile-overlay's sets
   *  branch and the collections home widget). */
  openCollection(name: string): void {
    if (this.renaming() === name) return   // this card's rename field is open
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
   *  then pulse the processor. The new tile is shown optimistically — the hive
   *  is hidden here, so there is no incremental placement to reflect it, and a
   *  fresh index read can lag a just-made commit. The authoritative read runs on
   *  the next open. */
  async create(input: HTMLInputElement): Promise<void> {
    const name = safeCellName(input.value)
    if (!name) { input.focus(); return }
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
    const next = this.collections().filter(n => n !== name)
    try {
      EffectBus.emit('cell:removed', { cell: name, segments: [SETS], viaUpdate: true })
      await committer.update([SETS], { children: next })
      await new hypercomb().act()
    } catch { return }
    this.#syncCursorToHead()
    this.collections.set(next)
    this.#forget(name)
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
    if (this.collections().includes(newName)) { input.select(); return }  // name taken
    const committer = ioc()?.get('@diamondcoreprocessor.com/LayerCommitter') as CommitterLike | undefined
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!committer?.update) { this.renaming.set(null); return }

    // The old collection's items = the child sigs on its ROOT layer. These are
    // immutable + shared, so the new root can reference them verbatim.
    let items: string[] = []
    if (history?.sign) {
      const oldSig = await history.sign({ explorerSegments: () => [oldName] }).catch(() => '')
      const oldRoot = oldSig ? await history.currentLayerAt(oldSig).catch(() => null) : null
      const raw = Array.isArray(oldRoot?.['children']) ? (oldRoot!['children'] as unknown[]) : []
      items = raw.map(s => String(s ?? '')).filter(s => SIG.test(s))
    }

    const next = this.collections().map(n => n === oldName ? newName : n)
    try {
      EffectBus.emit('cell:removed', { cell: oldName, segments: [SETS], viaUpdate: true })
      EffectBus.emit('cell:added', { cell: newName, segments: [SETS], viaUpdate: true })
      // Re-home the items into the new root's signature pool (sigs, not names).
      if (items.length) await committer.update([newName], { children: items }, new Set<string>())
      // Swap the sets/ membership: new name in, old name out.
      await committer.update([SETS], { children: next })
      await new hypercomb().act()
    } catch { this.renaming.set(null); return }
    this.#syncCursorToHead()
    this.collections.set(next)
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
    if (this.#empty.delete(name)) this.empty.set(new Map(this.#empty))
  }

  /** Close the directory — step back out of the sets index (plain navigation),
   *  which drops segments below ['sets'] and hides this surface. */
  close(): void {
    const nav = ioc()?.get('@hypercomb.social/Navigation') as NavigationLike | undefined
    if (nav?.back) nav.back()
    else nav?.goRaw?.([])
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
    if (!imageSig) return
    const blob = await store.getResource(imageSig).catch(() => null)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    this.#imageUrls.set(name, url)
    this.images.set(new Map(this.#imageUrls))   // new map instance → signal fires
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

  /** Resolve whether a collection's ROOT lineage has any items — drives the
   *  empty-only gate on rename/delete. Null layer (never visited) reads empty. */
  async #resolveEmptiness(name: string): Promise<void> {
    const history = ioc()?.get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
    if (!history?.sign) return
    const locSig = await history.sign({ explorerSegments: () => [name] }).catch(() => '')
    const layer = locSig ? await history.currentLayerAt(locSig).catch(() => null) : null
    const children = Array.isArray(layer?.['children']) ? (layer!['children'] as unknown[]) : []
    const isEmpty = children.filter(s => SIG.test(String(s ?? ''))).length === 0
    if (this.#empty.get(name) === isEmpty) return   // no change → no signal churn
    this.#empty.set(name, isEmpty)
    this.empty.set(new Map(this.#empty))
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

  /** Bind the sets/ cursor + load the grid. Binding makes Ctrl+Z / Ctrl+Y
   *  (history.undo/redo → cursor.undo/redo on the loaded cursor) walk the
   *  collection index instead of whatever page show-cell last rendered. */
  async #activate(): Promise<void> {
    await this.#bindSetsCursor()
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

  #onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.open()) return
    // Escape unwinds the innermost thing: a rename field, then the create field,
    // then the whole surface.
    e.preventDefault()
    if (this.renaming()) this.renaming.set(null)
    else if (this.creating()) this.creating.set(false)
    else this.close()
  }

  #refresh(): void {
    this.#ensureLineage()
    const segs = (this.#lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const active = segs.length === 1 && segs[0] === SETS

    // Replace the floating hive (don't just cover it): hide the Pixi mesh while
    // the landing owns the screen, restore it when it doesn't. Emit only on the
    // transition so we never fight the screensaver frame-to-frame.
    if (active !== this.#hidHive) {
      this.#hidHive = active
      EffectBus.emit('render:set-hive-visible', { visible: !active })
    }

    this.open.set(active)
    if (active) void this.#activate()
    else { this.collections.set([]); this.creating.set(false); this.renaming.set(null) }
  }
}

registerShellSurface({
  name: 'hc-collections-landing',
  owner: '@hypercomb.shared/CollectionsLandingComponent',
  component: CollectionsLandingComponent,
  order: 61,
})
