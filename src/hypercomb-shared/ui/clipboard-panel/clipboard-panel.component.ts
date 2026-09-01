// hypercomb-shared/ui/clipboard-panel/clipboard-panel.component.ts
//
// Right-docked "Clipboard" side panel. The NON-NAVIGATING replacement for
// the old clipboard MODE (which set show-cell's `#clipboardView` and
// replaced the page's tiles with the clipboard labels — pulling you away
// from the target). This panel lists the captured tiles (with thumbnails of
// their actual images) while the current page stays fully rendered and
// interactive behind it; you place items onto THIS page without ever leaving.
//
// Shell UI, so it must NOT import essentials. It is driven entirely by
// EffectBus and reaches essentials services only at runtime via window.ioc:
//   • reads   `clipboard:changed` ({ items, count }) — last-value
//             replayed on subscribe, so the panel reflects current state
//             the instant it mounts.
//   • opens   on `clipboard:captured` (a fresh copy/cut) and on
//             `clipboard:panel` ({ visible }) (the controls-bar button).
//   • closes  on `clipboard:close` (escape-cascade) and Escape.
//   • places  via `controls:action` ({ action:'paste' }) for "place all"
//             and `clipboard:place-items` ({ labels }) for a single tile.
//
// Thumbnails resolve the SAME image the renderer paints (props index ->
// canonical properties -> Store.getResource), read-only — never writing, so
// the "image stable once present" rule is untouched. Object-URLs are revoked
// when items leave the clipboard and on destroy (no leaks). No image -> the
// ⬢ glyph stays.
//
// Placing emits the eager `cell:added` path in the clipboard worker, so the
// dropped tile renders on the page IMMEDIATELY — no refresh, no navigation.
//
// ── THE SWAP ──────────────────────────────────────────────────────────
// One gesture, both directions. A row clicked HERE leaves the window and
// lands on the page behind it; a tile clicked THERE leaves the page and
// lands here (TileOverlayDrone reads the same `clipboard:open` this panel
// emits, and answers a plain click with `clipboard:take-items`). Ctrl is
// the walk on both sides: ctrl+click a row to step into its children, or a
// tile on the hive to go where you want to place. That is the whole
// interface — there is no per-row place button, no discard button that
// isn't the hover ×, and no target-slot field. A placed tile lands in the
// next free slot, the way any paste does.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
// Settings-only: the gear + group chrome every tool window carries. The panel
// keeps its own grip and width signal — `ownsSize` false, `sizeOwner` this.
import { HcDockedPanelDirective, type PanelSizeOwner } from '../docked-panel/hc-docked-panel.directive'
import { type WindowSession } from '../window-session'
import { onSelection } from '../../core/selection-context'
import { resolveEntryImageUrl } from '../clipboard-thumbs'

interface ClipboardItem {
  label: string
  sourceSegments: readonly string[]
}

/** What the template renders — resolved ONCE per change instead of by
 *  per-row lookups on every check. `key` is the item's identity (label +
 *  source path): the clipboard can legitimately hold two same-named tiles
 *  from different parents, and it is what the thumbnail and count caches
 *  are keyed by. */
interface ClipboardRow {
  item: ClipboardItem
  key: string
  label: string
  thumb: string | undefined
  count: number
}

/** Identity of a clipboard row — never the bare label. */
function rowKey(item: ClipboardItem): string {
  return item.label + '\u0000' + item.sourceSegments.join('/')
}

interface ClipboardChangedPayload {
  items?: ClipboardItem[]
  count?: number
}

// Participant-local set of absolute source paths a nested-discard has dropped.
// Shared verbatim with the clipboard worker, which prunes these branches on
// paste. localStorage, never the layer — clipboard state is participant-local.
const EXCLUSIONS_KEY = 'hc:clipboard-exclusions'
const CLIPBOARD_WORKER_KEY = '@diamondcoreprocessor.com/ClipboardWorker'
// Resolve child counts in small batches so a many-item clipboard can't fire a
// burst of (possibly cold) layer reads at once — keeps it off the render path.
const COUNT_BATCH = 4

// Drag-to-resize width, persisted participant-locally so the panel reopens at
// the size the user last left it (clipboard state never touches the layer —
// see the "clipboard is participant-local" rule). Width only: the panel is
// edge-docked, so its left grip is the single spatial control.
const WIDTH_KEY = 'hc:clipboard-panel-width'
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 260
const MAX_WIDTH = 760


@Component({
  selector: 'hc-clipboard-panel',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './clipboard-panel.component.html',
  styleUrls: ['./clipboard-panel.component.scss'],
})
export class ClipboardPanelComponent implements OnDestroy, PanelSizeOwner {

  readonly visible = signal(false)

  /** Put away while the hive is covered. Deliberately NOT `#setVisible` — that
   *  resets the drill level on the way back in, and the level you had drilled
   *  to is precisely what "remembered" means here. The `clipboard:open`
   *  announcement still goes out both ways so the Escape cascade and the
   *  control-bar light agree with the screen. Session-only as ever: parking
   *  survives the installer, not a refresh. */
  readonly session: WindowSession = {
    park: () => { this.visible.set(false); EffectBus.emit('clipboard:open', { open: false }) },
    unpark: () => { this.visible.set(true); EffectBus.emit('clipboard:open', { open: true }) },
    // Escape's owner is the cascade; this is how the panel takes part. It also
    // keeps its OWN cascade rung (clipboard mode is reachable with the focus out
    // on the canvas, which is the whole point of a clipboard).
    close: () => { this.close() },
  }

  readonly items = signal<ClipboardItem[]>([])
  /** Live canvas selection size — this window's selection response
   *  (documentation/selection-tool-windows.md): while tiles are selected, the
   *  panel offers capturing THEM, right where the captured result lands. */
  readonly selectionCount = signal(0)
  /** rowKey -> thumbnail object-URL. Absent => the ⬢ glyph. */
  readonly thumbs = signal<Record<string, string>>({})
  /** rowKey -> number of children at that source location. Best-effort,
   *  resolved off the render path; absent/0 => no badge. The badge is also
   *  the walk-in handle, so it says "there is somewhere to go here". */
  readonly counts = signal<Record<string, number>>({})

  // ── drill-down ─────────────────────────────────────────────────────
  // The clipboard is just another hierarchy: clicking a tile's hex descends
  // into its children (resolved from the live SOURCE tree it points at), with a
  // back button. Each stack entry is a level we've entered; empty = top-level
  // clipboard items.
  readonly #drillStack = signal<{ label: string; segments: readonly string[] }[]>([])
  readonly #drillChildren = signal<ClipboardItem[]>([])
  /** Absolute source paths the user has discarded while drilled — kept out of
   *  the drill view AND skipped on paste (the worker reads the same key). */
  readonly #exclusions = signal<Set<string>>(this.#restoreExclusions())
  /** True while drilled below the top-level clipboard list. */
  readonly drilled = computed(() => this.#drillStack().length > 0)
  /** Breadcrumb of the current drill path (tile names, top → current). */
  readonly drillCrumb = computed(() => this.#drillStack().map(d => d.label).join(' / '))
  /** What the list renders: the drilled level, or the clipboard at the top. */
  readonly displayItems = computed(() => this.drilled() ? this.#drillChildren() : this.items())
  /** The template's whole model — one pass over the display set folding in
   *  the resolved thumbnail and count. Rows are what `@for` tracks, so no
   *  per-row map lookup runs on a change-detection pass. */
  readonly rows = computed<ClipboardRow[]>(() => {
    const thumbs = this.thumbs()
    const counts = this.counts()
    return this.displayItems().map(item => {
      const key = rowKey(item)
      return { item, key, label: item.label, thumb: thumbs[key], count: counts[key] ?? 0 }
    })
  })
  /** Drag-resized panel width (px), restored from localStorage on construct. */
  readonly width = signal<number>(this.#restoreWidth())
  /** True while a left-grip drag is in progress (drives cursor/handle style). */
  readonly resizing = signal(false)
  /** Ctrl/Meta down. On THIS side of the swap ctrl is the WALK (it is the
   *  copy on the hive — see the asymmetry note in the class header), and the
   *  row has to say which of the two it is offering before the click lands.
   *  Window-wide, not per-row: the modifier is a property of the window, so
   *  one class on the root flips every row at once and the answer changes
   *  under a still pointer the instant the key goes down. */
  readonly ctrlHeld = signal(false)
  // `--hc-panel-scale` is NOT computed here any more: hcDockedPanel owns it for
  // every tool window, because it is now a SETTING (auto, or a picked text
  // size) and not merely a function of the width. The panel hands the directive
  // its width via `sizeOwner` and takes `[defaultWidth]`/`[maxScale]` in the
  // template, which is the same curve this panel used to compute for itself.

  #cleanups: (() => void)[] = []
  // Live object-URLs by row identity, so they can be revoked on change/destroy.
  #urls = new Map<string, string>()
  // Monotonic token so a stale async thumbnail resolve can't overwrite a
  // newer clipboard state (rapid copy/clear races).
  #thumbToken = 0
  // Same guard for the (separate) child-count resolution.
  #countToken = 0
  /** rowKey -> child count, kept across displays. A child count is a fact
   *  about a source location, and taking a tile republishes the whole list —
   *  without this, every click would re-read every held tile's children, so
   *  the cost of filling the window grew with what was already in it. Numbers
   *  only; drilling in and back out costs nothing the second time. */
  #countCache = new Map<string, number>()
  // Guards the auto-open: EffectBus replays the LAST `clipboard:captured`
  // to a late subscriber, which would pop the panel open on every mount.
  // We only auto-open for captures that arrive AFTER the initial sync.
  #ready = false

  // Left-grip resize drag. Width grows as the pointer moves LEFT (the panel
  // is docked to the right edge), so we track the start anchor and width.
  #resizeStartX = 0
  #resizeStartWidth = 0

  constructor() {
    // Current clipboard contents — replayed immediately on subscribe.
    this.#cleanups.push(EffectBus.on<ClipboardChangedPayload>('clipboard:changed', (p) => {
      const items = Array.isArray(p?.items) ? p!.items! : []
      const next = items.map(i => ({ label: i.label, sourceSegments: [...(i.sourceSegments ?? [])] }))
      this.items.set(next)
      // An emptied clipboard USED to close the panel ("nothing left to show").
      // It stays open now: with the swap grammar an empty window is still
      // live — click a tile on the hive and it lands here. Closing is the
      // ×, Escape, or the controls-bar button, and nothing else.
      // Clipboard membership changed (capture / place / clear) — the worker
      // resets exclusions on a fresh capture, so re-read them, and drop back to
      // the top level.
      this.#exclusions.set(this.#restoreExclusions())
      this.#drillStack.set([])
      this.#drillChildren.set([])
      this.#syncDisplay(next)
    }))

    // A fresh copy/cut opens the panel. Ignored during the initial
    // last-value replay (see `#ready`).
    this.#cleanups.push(EffectBus.on('clipboard:captured', () => {
      if (!this.#ready) return
      if (this.items().length > 0) this.#setVisible(true)
    }))

    // The controls-bar clipboard button toggles the panel. Opening only
    // takes effect when there is something to place.
    this.#cleanups.push(EffectBus.on<{ visible?: boolean }>('clipboard:panel', (p) => {
      // An explicit toggle does what it says — including opening on an EMPTY
      // clipboard, which used to be refused ("nothing to show"). With the swap
      // grammar an empty window is where the next tile you click on the hive
      // lands, so it is worth opening on its own.
      this.#setVisible(p?.visible ?? !this.visible())
    }))

    // escape-cascade owns Escape ORDERING (editor > viewers > selection >
    // clipboard) and right-click; it emits `clipboard:close` when the panel
    // is the active overlay. The panel announces its open state via
    // `clipboard:open` (emitted by #setVisible) so the cascade knows.
    this.#cleanups.push(EffectBus.on('clipboard:close', () => this.close()))

    // Selection notification — replayed, so a panel opened mid-selection is
    // current immediately.
    this.#cleanups.push(onSelection(({ selected }) => this.selectionCount.set(selected.length)))

    // Ctrl tracking for the row verb. Capture-phase and on `window`, so it is
    // current no matter where focus sits; `blur` clears it because a key
    // released while the tab is away never sends its keyup here and the rows
    // would be left offering the wrong verb.
    window.addEventListener('keydown', this.#onModifier, true)
    window.addEventListener('keyup', this.#onModifier, true)
    window.addEventListener('blur', this.#clearModifier)
    this.#cleanups.push(() => {
      window.removeEventListener('keydown', this.#onModifier, true)
      window.removeEventListener('keyup', this.#onModifier, true)
      window.removeEventListener('blur', this.#clearModifier)
    })

    // Subscriptions wired; allow auto-open from here on.
    this.#ready = true
  }

  #onModifier = (e: KeyboardEvent): void => {
    if (!this.visible()) { this.#clearModifier(); return }
    const held = e.ctrlKey || e.metaKey
    if (this.ctrlHeld() !== held) this.ctrlHeld.set(held)
  }

  #clearModifier = (): void => {
    if (this.ctrlHeld()) this.ctrlHeld.set(false)
  }

  /** Capture the current selection from inside the window — same verbs the
   *  controls bar emits; clipboard.worker answers either way. */
  readonly cutSelection = (): void => {
    EffectBus.emit('controls:action', { action: 'cut' })
  }

  readonly copySelection = (): void => {
    EffectBus.emit('controls:action', { action: 'copy' })
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#stopResizeListeners()
    if (this.visible()) EffectBus.emit('clipboard:open', { open: false })
    // Bump the token so any in-flight #syncThumbs resolve sees a mismatch and
    // revokes its freshly-created object-URL instead of storing it into a
    // map we're about to drop — otherwise a thumbnail that resolves AFTER
    // teardown would leak.
    this.#thumbToken++
    this.#revokeAll()
  }

  /** Single visibility chokepoint — keeps escape-cascade in sync by
   *  announcing every open/close via `clipboard:open`. */
  #setVisible(v: boolean): void {
    if (this.visible() === v) return
    // Every fresh OPEN starts at the top-level clipboard list — never a stale
    // drill level left over from a previous open (which would show the wrong
    // children, or none, and read as "my items vanished").
    // The count cache is scoped to ONE open session: within a session the only
    // things that move are whole subtrees (takes and places), so a cached
    // count stays true; across sessions the hive may have been edited, so it
    // starts empty rather than badging a stale number forever.
    if (v) { this.#drillStack.set([]); this.#drillChildren.set([]); this.#countCache.clear() }
    this.visible.set(v)
    EffectBus.emit('clipboard:open', { open: v })
  }

  close(): void {
    this.#drillStack.set([])
    this.#drillChildren.set([])
    this.#setVisible(false)
  }

  // ── drill navigation ───────────────────────────────────────────────
  // Descend into a tile's children (the hex click). Resolves the SOURCE tree's
  // children at that location; no-op if there are none. Thumbnails + counts run
  // on the new level for free (same per-item resolution as the top list).
  async drillInto(item: ClipboardItem): Promise<void> {
    const segments = [...item.sourceSegments, item.label]
    const names = await this.#resolveChildren(segments)
    if (names.length === 0) return
    this.#drillStack.update(s => [...s, { label: item.label, segments }])
    this.#showChildren(names, segments)
  }

  /** Pop one drill level (the header back button). */
  drillBack(): void {
    const stack = this.#drillStack()
    if (stack.length === 0) return
    const next = stack.slice(0, -1)
    this.#drillStack.set(next)
    if (next.length === 0) {
      this.#drillChildren.set([])
      this.#syncDisplay(this.items())
    } else {
      const top = next[next.length - 1]
      void this.#resolveChildren(top.segments).then(names => this.#showChildren(names, top.segments))
    }
  }

  #showChildren(names: readonly string[], segments: readonly string[]): void {
    const children = names.map(name => ({ label: name, sourceSegments: segments }))
    this.#drillChildren.set(children)
    this.#syncDisplay(children)
  }

  async #resolveChildren(segments: readonly string[]): Promise<string[]> {
    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const worker = ioc?.get?.(CLIPBOARD_WORKER_KEY) as
      { childrenAt?: (s: readonly string[]) => Promise<string[]> } | undefined
    if (!worker?.childrenAt) return []
    let names: string[]
    try { names = await worker.childrenAt(segments) } catch { return [] }
    // Hide anything the user has discarded at this (or a deeper) level — the
    // exclusion is keyed by absolute source path, so re-drilling never resurrects it.
    const excl = this.#exclusions()
    return excl.size === 0 ? names : names.filter(name => !excl.has([...segments, name].join('/')))
  }

  /** Resolve thumbnails + counts for the on-screen set. */
  #syncDisplay(items: readonly ClipboardItem[]): void {
    void this.#syncThumbs(items).catch(() => { /* best-effort thumbnails */ })
    void this.#syncCounts(items).catch(() => { /* best-effort child counts */ })
  }

  // ── the swap ───────────────────────────────────────────────────────
  // A row click puts the tile on the page behind this window; ctrl+click
  // walks into it instead, so its children can be placed one at a time. The
  // hive answers the same pair with the window open — see the header note.
  rowClick(item: ClipboardItem, event: MouseEvent): void {
    if (event.ctrlKey || event.metaKey) { void this.drillInto(item); return }
    this.placeOne(item)
  }

  // ── resize (left grip) ─────────────────────────────────────────────
  // The panel is docked to the right edge; dragging the left grip changes
  // its width. We listen on `window` (not the grip) so the drag survives the
  // pointer crossing onto the hive canvas, and persist on release so the size
  // sticks for the next open.

  startResize(event: PointerEvent): void {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    this.#resizeStartX = event.clientX
    this.#resizeStartWidth = this.width()
    this.resizing.set(true)
    window.addEventListener('pointermove', this.#onResizeMove)
    window.addEventListener('pointerup', this.#onResizeEnd)
    window.addEventListener('pointercancel', this.#onResizeEnd)
  }

  #onResizeMove = (event: PointerEvent): void => {
    // Pointer moving left (clientX shrinks) widens the panel.
    const next = this.#resizeStartWidth + (this.#resizeStartX - event.clientX)
    this.width.set(this.#clampWidth(next))
  }

  #onResizeEnd = (): void => {
    if (!this.resizing()) return
    this.resizing.set(false)
    this.#stopResizeListeners()
    this.#persistWidth()
  }

  #stopResizeListeners(): void {
    window.removeEventListener('pointermove', this.#onResizeMove)
    window.removeEventListener('pointerup', this.#onResizeEnd)
    window.removeEventListener('pointercancel', this.#onResizeEnd)
  }

  #clampWidth(w: number): number {
    // Floor at MIN_WIDTH; cap at MAX_WIDTH but never wider than the viewport
    // (minus a small gutter) so a narrow screen can't strand the close button.
    const max = Math.min(MAX_WIDTH, window.innerWidth - 24)
    return Math.round(Math.max(MIN_WIDTH, Math.min(w, Math.max(MIN_WIDTH, max))))
  }

  #restoreWidth(): number {
    try {
      const raw = localStorage.getItem(WIDTH_KEY)
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n)) return this.#clampWidth(n)
    } catch { /* ignore */ }
    return DEFAULT_WIDTH
  }

  #persistWidth(): void {
    try { localStorage.setItem(WIDTH_KEY, String(this.width())) } catch { /* ignore */ }
  }

  // ── PanelSizeOwner ─────────────────────────────────────────────────
  // What the window-group chrome reads and writes. Same clamp, same store as a
  // drag of the grip — a width arriving from a group mate is not a different
  // kind of width.
  panelWidth(): number { return this.width() }
  setPanelWidth(width: number): void {
    this.width.set(this.#clampWidth(width))
    this.#persistWidth()
  }

  /** Drop everything from the clipboard. */
  clearAll(): void {
    EffectBus.emit('controls:action', { action: 'clear-clipboard' })
    this.close()
  }

  /** The location this panel is acting over — the page on screen behind it —
   *  read synchronously at click time so the paste is BOUND to where the user
   *  is, not re-derived by the worker after any navigation. The worker writes
   *  exactly here and refuses if it can't resolve it (never guesses). */
  #targetSegments(): string[] {
    const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
      ?.get?.('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
    return [...(lineage?.explorerSegments?.() ?? [])]
  }

  /** Place every clipboard tile onto the CURRENT page, honouring any hover
   *  target indexes. Copy keeps the items (repeatable); cut consumes them (and
   *  the panel auto-closes when the clipboard empties via `clipboard:changed`). */
  placeAll(): void {
    EffectBus.emit('clipboard:place-items', {
      labels: this.items().map(i => i.label),
      targetSegments: this.#targetSegments(),
    })
  }

  /** Place a single tile onto the current page (with its target). A top-level
   *  item places + consumes via its label; a DRILLED child isn't a clipboard
   *  entry, so it places by its full source path and consumes nothing. */
  placeOne(item: ClipboardItem): void {
    const targetSegments = this.#targetSegments()
    if (this.drilled()) {
      EffectBus.emit('clipboard:place-entries', {
        entries: [{ label: item.label, sourceSegments: [...item.sourceSegments] }],
        targetSegments,
      })
    } else {
      EffectBus.emit('clipboard:place-items', { labels: [item.label], targetSegments })
    }
  }

  /** Drop a single tile from the clipboard WITHOUT placing it. At the top level
   *  this removes the clipboard entry (worker re-persists, stays gone after a
   *  reload). While DRILLED, the row is a child of a clipboard tile, not an
   *  entry — so record its absolute source path as an exclusion: it leaves the
   *  view now, never returns on re-drill, and is pruned when its parent pastes. */
  discardOne(item: ClipboardItem): void {
    if (this.drilled()) { this.#excludeNested(item); return }
    EffectBus.emit('clipboard:discard-items', { labels: [item.label] })
  }

  /** Add a drilled child's source path to the exclusion set, persist it (shared
   *  with the worker), and remove it from the current drill view immediately. */
  #excludeNested(item: ClipboardItem): void {
    const path = [...item.sourceSegments, item.label].join('/')
    const next = new Set(this.#exclusions())
    next.add(path)
    this.#exclusions.set(next)
    this.#persistExclusions(next)
    const remaining = this.#drillChildren()
      .filter(c => [...c.sourceSegments, c.label].join('/') !== path)
    this.#drillChildren.set(remaining)
    this.#syncDisplay(remaining)
  }

  #restoreExclusions(): Set<string> {
    try {
      const raw = localStorage.getItem(EXCLUSIONS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(arr) ? arr.filter((x: unknown): x is string => typeof x === 'string') : [])
    } catch { return new Set() }
  }

  #persistExclusions(set: ReadonlySet<string>): void {
    try {
      if (set.size === 0) localStorage.removeItem(EXCLUSIONS_KEY)
      else localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify([...set]))
    } catch { /* ignore */ }
  }

  // ── child counts ───────────────────────────────────────────────────
  // Best-effort, OFF the render path: ask the worker (which resolves via the
  // warm parent-children slot, not the cold own-bag) how many children each
  // item has, in small batches so a many-item clipboard can't burst layer
  // reads. A miss stays absent — no badge, never a hang.
  async #syncCounts(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#countToken
    // Everything already known is on screen at once — only the rows this
    // display has never resolved cost a read.
    const out: Record<string, number> = {}
    const pending: { item: ClipboardItem; key: string }[] = []
    for (const item of items) {
      const key = rowKey(item)
      const cached = this.#countCache.get(key)
      if (cached === undefined) pending.push({ item, key })
      else if (cached > 0) out[key] = cached
    }
    this.counts.set({ ...out })
    if (pending.length === 0) return

    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const worker = ioc?.get?.(CLIPBOARD_WORKER_KEY) as
      { childCountAt?: (segments: readonly string[]) => Promise<number> } | undefined
    if (!worker?.childCountAt) return

    for (let i = 0; i < pending.length; i += COUNT_BATCH) {
      if (token !== this.#countToken) return
      const batch = pending.slice(i, i + COUNT_BATCH)
      await Promise.all(batch.map(async ({ item, key }) => {
        try {
          const n = await worker.childCountAt!([...item.sourceSegments, item.label])
          this.#countCache.set(key, n)
          if (n > 0) out[key] = n
        } catch { /* best-effort — stays unresolved, retried next display */ }
      }))
      // Publish progressively so badges appear as they resolve.
      if (token === this.#countToken) this.counts.set({ ...out })
    }
  }

  // ── thumbnails ─────────────────────────────────────────────────────
  // Resolve each item's ACTUAL tile image the same way the renderer does:
  // props-index (or canonical properties) -> small.image sig ->
  // Store.getResource -> object-URL. Read-only; never writes. No image ->
  // no entry -> the template shows the ⬢ glyph.

  async #syncThumbs(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#thumbToken
    const wanted = new Set(items.map(rowKey))
    // Revoke + drop any row that's no longer on screen. Bitmaps, unlike the
    // counts, are not free to hold — this is where the memory stays bounded.
    for (const key of [...this.#urls.keys()]) {
      if (!wanted.has(key)) this.#revoke(key)
    }
    // Resolve rows we don't already have a URL for, in parallel.
    const pending = items.filter(i => !this.#urls.has(rowKey(i)))
    if (pending.length === 0) { this.#publishThumbs(); return }
    await Promise.all(pending.map(async (item) => {
      // 'small' — the panel's rows are hex chrome, so the hex capture is
      // the right face here (the chat header's squares ask for 'large').
      const url = await resolveEntryImageUrl(item.label, item.sourceSegments, 'small').catch(() => null)
      // A newer clipboard state superseded this resolve — discard.
      if (token !== this.#thumbToken) { if (url) URL.revokeObjectURL(url); return }
      if (url) this.#urls.set(rowKey(item), url)
    }))
    if (token === this.#thumbToken) this.#publishThumbs()
  }

  #publishThumbs(): void {
    const map: Record<string, string> = {}
    for (const [k, v] of this.#urls) map[k] = v
    this.thumbs.set(map)
  }

  #revoke(key: string): void {
    const url = this.#urls.get(key)
    if (url) URL.revokeObjectURL(url)
    this.#urls.delete(key)
  }

  #revokeAll(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
    this.thumbs.set({})
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-clipboard-panel',
  owner: '@hypercomb.shared/ClipboardPanelComponent',
  component: ClipboardPanelComponent,
  order: 150,
})
