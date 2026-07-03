// hypercomb-shared/ui/pinnable/pinnable-hover.base.ts
//
// Reusable "hover-peek → click-to-pin" panel stack, generalized from the
// contact-hover pattern so any feature can compose it. The base owns:
//
//   • one ephemeral PEEK that appears on hover and fades shortly after the
//     pointer leaves (unless the pointer is on it),
//   • any number of PINNED panels — click to pin; each is INDEPENDENTLY
//     draggable, cascade-offset on creation, brought-to-front on focus, and
//     its position is persisted participant-local (localStorage, keyed by the
//     panel's `key`). Pin several and drag them apart to COMPARE side by side,
//   • the Escape-cascade announce so the host closes pinned panels before
//     falling through to clearing the selection.
//
// A subclass supplies an EffectBus namespace (`ns`), a position-store key
// (`posKey`), and a `toPanel()` mapping from the raw event payload to a
// { key, data } pair. The subclass @Component owns the template that renders
// each panel's `data` (contact cards, file-type badges, …).
//
// Wiring (per namespace `ns`):
//   `${ns}:hover-show`  → ephemeral peek (refreshes an existing pin in place)
//   `${ns}:hover-pin`   → persistent, draggable pinned panel
//   `${ns}:hover-hide`  → auto-hide the peek (pins unaffected)
//   `${ns}:hover-unpin` → close the front-most pinned panel (Escape cascade)
//   emits `${ns}:pinned` { active } so the host Escape cascade knows.
//
// Shell UI — must NOT import essentials. `ns`/`posKey`/`panelWidth` are abstract
// getters the subclass overrides; the EffectBus wiring lives in ngOnInit (not the
// constructor) so those getters resolve only after the subclass is fully built.

import { signal, Directive, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

export interface PinnablePanel<T> {
  id: number
  ephemeral: boolean
  /** Identity for de-dupe + per-panel position persistence. */
  key: string
  data: T
  pos: { x: number; y: number }
}

/** A persisted open-pin: identity + last-known data + position (position may
 *  be absent in older/corrupt entries — restore falls back to the base spot). */
type OpenSnap<T> = { key: string; data: T; pos?: { x: number; y: number } }

const HIDE_DELAY_MS = 260
const CASCADE_STEP = 26   // px each fresh pin is offset to fan out
const PEEK_ID = 0         // reserved id for the lone hover peek

@Directive()
export abstract class PinnableHoverBase<T> implements OnInit, OnDestroy {

  /** EffectBus event namespace (e.g. 'contact', 'files:teaser'). */
  protected abstract get ns(): string
  /** localStorage key for persisted pin positions. */
  protected abstract get posKey(): string
  /** Panel width (px) — clamp + dock geometry. Override per feature. */
  protected get panelWidth(): number { return 300 }

  /** Opt in to surviving a refresh. When true, pinned panels are persisted
   *  (key + data + pos) participant-local and RE-OPENED on the next mount —
   *  the "keep it always showing even after I come back" behaviour. Default
   *  off: most hover features are transient (a peek you pin to compare, then
   *  drop). Contact-card / notes-style windows override to true. */
  protected get persistent(): boolean { return false }

  /** Opt in to PAGE-SCOPED pins. When true, pinned panels belong to the
   *  navigation page (location) they were pinned on: they HIDE when the user
   *  navigates away and RE-SHOW when the user returns. With `persistent` also
   *  on, the open set is saved per page so a refresh restores only the page you
   *  land on. Default off: pins are global and show on every page. Contact
   *  cards override to true — "stay pinned for that page". */
  protected get pageScoped(): boolean { return false }

  /** Identity of the current navigation page — re-read on every Lineage
   *  `change` while `pageScoped`. Subclasses override to return the active
   *  location key (e.g. the parent segments joined). Opaque to the base: it
   *  only compares keys for equality, so any stable per-page string works. */
  protected currentPageKey(): string { return '' }

  /** Map a raw EffectBus payload to a panel identity + data, or null to ignore. */
  protected abstract toPanel(payload: unknown): { key: string; data: T } | null

  /** Optional anchor for NEW panels (the hover peek + fresh pins). A subclass
   *  that tracks the pointer returns it so the card appears AT the hover —
   *  a true mouse-over card — instead of the classic top-right dock. Null
   *  (the default) keeps the dock; per-key saved positions still win for
   *  pins the user has dragged. */
  protected anchorPos(): { x: number; y: number } | null { return null }

  /** Render order = stack order (later = on top). At most one ephemeral entry. */
  readonly panels = signal<PinnablePanel<T>[]>([])

  #cleanups: (() => void)[] = []
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekInside = false
  #savedPos: Record<string, { x: number; y: number }> = {}
  #nextId = 1
  #pinnedAnnounced = false
  // Page-scoped pins: pinned panels for pages OTHER than the visible one are
  // parked here (hidden), keyed by page; `panels` holds only the current
  // page's pins (+ the peek). Unused when `pageScoped` is false.
  #parkedByPage = new Map<string, PinnablePanel<T>[]>()
  #currentPage = ''
  #dragId: number | null = null
  #dragOffset = { x: 0, y: 0 }

  ngOnInit(): void {
    this.#savedPos = this.#loadPos()
    const ns = this.ns

    this.#cleanups.push(EffectBus.on(`${ns}:hover-show`, (p) => {
      const m = this.toPanel(p); if (!m) return
      const pinned = this.panels().find(x => !x.ephemeral && x.key === m.key)
      if (pinned) { this.#update(pinned.id, m.data); this.#hidePeek(); return }
      this.#cancelHide(); this.#showPeek(m.key, m.data)
    }))
    this.#cleanups.push(EffectBus.on(`${ns}:hover-pin`, (p) => {
      const m = this.toPanel(p); if (!m) return
      this.#pin(m.key, m.data)
    }))
    this.#cleanups.push(EffectBus.on(`${ns}:hover-hide`, () => {
      if (this.#peekInside) return
      this.#scheduleHide()
    }))
    this.#cleanups.push(EffectBus.on(`${ns}:hover-unpin`, () => {
      const list = this.panels()
      for (let i = list.length - 1; i >= 0; i--) if (!list[i].ephemeral) { this.closePanel(list[i].id); return }
    }))

    // Page-scoped pins: track the active page and swap the visible pin set as
    // the user navigates. Resolve Lineage lazily (shared core); when it's
    // absent (tests) the feature degrades to global pins.
    if (this.pageScoped) {
      this.#currentPage = this.currentPageKey()
      const lineage = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as EventTarget | undefined
      if (lineage?.addEventListener) {
        const onNav = (): void => this.#onPageChange()
        lineage.addEventListener('change', onNav)
        this.#cleanups.push(() => lineage.removeEventListener('change', onNav))
      }
    }

    // Re-open pins parked in a previous session (persistent features only).
    this.#restoreOpen()
  }

  ngOnDestroy(): void {
    this.#cancelHide()
    this.#detachDrag()
    if (this.#pinnedAnnounced) EffectBus.emit(`${this.ns}:pinned`, { active: false })
    for (const c of this.#cleanups) c()
  }

  // ── peek (transient hover) ────────────────────────────
  onPeekEnter(p: PinnablePanel<T>): void { if (p.ephemeral) { this.#peekInside = true; this.#cancelHide() } }
  onPeekLeave(p: PinnablePanel<T>): void { if (p.ephemeral) { this.#peekInside = false; this.#scheduleHide() } }

  #showPeek(key: string, data: T): void {
    const a = this.anchorPos()
    const peek: PinnablePanel<T> = { id: PEEK_ID, ephemeral: true, key, data, pos: a ? this.#clamp(a.x, a.y) : this.#basePos() }
    this.panels.update(l => [...l.filter(x => x.id !== PEEK_ID), peek])
  }
  #hidePeek(): void {
    this.#peekInside = false
    this.panels.update(l => l.filter(x => x.id !== PEEK_ID))
  }
  #scheduleHide(): void { this.#cancelHide(); this.#hideTimer = setTimeout(() => this.#hidePeek(), HIDE_DELAY_MS) }
  #cancelHide(): void { if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = null } }

  // ── pin / stack ───────────────────────────────────────
  #pin(key: string, data: T): void {
    this.#hidePeek()
    const existing = this.panels().find(x => !x.ephemeral && x.key === key)
    if (existing) { this.#update(existing.id, data); this.#bringToFront(existing.id); return }
    const panel: PinnablePanel<T> = { id: this.#nextId++, ephemeral: false, key, data, pos: this.#nextPinPos(key) }
    this.panels.update(l => [...l, panel])
    this.#announce()
    this.#saveOpen()
  }
  closePanel(id: number): void { this.panels.update(l => l.filter(x => x.id !== id)); this.#announce(); this.#saveOpen() }
  onPanelFocus(p: PinnablePanel<T>): void { if (!p.ephemeral) this.#bringToFront(p.id) }

  #bringToFront(id: number): void {
    this.panels.update(l => {
      const i = l.findIndex(x => x.id === id)
      if (i < 0 || i === l.length - 1) return l
      const c = l.slice(); const [x] = c.splice(i, 1); c.push(x); return c
    })
  }
  /** Replace a pinned panel's data in place — subclass hook for in-panel
   *  mutations (e.g. removing one card from a multi-card panel). */
  protected updateData(id: number, data: T): void { this.#update(id, data) }
  /** Dismiss the transient hover peek — subclass hook for the same. */
  protected dismissPeek(): void { this.#hidePeek() }
  #update(id: number, data: T): void { this.panels.update(l => l.map(x => x.id === id ? { ...x, data } : x)); this.#saveOpen() }

  /** Tell the host Escape cascade whether any pinned panel is up. */
  #announce(): void {
    const active = this.panels().some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    EffectBus.emit(`${this.ns}:pinned`, { active })
  }

  /** Navigation changed (pageScoped only): park the visible page's pins and
   *  bring the new page's pins (if any) back into view. The transient peek is
   *  dropped. Only pins on the CURRENT page are ever in `panels`, so parking
   *  the whole visible set under the old page key is correct. */
  #onPageChange(): void {
    if (!this.pageScoped) return
    const next = this.currentPageKey()
    if (next === this.#currentPage) return
    const leaving = this.panels().filter(p => !p.ephemeral)
    if (leaving.length) this.#parkedByPage.set(this.#currentPage, leaving)
    else this.#parkedByPage.delete(this.#currentPage)
    this.#currentPage = next
    const arriving = this.#parkedByPage.get(next) ?? []
    this.#parkedByPage.delete(next)
    this.panels.set(arriving)
    this.#announce()
  }

  // ── drag (pinned panels only) ─────────────────────────
  onHeaderDown(e: PointerEvent, p: PinnablePanel<T>): void { if (!p.ephemeral) this.startDrag(e, p.id) }
  startDrag(e: PointerEvent, id: number): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.#bringToFront(id)
    const panel = this.panels().find(x => x.id === id); if (!panel) return
    this.#dragId = id
    this.#dragOffset = { x: e.clientX - panel.pos.x, y: e.clientY - panel.pos.y }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragEnd)
  }
  #onDragMove = (e: PointerEvent): void => {
    if (this.#dragId === null) return
    const pos = this.#clamp(e.clientX - this.#dragOffset.x, e.clientY - this.#dragOffset.y)
    this.panels.update(l => l.map(x => x.id === this.#dragId ? { ...x, pos } : x))
  }
  #onDragEnd = (): void => {
    if (this.#dragId === null) return
    const panel = this.panels().find(x => x.id === this.#dragId)
    if (panel) { this.#savedPos[panel.key] = panel.pos; this.#savePos(); this.#saveOpen() }
    this.#dragId = null
    this.#detachDrag()
  }
  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragEnd)
  }
  #clamp(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - this.panelWidth - 8)
    const maxY = Math.max(0, window.innerHeight - 80)
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) }
  }

  // ── positions ─────────────────────────────────────────
  #basePos(): { x: number; y: number } {
    const x = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - this.panelWidth - 24) : 24
    return { x, y: 96 }
  }
  #nextPinPos(key: string): { x: number; y: number } {
    const saved = this.#savedPos[key]
    if (saved) return this.#clamp(saved.x, saved.y)
    // Anchored features pin where the user is looking (the hover spot);
    // docked features cascade from the top-right base.
    const a = this.anchorPos()
    if (a) return this.#clamp(a.x, a.y)
    const base = this.#basePos()
    const n = this.panels().filter(x => !x.ephemeral).length
    return this.#clamp(base.x - n * CASCADE_STEP, base.y + n * CASCADE_STEP)
  }
  #loadPos(): Record<string, { x: number; y: number }> {
    try {
      const raw = localStorage.getItem(this.posKey)
      if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') return o as Record<string, { x: number; y: number }> }
    } catch { /* ignore */ }
    return {}
  }
  #savePos(): void { try { localStorage.setItem(this.posKey, JSON.stringify(this.#savedPos)) } catch { /* ignore */ } }

  // ── open-pin persistence (survive refresh; persistent subclasses only) ──
  // Positions are already kept by key in `#savedPos`; this additionally records
  // WHICH pins are open (with a snapshot of their data) so they can be rebuilt
  // on the next mount. No-op unless the subclass opts in via `persistent`.
  #openKey(): string { return `${this.posKey}:open` }

  /** One open-pin snapshot: identity + last-known data + position. */
  #snapshot(p: PinnablePanel<T>): OpenSnap<T> {
    return { key: p.key, data: p.data, pos: p.pos }
  }

  /** Rebuild panels from persisted snapshots (fresh ids, clamped positions). */
  #snapsToPanels(arr: unknown): PinnablePanel<T>[] {
    if (!Array.isArray(arr)) return []
    return arr
      .filter((e: unknown): e is OpenSnap<T> =>
        !!e && typeof (e as { key?: unknown }).key === 'string')
      .map((e) => ({
        id: this.#nextId++,
        ephemeral: false,
        key: e.key,
        data: e.data,
        // Data snapshot is last-known; the next hover refreshes it in place.
        pos: this.#clamp(e.pos?.x ?? this.#basePos().x, e.pos?.y ?? this.#basePos().y),
      }))
  }

  #saveOpen(): void {
    if (!this.persistent) return
    try {
      const visible = this.panels().filter(p => !p.ephemeral).map(p => this.#snapshot(p))

      // Global (non-pageScoped): a flat array, as before.
      if (!this.pageScoped) {
        if (visible.length) localStorage.setItem(this.#openKey(), JSON.stringify(visible))
        else localStorage.removeItem(this.#openKey())
        return
      }

      // Page-scoped: a { [page]: snapshot[] } map — every parked page plus the
      // currently-visible page — so a refresh restores only the page you land on.
      const map: Record<string, OpenSnap<T>[]> = {}
      for (const [page, list] of this.#parkedByPage) {
        if (list.length) map[page] = list.map(p => this.#snapshot(p))
      }
      if (visible.length) map[this.#currentPage] = visible
      else delete map[this.#currentPage]
      if (Object.keys(map).length) localStorage.setItem(this.#openKey(), JSON.stringify(map))
      else localStorage.removeItem(this.#openKey())
    } catch { /* ignore */ }
  }

  #restoreOpen(): void {
    if (!this.persistent) return
    try {
      const raw = localStorage.getItem(this.#openKey())
      if (!raw) return
      const parsed = JSON.parse(raw)

      // Global (non-pageScoped): a flat array.
      if (!this.pageScoped) {
        const restored = this.#snapsToPanels(parsed)
        if (restored.length) { this.panels.set(restored); this.#announce() }
        return
      }

      // Page-scoped: a { [page]: snapshot[] } map. Show the current page's pins
      // now; park every other page so they re-appear on return. (A legacy flat
      // array from before page-scoping is ignored — pins re-pin on next click.)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      for (const [page, list] of Object.entries(parsed as Record<string, unknown>)) {
        const panels = this.#snapsToPanels(list)
        if (!panels.length) continue
        if (page === this.#currentPage) this.panels.set(panels)
        else this.#parkedByPage.set(page, panels)
      }
      if (this.panels().some(p => !p.ephemeral)) this.#announce()
    } catch { /* ignore */ }
  }
}
