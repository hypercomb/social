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
//   • reads   `clipboard:changed` ({ items, op, count }) — last-value
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

import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

interface ClipboardItem {
  label: string
  sourceSegments: readonly string[]
}

interface ClipboardChangedPayload {
  items?: ClipboardItem[]
  op?: 'copy' | 'cut'
  count?: number
}

const SIG_RE = /^[0-9a-f]{64}$/i
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'
// Participant-local set of absolute source paths a nested-discard has dropped.
// Shared verbatim with the clipboard worker, which prunes these branches on
// paste. localStorage, never the layer — clipboard state is participant-local.
const EXCLUSIONS_KEY = 'hc:clipboard-exclusions'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY = '@hypercomb.social/Store'
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

type HistoryLike = {
  sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
}
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }

@Component({
  selector: 'hc-clipboard-panel',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './clipboard-panel.component.html',
  styleUrls: ['./clipboard-panel.component.scss'],
})
export class ClipboardPanelComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly items = signal<ClipboardItem[]>([])
  readonly op = signal<'copy' | 'cut'>('copy')
  /** label -> thumbnail object-URL, for the template. Empty entry => glyph. */
  readonly thumbs = signal<Record<string, string>>({})
  /** label -> number of children at that source location. Best-effort, resolved
   *  off the render path; absent/0 => no badge. Foreshadows the drill-down:
   *  the hex is your handle into that subtree. */
  readonly counts = signal<Record<string, number>>({})
  /** label -> the tile's current index (its spiral slot) — the DEFAULT paste
   *  target, resolved best-effort. */
  readonly indexes = signal<Record<string, number>>({})
  /** label -> user-chosen paste target index, overriding the default. */
  readonly targets = signal<Record<string, number>>({})

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
  /** Drag-resized panel width (px), restored from localStorage on construct. */
  readonly width = signal<number>(this.#restoreWidth())
  /** True while a left-grip drag is in progress (drives cursor/handle style). */
  readonly resizing = signal(false)
  /** Content scale derived from width — the panel's em-sized content shrinks
   *  as it narrows and grows as it widens. Bound to `--hc-panel-scale`.
   *  Clamped so text stays readable and never balloons at max width. */
  readonly contentScale = computed(() =>
    Math.min(1.5, Math.max(0.82, this.width() / DEFAULT_WIDTH)),
  )

  #cleanups: (() => void)[] = []
  // Live object-URLs by label, so they can be revoked on change/destroy.
  #urls = new Map<string, string>()
  // Monotonic token so a stale async thumbnail resolve can't overwrite a
  // newer clipboard state (rapid copy/clear races).
  #thumbToken = 0
  // Same guard for the (separate) child-count resolution.
  #countToken = 0
  // …and the default-index resolution.
  #indexToken = 0
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
      if (p?.op === 'copy' || p?.op === 'cut') this.op.set(p.op)
      // An emptied clipboard (e.g. a cut fully consumed by a place) closes
      // the panel — there is nothing left to show.
      if (next.length === 0) this.#setVisible(false)
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
      const next = p?.visible ?? !this.visible()
      this.#setVisible(next && this.items().length > 0)
    }))

    // escape-cascade owns Escape ORDERING (editor > viewers > selection >
    // clipboard) and right-click; it emits `clipboard:close` when the panel
    // is the active overlay. The panel announces its open state via
    // `clipboard:open` (emitted by #setVisible) so the cascade knows.
    this.#cleanups.push(EffectBus.on('clipboard:close', () => this.close()))

    // Subscriptions wired; allow auto-open from here on.
    this.#ready = true
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
    if (v) { this.#drillStack.set([]); this.#drillChildren.set([]) }
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

  /** Resolve thumbnails + counts + default indexes for the on-screen set. */
  #syncDisplay(items: readonly ClipboardItem[]): void {
    void this.#syncThumbs(items).catch(() => { /* best-effort thumbnails */ })
    void this.#syncCounts(items).catch(() => { /* best-effort child counts */ })
    void this.#syncIndexes(items).catch(() => { /* best-effort indexes */ })
  }

  // ── paste targets (hover number) ───────────────────────────────────
  // Each item's DEFAULT target is its current index (resolved best-effort from
  // the worker, off the render path). The user can override per item; on paste
  // we hand the overrides to the worker, which sets each placed tile's `index`.

  async #syncIndexes(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#indexToken
    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const worker = ioc?.get?.(CLIPBOARD_WORKER_KEY) as
      { indexAt?: (segments: readonly string[]) => Promise<number | null> } | undefined
    if (!worker?.indexAt) { this.indexes.set({}); return }
    const out: Record<string, number> = {}
    for (let i = 0; i < items.length; i += COUNT_BATCH) {
      if (token !== this.#indexToken) return
      const batch = items.slice(i, i + COUNT_BATCH)
      await Promise.all(batch.map(async (item) => {
        try {
          const n = await worker.indexAt!([...item.sourceSegments, item.label])
          if (n != null) out[item.label] = n
        } catch { /* best-effort */ }
      }))
      if (token === this.#indexToken) this.indexes.set({ ...out })
    }
  }

  /** Effective paste target for a label: the user's override, else the default
   *  index, else null (auto). */
  targetFor(label: string): number | null {
    const t = this.targets()[label]
    if (typeof t === 'number') return t
    const d = this.indexes()[label]
    return typeof d === 'number' ? d : null
  }

  /** Set / clear the user's target from the editable field. Empty = back to
   *  the default. */
  setTarget(label: string, raw: string): void {
    const n = parseInt(raw, 10)
    this.targets.update(t => {
      const next = { ...t }
      if (Number.isFinite(n)) next[label] = n
      else delete next[label]
      return next
    })
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
      targets: this.targets(),
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
        targets: this.targets(),
        targetSegments,
      })
    } else {
      EffectBus.emit('clipboard:place-items', { labels: [item.label], targets: this.targets(), targetSegments })
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
    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const worker = ioc?.get?.(CLIPBOARD_WORKER_KEY) as
      { childCountAt?: (segments: readonly string[]) => Promise<number> } | undefined
    if (!worker?.childCountAt) { this.counts.set({}); return }

    const out: Record<string, number> = {}
    for (let i = 0; i < items.length; i += COUNT_BATCH) {
      if (token !== this.#countToken) return
      const batch = items.slice(i, i + COUNT_BATCH)
      await Promise.all(batch.map(async (item) => {
        try {
          const n = await worker.childCountAt!([...item.sourceSegments, item.label])
          if (n > 0) out[item.label] = n
        } catch { /* best-effort */ }
      }))
      // Publish progressively so badges appear as they resolve.
      if (token === this.#countToken) this.counts.set({ ...out })
    }
  }

  trackByLabel(_i: number, item: ClipboardItem): string {
    // Identity = label + source path. The clipboard can legitimately hold
    // two same-named items from different source folders (a multi-parent
    // cut), and keying on label alone would make @for reuse one <li> for
    // both — a render glitch.
    return item.label + ' ' + item.sourceSegments.join('/')
  }

  // ── thumbnails ─────────────────────────────────────────────────────
  // Resolve each item's ACTUAL tile image the same way the renderer does:
  // props-index (or canonical properties) -> small.image sig ->
  // Store.getResource -> object-URL. Read-only; never writes. No image ->
  // no entry -> the template shows the ⬢ glyph.

  async #syncThumbs(items: readonly ClipboardItem[]): Promise<void> {
    const token = ++this.#thumbToken
    const wanted = new Set(items.map(i => i.label))
    // Revoke + drop any label that's no longer present.
    for (const label of [...this.#urls.keys()]) {
      if (!wanted.has(label)) this.#revoke(label)
    }
    // Resolve labels we don't already have a URL for, in parallel.
    const pending = items.filter(i => !this.#urls.has(i.label))
    if (pending.length === 0) { this.#publishThumbs(); return }
    await Promise.all(pending.map(async (item) => {
      const url = await this.#resolveImageUrl(item.label, item.sourceSegments).catch(() => null)
      // A newer clipboard state superseded this resolve — discard.
      if (token !== this.#thumbToken) { if (url) URL.revokeObjectURL(url); return }
      if (url) this.#urls.set(item.label, url)
    }))
    if (token === this.#thumbToken) this.#publishThumbs()
  }

  #publishThumbs(): void {
    const map: Record<string, string> = {}
    for (const [k, v] of this.#urls) map[k] = v
    this.thumbs.set(map)
  }

  async #resolveImageUrl(label: string, sourceSegments: readonly string[]): Promise<string | null> {
    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const history = ioc?.get?.(HISTORY_KEY) as HistoryLike | undefined
    const store = ioc?.get?.(STORE_KEY) as StoreLike | undefined
    if (!store?.getResource) return null

    // Thumbnails are best-effort and must NEVER block the UI. Resolve ONLY
    // through the participant-local props-index (localStorage, O(1)) — the
    // same cache the renderer reads. It is populated for any tile that has
    // been rendered, which a copied tile always has been. We deliberately do
    // NOT fall back to `history.currentLayerAt`: for a tile with no index
    // entry that read can trigger a cold `preloadAllBags` whole-tree scan,
    // and a clipboard of N such items would fire N scans and hang the panel.
    // A miss simply shows the ⬢ glyph.
    let locSig = ''
    if (history?.sign) {
      try { locSig = await history.sign({ explorerSegments: () => [...sourceSegments, label] }) } catch { /* cold */ }
    }
    let propsSig = this.#lookupPropsSig(locSig, label)
    if (!propsSig) {
      // Render-index miss — the tile was never rendered with this image (a cut
      // tile, or a freshly generated image). Fall back to the CANONICAL props
      // sig from the tile's layer, resolved the warm way by the worker, so the
      // thumbnail shows WITHOUT a render and a generated image is never lost.
      propsSig = (await this.#canonicalPropsSig([...sourceSegments, label])) ?? undefined
    }
    if (!propsSig) return null

    const propsBlob = await store.getResource(propsSig)
    if (!propsBlob) return null
    let props: Record<string, unknown>
    try { props = JSON.parse(await propsBlob.text()) } catch { return null }

    const imageSig = this.#imageSigOf(props)
    if (!imageSig) return null
    const imgBlob = await store.getResource(imageSig)
    if (!imgBlob) return null
    return URL.createObjectURL(imgBlob)
  }

  #lookupPropsSig(locSig: string, label: string): string | undefined {
    try {
      const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
      const v = (locSig && idx[locSig]) ?? idx[label]
      return (typeof v === 'string' && SIG_RE.test(v)) ? v : undefined
    } catch { return undefined }
  }

  /** Canonical props sig from the tile's LAYER (via the worker's warm path),
   *  used only when the localStorage render-index has no entry. Best-effort. */
  async #canonicalPropsSig(segments: readonly string[]): Promise<string | undefined> {
    const ioc = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
    const worker = ioc?.get?.(CLIPBOARD_WORKER_KEY) as
      { propsSigAt?: (s: readonly string[]) => Promise<string | null> } | undefined
    if (!worker?.propsSigAt) return undefined
    try { return (await worker.propsSigAt(segments)) ?? undefined } catch { return undefined }
  }

  #imageSigOf(props: Record<string, unknown>): string | undefined {
    const small = (props as { small?: { image?: unknown } }).small
    if (small && typeof small === 'object' && typeof small.image === 'string' && SIG_RE.test(small.image)) return small.image
    const flat = (props as { flat?: { small?: { image?: unknown } } }).flat
    const fi = flat?.small?.image
    if (typeof fi === 'string' && SIG_RE.test(fi)) return fi
    return undefined
  }

  #revoke(label: string): void {
    const url = this.#urls.get(label)
    if (url) URL.revokeObjectURL(url)
    this.#urls.delete(label)
  }

  #revokeAll(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
    this.thumbs.set({})
  }
}
