// presentation/tiles/quick-tray.element.ts
//
// <hc-quick-tray> — THE HAND. A strip across the top of the viewport holding
// the references you are carrying: a tile's drag handle sends one here
// (`quick-tray:take`, PortalCarryDrone), and a row dragged off it onto the
// hive places it (documentation/recents-and-the-quick-tray.md, codex A9).
//
// A framework-free custom element contributed through the ShellSurfaceRegistry
// by QuickTrayDrone (`element:` shape via IoC — never an app.html tag, never an
// Angular class), so the shim mounts it too. It takes the shell's vocabulary
// through custom properties that inherit across the shadow boundary (the
// radius ladder, the window inks, the pane) with local fallbacks.
//
// Nothing is written at the take. The strip holds {label, source page, the
// sig the page lists it by} — a selection that survives navigation: walk
// through a portal, into another hive, down a branch, and it is still here.
// Session-only, no pool, no localStorage: it is what you are holding, not a
// record.
//
// THE DROP is the only moment anything is written, and it decides:
//   • appearance — a plain release adds an incidence on the page under the
//     pointer: over a tile, INTO that tile; over an empty hex, here, in that
//     seat. The source page is untouched.
//   • custody    — Shift held at the release MOVES it: the same append, then
//     the source stops listing it.
// Both ride the clipboard worker's `clipboard:place-entries` path, which
// seals the LIVE subtree at the drop and commits ONE delta on the target
// (clipboard-sig-native.md). The worker answers `clipboard:placed-entries`
// and the rows that landed leave the strip; a row that failed stays.
//
// A row let go on a Portals-window row adds the tile to that portal through
// the index's own `portal-carry:drop` — the gesture the handle used to carry
// is still here, one step later. A release back on the strip is a cancelled
// drag, never a write.
//
// Hideable: the title folds the strip down to a small chip that keeps the count,
// and the chip brings it back. Folding lets go of nothing. Like the rest of the
// tray it lasts the session.

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
type WorkerLike = { propsSigAt?: (segments: readonly string[]) => Promise<string | null> }

const ioc = (): { get?: (k: string) => unknown } | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc

const t = (key: string, fallback: string): string =>
  (ioc()?.get?.(I18N_IOC_KEY) as I18nProvider | undefined)?.t?.(key) ?? fallback

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The thumbnail is the hex capture every face of a gathered entry shows —
 *  the same picture the clipboard panel resolves, read-only: the worker's warm
 *  props lookup, then the picture it names. A miss shows the ⬢ glyph. */
const resolveThumb = async (entry: TrayEntry): Promise<string | null> => {
  const store = ioc()?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  const worker = ioc()?.get?.('@diamondcoreprocessor.com/ClipboardWorker') as WorkerLike | undefined
  if (!store?.getResource || !worker?.propsSigAt) return null
  try {
    const propsSig = await worker.propsSigAt([...entry.sourceSegments, entry.label])
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

const STYLE = `
:host{position:fixed;inset:0;z-index:100003;pointer-events:none;}
.tray{pointer-events:auto;position:absolute;top:calc(var(--hc-header-anchor,0px) + 0.5rem);left:50%;transform:translateX(-50%);
  max-width:min(72vw,56rem);display:flex;align-items:center;gap:0.6rem;padding:0.3rem 0.6rem 0.3rem 0.8rem;
  border-radius:var(--hc-radius-floating,4px);background:rgba(var(--hc-panel-pane,12,28,46),0.92);
  backdrop-filter:blur(10px) saturate(1.1);-webkit-backdrop-filter:blur(10px) saturate(1.1);
  border:1px solid var(--hc-window-accent-quiet,rgba(126,182,214,0.45));box-shadow:0 10px 40px rgba(var(--hc-panel-shadow,0,0,0),0.5);
  font-family:var(--hc-mono,system-ui);font-size:0.8rem;color:var(--hc-window-ink-loud,currentColor);user-select:none;}
.tray.dragging{cursor:grabbing;}
.fold{appearance:none;border:0;background:transparent;padding:0;font:inherit;cursor:pointer;
  display:inline-flex;align-items:center;gap:0.35rem;letter-spacing:0.08em;text-transform:uppercase;font-size:0.7rem;
  color:var(--hc-window-accent,rgb(126,182,214));white-space:nowrap;}
.fold:hover,.fold:focus-visible{color:var(--hc-window-ink-loud,currentColor);}
.tray.folded{padding:0.25rem 0.5rem;}
.count{min-width:1.2em;padding:0 0.3em;border-radius:var(--hc-radius-control,2px);background:var(--hc-window-tint,rgba(126,182,214,0.18));text-align:center;}
.rows{display:flex;align-items:center;gap:0.3rem;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:thin;}
.row{display:inline-flex;align-items:center;gap:0.35rem;padding:0.2rem 0.3rem;border-radius:var(--hc-radius-control,2px);
  border:1px solid transparent;cursor:grab;white-space:nowrap;touch-action:none;}
.row:hover{border-color:var(--hc-window-accent-quiet,rgba(126,182,214,0.45));background:var(--hc-window-wash,rgba(126,182,214,0.08));}
.row.lifted{opacity:0.45;}
.thumb{width:1.6rem;height:1.6rem;display:inline-grid;place-items:center;overflow:hidden;}
.thumb img{width:100%;height:100%;object-fit:contain;display:block;}
.glyph{width:1.6rem;text-align:center;color:var(--hc-window-accent,rgb(126,182,214));}
.label{max-width:10rem;overflow:hidden;text-overflow:ellipsis;}
.remove{appearance:none;border:0;background:transparent;color:var(--hc-window-ink-plain,currentColor);font:inherit;line-height:1;
  padding:0 0.2rem;opacity:0;cursor:pointer;}
.row:hover .remove,.remove:focus-visible{opacity:1;}
.ghost{position:fixed;z-index:2147483600;pointer-events:none;margin-left:0.8rem;margin-top:-0.9rem;max-width:14rem;
  padding:0.3rem 0.6rem;display:flex;align-items:center;gap:0.4rem;border-radius:var(--hc-radius-floating,4px);
  background:rgba(var(--hc-panel-pane,12,28,46),0.92);border:1px solid var(--hc-window-accent-quiet,rgba(126,182,214,0.55));
  color:var(--hc-window-ink-loud,currentColor);font-family:var(--hc-mono,system-ui);font-size:0.8rem;line-height:1.2;white-space:nowrap;}
.ghost .verb{font-size:0.65rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--hc-window-accent,rgb(126,182,214));}
.ghost.custody .verb{color:var(--hc-window-warn,#ffc46b);}
.ghost .name{overflow:hidden;text-overflow:ellipsis;}
`

export class QuickTrayElement extends HTMLElement {
  #root: ShadowRoot
  #entries: readonly TrayEntry[] = []
  #thumbs = new Map<string, string>()
  #offs: Array<() => void> = []
  #pending: { entry: TrayEntry; x: number; y: number } | null = null
  #dragging: TrayEntry | null = null
  #custody = false
  #ghost: HTMLDivElement | null = null
  #swallowClick = false
  /** Folded down to the chip. The rows are still held. */
  #folded = false

  constructor() {
    super()
    this.#root = this.attachShadow({ mode: 'open' })
  }

  /** What the strip holds — read by specs and the bee, never written from outside. */
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
    // The worker's answer to a drop: what landed leaves the strip, what failed
    // stays — a partial drop loses nothing you were carrying.
    this.#offs.push(EffectBus.on<{ placed?: { label?: string; sourceSegments?: string[] }[] }>('clipboard:placed-entries', (p) => {
      const landed = (p?.placed ?? [])
        .filter((e): e is { label: string; sourceSegments: string[] } => typeof e?.label === 'string')
        .map(e => entryKey({ label: e.label, sourceSegments: e.sourceSegments ?? [] }))
      if (landed.length > 0) this.letGo(new Set(landed))
    }))
    document.addEventListener('click', this.#onClickCapture, true)
    this.#render()
  }

  disconnectedCallback(): void {
    for (const off of this.#offs.splice(0)) off()
    document.removeEventListener('click', this.#onClickCapture, true)
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
  }

  letGo(keys: ReadonlySet<string>): void {
    this.#entries = dropEntries(this.#entries, keys)
    for (const key of keys) {
      const url = this.#thumbs.get(key)
      if (url) { URL.revokeObjectURL(url); this.#thumbs.delete(key) }
    }
    this.#render()
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
    if (this.#entries.length === 0) {
      this.#root.innerHTML = `<style>${STYLE}</style>`
      return
    }
    if (this.#folded) {
      this.#root.innerHTML = `<style>${STYLE}</style>
        <div class="tray folded"><button class="fold" type="button" aria-expanded="false" title="${esc(t('quick-tray.show', 'Show the tray'))}" aria-label="${esc(t('quick-tray.show', 'Show the tray'))}">${esc(t('quick-tray.title', 'Tray'))}<span class="count">${this.#entries.length}</span></button></div>`
      this.#wireFold()
      return
    }
    // Rows are addressed by POSITION, never by key: a key holds a NUL, which an
    // HTML parser rewrites, so a key read back from an attribute matches nothing.
    const rows = this.#entries.map((entry, index) => {
      const key = entryKey(entry)
      const thumb = this.#thumbs.get(key)
      const face = thumb
        ? `<span class="thumb"><img src="${thumb}" alt="${esc(entry.label)}" draggable="false"></span>`
        : `<span class="glyph" aria-hidden="true">⬢</span>`
      return `<li class="row${this.#dragging === entry ? ' lifted' : ''}" data-index="${index}" title="${esc(t('quick-tray.drag', 'Drag onto the hive to place · Shift to move · onto a Portals row to add it there'))}">
        ${face}<span class="label">${esc(entry.label)}</span>
        <button class="remove" type="button" data-index="${index}" aria-label="${esc(t('quick-tray.remove', 'Let go of this one'))}" title="${esc(t('quick-tray.remove', 'Let go of this one'))}">×</button>
      </li>`
    }).join('')
    this.#root.innerHTML = `<style>${STYLE}</style>
      <div class="tray${this.#dragging ? ' dragging' : ''}" role="toolbar" aria-label="${esc(t('quick-tray.title', 'Tray'))}" data-consumes-wheel>
        <button class="fold title" type="button" aria-expanded="true" title="${esc(t('quick-tray.hide', 'Hide the tray'))}" aria-label="${esc(t('quick-tray.hide', 'Hide the tray'))}">${esc(t('quick-tray.title', 'Tray'))}<span class="count">${this.#entries.length}</span></button>
        <ul class="rows">${rows}</ul>
      </div>`
    for (const row of this.#root.querySelectorAll<HTMLLIElement>('.row')) {
      row.addEventListener('pointerdown', (e) => this.#onRowPointerDown(e, this.#entries[Number(row.dataset['index'])]))
    }
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>('.remove')) {
      button.addEventListener('pointerdown', (e) => e.stopPropagation())
      button.addEventListener('click', (e) => {
        e.stopPropagation()
        const entry = this.#entries[Number(button.dataset['index'])]
        if (entry) this.letGo(new Set([entryKey(entry)]))
      })
    }
    this.#wireFold()
  }

  #wireFold(): void {
    this.#root.querySelector('.fold')?.addEventListener('click', () => {
      this.#folded = !this.#folded
      this.#render()
    })
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
    this.#swallowClick = true
    this.#drop(p.entry, event)
  }

  #drop(entry: TrayEntry, event: PointerEvent): void {
    // Release point, never a remembered hover: crossing chrome makes the
    // overlay broadcast a null hover at exactly the moment it is needed.
    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
    // Letting go back on the strip is a cancelled drag, not a drop.
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
    EffectBus.emit('clipboard:place-entries', {
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

  /** A drag that ended on a row would otherwise land as its click. */
  #onClickCapture = (e: MouseEvent): void => {
    if (!this.#swallowClick) return
    this.#swallowClick = false
    e.preventDefault()
    e.stopPropagation()
  }
}

/** Define the element once; safe under hot reload and in specs. */
export const defineQuickTray = (): void => {
  if (!customElements.get(QUICK_TRAY_SURFACE)) customElements.define(QUICK_TRAY_SURFACE, QuickTrayElement)
}
