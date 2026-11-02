// presentation/tiles/quick-tray.element.ts
//
// <hc-quick-tray> — THE SHELF. A full-width shelf under the header, always in
// view, holding the references you are carrying: a tile's shelf icon sends one
// here (`quick-tray:take`, PortalCarryDrone), the bottom-right "to shelf"
// button sends the selection, and a row dragged off it onto the hive places it
// (documentation/recents-and-the-quick-tray.md, codex A9). The clipboard it
// replaces is gone: nothing is cut or copied, only referenced.
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// by QuickTrayDrone (`element:` shape via IoC — never an app.html tag, never an
// Angular class), so the shim mounts it too. It takes the shell's vocabulary
// through custom properties that inherit across the shadow boundary (the
// radius ladder, the window inks, the pane, the edge reservations) with local
// fallbacks. Its look is the clipboard window's swap stage: the cyan wash and
// the drawn cut line, set on the shelf instead of on the whole viewport.
//
// THE SHELF HOLDS ITS OWN BAND. It reserves the top of the canvas
// (`viewport:inset`, pixi-host shrinks its box and refits), so fitted tiles
// are framed below it, never under it. Folded, it gives the band back.
//
// Nothing is written at the take. The shelf holds {label, source page, the sig
// the page lists it by} — a selection that survives navigation: walk through a
// portal, into another hive, down a branch, and it is still here. Session-only,
// no pool, no localStorage: it is what you are holding, not a record. It
// announces what it holds on `shelf:changed` (last-value), which the chat reads
// as the set it is talking about, and lets go on `shelf:let-go`.
//
// THE DROP is the only moment anything is written, and it decides:
//   • appearance — a plain release adds an incidence on the page under the
//     pointer: over a tile, INTO that tile; over an empty hex, here, in that
//     seat. The source page is untouched.
//   • custody    — Shift held at the release MOVES it: the same append, then
//     the source stops listing it.
// Both ride `shelf:place` (shelf-placement.worker.ts), which seals the LIVE
// subtree at the drop and commits ONE delta on the target. The worker answers
// `shelf:placed` and the rows that landed leave the shelf; a row that failed
// stays.
//
// A row let go on a Portals-window row adds the tile to that portal through
// the index's own `portal-carry:drop`. A release back on the shelf is a
// cancelled drag, never a write.
//
// Hideable: the chevron folds the shelf away, and `shelf:toggle` (the shell's
// shelf button, beside show / hide agents) folds it or brings it back. Folding
// lets go of nothing; `shelf:changed` carries `folded` with the rows, so the
// button can say the shelf still holds something. Like the rest of the shelf
// it lasts the session.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { dropEntries, entryKey, takeEntries, type TrayEntry } from './quick-tray.entries.js'

export const QUICK_TRAY_SURFACE = 'hc-quick-tray'

/** Movement before a press counts as a drag rather than a click — the same
 *  threshold the aggregate index's rows use, so a row-drag feels the same
 *  wherever it starts. */
const DRAG_THRESHOLD = 5
const SIG_RE = /^[0-9a-f]{64}$/

type LineageLike = { explorerSegments?: () => readonly string[] }
type OverlayLike = {
  labelAtClient(x: number, y: number): string | null
  dropTargetAtClient?(x: number, y: number): { label: string | null; occupied: boolean; index: number } | null
}
type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }
type PlacementLike = { propsSigAt?: (segments: readonly string[]) => Promise<string | null> }

const ioc = (): { get?: (k: string) => unknown } | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc

const t = (key: string, fallback: string): string =>
  (ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t?.(key) ?? fallback

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The thumbnail is the hex capture the hive draws, read-only: the placement
 *  worker's warm props lookup, then the picture it names. A miss shows ⬢. */
const resolveThumb = async (entry: TrayEntry): Promise<string | null> => {
  const store = ioc()?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  const placement = ioc()?.get?.('@diamondcoreprocessor.com/ShelfPlacementWorker') as PlacementLike | undefined
  if (!store?.getResource || !placement?.propsSigAt) return null
  try {
    const propsSig = await placement.propsSigAt([...entry.sourceSegments, entry.label])
    if (!propsSig) return null
    const propsBlob = await store.getResource(propsSig)
    if (!propsBlob) return null
    const props = JSON.parse(await propsBlob.text()) as {
      small?: { image?: unknown }; flat?: { small?: { image?: unknown } }
    }
    const image = props.small?.image ?? props.flat?.small?.image
    if (typeof image !== 'string' || !SIG_RE.test(image)) return null
    const blob = await store.getResource(image)
    return blob ? URL.createObjectURL(blob) : null
  } catch { return null }
}

// Under the header (60000): the shelf is the band below it, and everything
// that drops from the command line (its suggestions, the indicator menu, both
// at 60001 inside the header's layer) must fall OVER the shelf, never under.
// Above the canvas (59989), banners and the participants' hive (59995).
const STYLE = `
:host{position:fixed;inset:0;z-index:59998;pointer-events:none;
  --shelf:73,214,208;
  --shelf-top:calc(var(--hc-header-anchor,0px) + 0.375rem);
  --shelf-left:calc(max(var(--hc-controls-left,0px),var(--hc-inset-left,0px),var(--hc-seam-right,0px)) + 0.5rem);
  --shelf-right:calc(var(--hc-inset-right,0px) + 0.5rem);}
:host(.lifting){z-index:2147483600;}
.shelf{pointer-events:auto;position:absolute;top:var(--shelf-top);left:var(--shelf-left);right:var(--shelf-right);
  height:2.75rem;box-sizing:border-box;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;
  gap:0.75rem;padding:0 0.45rem 0 0.95rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.9);
  backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1);
  box-shadow:inset 0 0 2.75rem -1.25rem rgba(var(--shelf),0.55),0 8px 28px rgba(var(--hc-panel-shadow,0,0,0),0.28);
  font-family:var(--hc-font,system-ui);font-size:0.85rem;font-weight:400;color:var(--hc-window-ink-loud,currentColor);user-select:none;}
.shelf::before{content:'';position:absolute;inset:0.25rem;pointer-events:none;border-radius:var(--hc-radius-control,2px);
  --cut:rgba(var(--shelf),0.6);
  background-image:repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(90deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px),
    repeating-linear-gradient(180deg,var(--cut) 0 7px,transparent 7px 14px);
  background-size:100% 1px,100% 1px,1px 100%,1px 100%;background-position:0 0,0 100%,0 0,100% 0;background-repeat:no-repeat;}
.shelf.dragging{cursor:grabbing;}
.legend{position:relative;display:inline-flex;align-items:center;gap:0.45rem;letter-spacing:0.12em;text-transform:uppercase;font-family:var(--hc-mono,system-ui);
  font-size:0.68rem;font-weight:600;color:rgb(var(--shelf));white-space:nowrap;}
.count{min-width:1.5em;height:1.4em;box-sizing:border-box;display:inline-grid;place-items:center;padding:0 0.35em;
  border-radius:var(--hc-radius-control,2px);background:rgba(var(--shelf),0.16);color:var(--hc-window-ink-loud,currentColor);
  font-variant-numeric:tabular-nums;letter-spacing:0;}
.rows{position:relative;display:flex;align-items:center;gap:0.3rem;margin:0;padding:0;list-style:none;min-width:0;height:100%;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 1.5rem),transparent);}
.rows::-webkit-scrollbar{display:none;}
.empty{position:relative;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--hc-window-ink-quiet,currentColor);}
.row{flex:0 0 auto;position:relative;display:inline-flex;align-items:center;gap:0.4rem;height:1.9rem;box-sizing:border-box;
  padding:0 0.2rem 0 0.25rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(var(--shelf),0.22);
  background:rgba(var(--shelf),0.06);cursor:grab;white-space:nowrap;touch-action:none;outline:none;
  transition:border-color 120ms ease,background-color 120ms ease;}
.row:hover,.row:focus-visible{border-color:rgba(var(--shelf),0.6);background:rgba(var(--shelf),0.12);}
.row:focus-visible{box-shadow:0 0 0 1px rgba(var(--shelf),0.6);}
.row.lifted{opacity:0.4;}
.thumb,.glyph{width:1.4rem;height:1.4rem;flex:0 0 auto;display:inline-grid;place-items:center;overflow:hidden;}
.thumb img{width:100%;height:100%;object-fit:contain;display:block;}
.glyph{color:rgb(var(--shelf));font-size:0.95rem;line-height:1;}
.label{max-width:11rem;overflow:hidden;text-overflow:ellipsis;}
.remove{appearance:none;width:1.25rem;height:1.25rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);
  font:inherit;font-size:0.95rem;line-height:1;cursor:pointer;opacity:0;transition:opacity 120ms ease;}
.row:hover .remove,.row:focus-within .remove{opacity:0.75;}
.remove:hover,.remove:focus-visible{opacity:1;background:rgba(var(--shelf),0.2);outline:none;}
.fold{position:relative;appearance:none;width:1.75rem;height:1.75rem;display:inline-grid;place-items:center;border:0;padding:0;
  border-radius:var(--hc-radius-control,2px);background:transparent;color:var(--hc-window-ink-plain,currentColor);cursor:pointer;}
.fold:hover,.fold:focus-visible{background:rgba(var(--shelf),0.16);color:var(--hc-window-ink-loud,currentColor);outline:none;}
.fold svg{width:1rem;height:1rem;display:block;}
@keyframes hc-shelf-taken{from{background:rgba(var(--shelf),0.45);border-color:rgba(var(--shelf),0.9);}}
.taken{animation:hc-shelf-taken 700ms ease-out;}
@media (prefers-reduced-motion:reduce){.taken{animation:none;}.row,.remove{transition:none;}}
@media (max-width:640px){.shelf{gap:0.5rem;padding-left:0.75rem;}.label{max-width:7rem;}.legend .word{display:none;}}
.ghost{position:fixed;z-index:2147483600;pointer-events:none;margin-left:0.8rem;margin-top:-0.9rem;max-width:14rem;
  padding:0.3rem 0.6rem;display:flex;align-items:center;gap:0.4rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.94);box-shadow:0 0 0 1px rgba(var(--shelf),0.55),0 6px 20px rgba(var(--hc-panel-shadow,0,0,0),0.3);
  color:var(--hc-window-ink-loud,currentColor);font-family:var(--hc-font,system-ui);font-size:0.85rem;line-height:1.2;white-space:nowrap;}
.ghost .verb{font-family:var(--hc-mono,system-ui);font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:rgb(var(--shelf));}
.ghost.custody .verb{color:var(--hc-window-warn,#ffc46b);}
.ghost .name{overflow:hidden;text-overflow:ellipsis;}
`

/** Chevrons drawn inline: an icon font does not reach into a shadow root. */
const CHEVRON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>'

/** Owner of the shelf's reservation on the canvas (viewport:inset). */
const INSET_OWNER = 'quick-tray'
/** Clear air under the shelf before the hive starts, in px. */
const INSET_GAP = 6

export class QuickTrayElement extends HTMLElement {
  #root: ShadowRoot
  #entries: readonly TrayEntry[] = []
  #thumbs = new Map<string, string>()
  #offs: Array<() => void> = []
  #pending: { entry: TrayEntry; x: number; y: number } | null = null
  #dragging: TrayEntry | null = null
  #custody = false
  #ghost: HTMLDivElement | null = null
  /** Disarms the guard on a drag's trailing click, when one is armed. */
  #trailingClickCleanup: (() => void) | null = null
  /** Folded away. The rows are still held. */
  #folded = false
  /** The top band last reserved on the canvas, in px. */
  #reserved = -1
  #measureFrame = 0

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })
  }

  /** What the shelf holds — read by specs and the bee, never written from outside. */
  get entries(): readonly TrayEntry[] { return this.#entries }

  connectedCallback(): void {
    this.#offs.push(EffectBus.on<{ label?: string; segments?: string[]; sig?: string; loose?: true }>('quick-tray:take', (p) => {
      if (!p?.label) return
      this.take([{
        label: p.label,
        sourceSegments: Array.isArray(p.segments) ? p.segments : [],
        sig: p.sig,
        ...(p.loose ? { loose: true as const } : {}),
      }])
    }))
    // The worker's answer to a drop: what landed leaves the shelf, what failed
    // stays — a partial drop loses nothing you were carrying. The chat lets go
    // the same way when a row is removed from its context.
    const letGoOf = (p: { placed?: { label?: string; sourceSegments?: string[] }[]; entries?: { label?: string; sourceSegments?: string[] }[] } | undefined): void => {
      const keys = (p?.placed ?? p?.entries ?? [])
        .filter((e): e is { label: string; sourceSegments: string[] } => typeof e?.label === 'string')
        .map(e => entryKey({ label: e.label, sourceSegments: e.sourceSegments ?? [] }))
      if (keys.length > 0) this.letGo(new Set(keys))
    }
    this.#offs.push(EffectBus.on('shelf:placed', letGoOf))
    this.#offs.push(EffectBus.on('shelf:let-go', letGoOf))
    // A canvas owner that started late asks for every reservation again.
    this.#offs.push(EffectBus.on('viewport:inset-poll', () => { this.#reserved = -1; this.#reserve() }))
    // Transient on the sender's side: a shelf that mounts later must not
    // replay an old press and fold itself.
    this.#offs.push(EffectBus.on<{ open?: boolean } | undefined>('shelf:toggle', (p) => {
      this.#setFolded(typeof p?.open === 'boolean' ? !p.open : !this.#folded)
    }))
    window.addEventListener('resize', this.#onResize)
    this.#render()
    this.#announce()
  }

  disconnectedCallback(): void {
    for (const off of this.#offs.splice(0)) off()
    window.removeEventListener('resize', this.#onResize)
    cancelAnimationFrame(this.#measureFrame)
    EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size: 0 })
    this.#trailingClickCleanup?.()
    this.#detachDrag()
    this.#ghost?.remove()
    for (const url of this.#thumbs.values()) URL.revokeObjectURL(url)
    this.#thumbs.clear()
  }

  // ── holding ──────────────────────────────────────────────────────────────

  take(incoming: readonly TrayEntry[]): void {
    this.#entries = takeEntries(this.#entries, incoming)
    for (const entry of this.#entries) void this.#loadThumb(entry)
    this.#render()
    this.#answer(incoming)
    this.#announce()
  }

  /** What the shelf holds, for every reader (last-value replayed, so a chat
   *  that opens later still sees it). */
  #announce(): void {
    EffectBus.emit('shelf:changed', {
      entries: this.#entries.map(e => ({
        label: e.label,
        sourceSegments: [...e.sourceSegments],
        ...(e.sig ? { sig: e.sig } : {}),
        ...(e.loose ? { loose: true } : {}),
      })),
      folded: this.#folded,
    })
  }

  /** A take must answer where it landed. A tile already held changes no row,
   *  so without this the click looks dead. A folded shelf has no rows to light;
   *  its count travels on `shelf:changed` to the shell's button. */
  #answer(incoming: readonly TrayEntry[]): void {
    const keys = new Set(incoming.map(entryKey))
    const lit = this.#folded ? [] : this.#entries.flatMap((entry, index) =>
      keys.has(entryKey(entry)) ? [this.#root.querySelector(`.row[data-index="${index}"]`)] : [])
    for (const element of lit) element?.classList.add('taken')
  }

  letGo(keys: ReadonlySet<string>): void {
    this.#entries = dropEntries(this.#entries, keys)
    for (const key of keys) {
      const url = this.#thumbs.get(key)
      if (url) { URL.revokeObjectURL(url); this.#thumbs.delete(key) }
    }
    this.#render()
    this.#announce()
  }

  async #loadThumb(entry: TrayEntry): Promise<void> {
    const key = entryKey(entry)
    if (this.#thumbs.has(key)) return
    const url = await resolveThumb(entry)
    if (!url) return
    // The row may have left while the picture loaded — never leak its URL.
    if (!this.#entries.some(e => entryKey(e) === key)) { URL.revokeObjectURL(url); return }
    this.#thumbs.set(key, url)
    this.#render()
  }

  // ── paint ────────────────────────────────────────────────────────────────

  #render(): void {
    if (this.#folded) {
      this.#root.innerHTML = `<style>${STYLE}</style>`
      this.#reserve()
      return
    }
    // Rows are addressed by POSITION, never by key: a key holds a NUL, which an
    // HTML parser rewrites, so a key read back from an attribute matches nothing.
    const drag = esc(t('quick-tray.drag', 'Drag onto the hive to place it · hold Shift to move it'))
    const remove = esc(t('quick-tray.remove', 'Take it off the shelf'))
    const rows = this.#entries.map((entry, index) => {
      const key = entryKey(entry)
      const thumb = this.#thumbs.get(key)
      const face = thumb
        ? `<span class="thumb"><img src="${thumb}" alt="" draggable="false"></span>`
        : `<span class="glyph" aria-hidden="true">⬢</span>`
      return `<li class="row${this.#dragging === entry ? ' lifted' : ''}" data-index="${index}" tabindex="0" title="${drag}">
        ${face}<span class="label">${esc(entry.label)}</span>
        <button class="remove" type="button" data-index="${index}" tabindex="-1" aria-label="${remove}: ${esc(entry.label)}" title="${remove}">×</button>
      </li>`
    }).join('')
    const body = this.#entries.length
      ? `<ul class="rows" aria-label="${esc(t('quick-tray.title', 'Shelf'))}">${rows}</ul>`
      : `<span class="empty">${esc(t('quick-tray.empty', 'Nothing on the shelf yet. A tile\u2019s shelf icon, or To shelf on a selection, puts it here.'))}</span>`
    const hide = esc(t('quick-tray.hide', 'Hide the shelf'))
    this.#root.innerHTML = `<style>${STYLE}</style>
      <section class="shelf${this.#dragging ? ' dragging' : ''}" aria-label="${esc(t('quick-tray.title', 'Shelf'))}" data-consumes-wheel>
        <span class="legend"><span class="word">${esc(t('quick-tray.title', 'Shelf'))}</span><span class="count">${this.#entries.length}</span></span>
        ${body}
        <button class="fold" type="button" aria-expanded="true" title="${hide}" aria-label="${hide}">${CHEVRON_UP}</button>
      </section>`
    for (const row of this.#root.querySelectorAll<HTMLLIElement>('.row')) {
      row.addEventListener('pointerdown', (e) => this.#onRowPointerDown(e, this.#entries[Number(row.dataset['index'])]))
      // Delete or Backspace takes a focused row off, as its × does.
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return
        e.preventDefault()
        const entry = this.#entries[Number(row.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.remove')) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation())
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        const entry = this.#entries[Number(button.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    // A wheel over the rows scrolls them sideways, so a long shelf reads with a mouse.
    this.#root.querySelector('.rows')?.addEventListener('wheel', (e) => {
      const rowsEl = e.currentTarget as HTMLElement
      const ev = e as WheelEvent
      if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return
      rowsEl.scrollLeft += ev.deltaY
      ev.preventDefault()
    }, { passive: false })
    this.#wireFold()
    this.#reserve()
  }

  /** Hold the band under the shelf on the canvas, measured after layout. A
   *  folded shelf holds nothing. */
  #reserve(): void {
    cancelAnimationFrame(this.#measureFrame)
    this.#measureFrame = requestAnimationFrame(() => {
      const shelf = this.#folded ? null : this.#root.querySelector('.shelf')
      const size = shelf ? Math.round(shelf.getBoundingClientRect().bottom + INSET_GAP) : 0
      if (size === this.#reserved) return
      this.#reserved = size
      EffectBus.emit('viewport:inset', { owner: INSET_OWNER, side: 'top', size })
    })
  }

  #onResize = (): void => { this.#reserve() }

  #wireFold(): void {
    this.#root.querySelector('.fold')?.addEventListener('click', () => { this.#setFolded(!this.#folded) })
  }

  #setFolded(folded: boolean): void {
    if (folded === this.#folded) return
    this.#folded = folded
    if (folded) this.#endDrag()
    this.#render()
    this.#announce()
  }

  #paintGhost(x: number, y: number): void {
    if (!this.#dragging) return
    if (!this.#ghost) {
      this.#ghost = document.createElement('div')
      this.#root.appendChild(this.#ghost)
    }
    // The ghost names the VERB the release will do — place, or with Shift,
    // move — so the decision the drop makes is readable before it lands.
    this.#ghost.className = `ghost${this.#custody ? ' custody' : ''}`
    this.#ghost.setAttribute('aria-hidden', 'true')
    this.#ghost.style.left = `${x}px`
    this.#ghost.style.top = `${y}px`
    this.#ghost.innerHTML = `<span class="verb">${esc(this.#custody ? t('quick-tray.custody', 'move') : t('quick-tray.appearance', 'place'))}</span><span class="name">${esc(this.#dragging.label)}</span>`
  }

  // ── the drop ─────────────────────────────────────────────────────────────

  #onRowPointerDown(event: PointerEvent, entry: TrayEntry | undefined): void {
    if (event.button !== 0 || !entry) return
    this.#pending = { entry, x: event.clientX, y: event.clientY }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragUp)
    document.addEventListener('pointercancel', this.#onDragCancel)
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragUp)
    document.removeEventListener('pointercancel', this.#onDragCancel)
  }

  #endDrag(): void {
    this.#pending = null
    this.#detachDrag()
    this.#ghost?.remove()
    this.#ghost = null
    this.classList.remove('lifting')
    if (this.#dragging) {
      this.#dragging = null
      EffectBus.emit('drop:dragging', { active: false })
      EffectBus.emit('portal-carry:drag-end', {})
      this.#render()
    }
  }

  #onDragCancel = (): void => { this.#endDrag() }

  #onDragMove = (event: PointerEvent): void => {
    const p = this.#pending
    if (!p) return
    if (!this.#dragging) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return
      this.#dragging = p.entry
      // Chrome sits at the header's level, under dialogs; only a row in flight
      // rises over every window, so its ghost reads above a Portals row too.
      this.classList.add('lifting')
      // The overlay becomes a bare drop surface (icons hidden) and previews
      // the carried tile under the pointer — the contract a Portals row drag uses.
      EffectBus.emit('drop:dragging', { active: true, targetTile: { label: p.entry.label } })
      // Portals rows light as drop zones while a row rides the pointer. A loose
      // atom has nothing a portal could point at, so they stay dark for it.
      if (!p.entry.loose) EffectBus.emit('portal-carry:drag-start', { label: p.entry.label })
      this.#render()
    }
    this.#custody = event.shiftKey
    this.#paintGhost(event.clientX, event.clientY)
  }

  #onDragUp = (event: PointerEvent): void => {
    const p = this.#pending
    const wasDragging = this.#dragging !== null
    this.#endDrag()
    if (!wasDragging || !p) return
    this.#suppressTrailingClick()
    this.#drop(p.entry, event)
  }

  #drop(entry: TrayEntry, event: PointerEvent): void {
    // Release point, never a remembered hover: crossing chrome makes the
    // overlay broadcast a null hover at exactly the moment it is needed.
    const under = document.elementFromPoint?.(event.clientX, event.clientY) as HTMLElement | null
    // Letting go back on the shelf is a cancelled drag, not a drop.
    if (under?.closest?.(QUICK_TRAY_SURFACE)) return

    // A Portals row: add the tile to that portal through the index's own
    // handler — the same write every other way into a portal uses.
    const portalKey = under?.closest?.('[data-portal-drop]')?.getAttribute('data-portal-drop')
    // A reference needs a place to point at, and a loose atom has none, so it
    // lands on a page first.
    const ownPath = [...entry.sourceSegments, entry.label]
    if (portalKey) {
      if (!entry.loose) EffectBus.emit('portal-carry:drop', { label: entry.label, segments: ownPath, targetKey: portalKey })
      return
    }
    if (under?.closest?.('hc-aggregate-index')) {
      if (!entry.loose) EffectBus.emit('portal-carry:drop', { label: entry.label, segments: ownPath })
      return
    }

    const overlay = ioc()?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as OverlayLike | undefined
    const exact = overlay?.dropTargetAtClient?.(event.clientX, event.clientY) ?? null
    const label = exact?.label ?? overlay?.labelAtClient?.(event.clientX, event.clientY) ?? null
    const here = ((ioc()?.get?.('@hypercomb.social/Lineage') as LineageLike | undefined)?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    let targetSegments: string[]
    let targets: Record<string, number> | undefined
    if (label) {
      // Over a tile: INTO it — the incidence lands as that tile's child.
      targetSegments = [...here, label]
    } else if (exact && !exact.occupied) {
      // Over an empty hex: here, in that seat.
      targetSegments = here
      if (exact.index >= 0) targets = { [entry.label]: exact.index }
    } else {
      return   // not over the hive — nothing happens
    }

    // A loose atom has no page to release, so Shift cannot make it a move.
    EffectBus.emit('shelf:place', {
      entries: [{
        label: entry.label,
        sourceSegments: [...entry.sourceSegments],
        ...(entry.loose && entry.sig ? { sig: entry.sig } : {}),
      }],
      targetSegments,
      ...(targets ? { targets } : {}),
      custody: event.shiftKey && !entry.loose,
    })
  }

  /** A drag may synthesize a click after pointerup, which must not land as a
   *  press on whatever is under the release. It may also synthesize none: the
   *  shelf re-renders during a drag, and a pressed row that is gone produces no
   *  click. So the participant's next press disarms the guard, or their own
   *  next click would be swallowed. Same guard as the aggregate index. */
  #suppressTrailingClick(): void {
    this.#trailingClickCleanup?.()
    let armed = true
    const cleanup = (): void => {
      if (!armed) return
      armed = false
      window.removeEventListener('click', swallow, true)
      window.removeEventListener('pointerdown', cleanup, true)
      if (this.#trailingClickCleanup === cleanup) this.#trailingClickCleanup = null
    }
    const swallow = (event: MouseEvent): void => {
      cleanup()
      event.stopImmediatePropagation()
      event.preventDefault()
    }
    window.addEventListener('click', swallow, true)
    window.addEventListener('pointerdown', cleanup, true)
    this.#trailingClickCleanup = cleanup
  }
}

/** Define the element once; safe under hot reload and in specs. */
export const defineQuickTray = (): void => {
  if (!customElements.get(QUICK_TRAY_SURFACE)) customElements.define(QUICK_TRAY_SURFACE, QuickTrayElement)
}
