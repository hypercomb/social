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
// Shell UI — must NOT import essentials. Abstract `getter`s (not fields) carry
// `ns`/`posKey` so they resolve during base construction, before subclass
// field initializers run.

import { signal, Directive, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

export interface PinnablePanel<T> {
  id: number
  ephemeral: boolean
  /** Identity for de-dupe + per-panel position persistence. */
  key: string
  data: T
  pos: { x: number; y: number }
}

const HIDE_DELAY_MS = 260
const CASCADE_STEP = 26   // px each fresh pin is offset to fan out
const PEEK_ID = 0         // reserved id for the lone hover peek

@Directive()
export abstract class PinnableHoverBase<T> implements OnDestroy {

  /** EffectBus event namespace (e.g. 'contact', 'files:teaser'). */
  protected abstract get ns(): string
  /** localStorage key for persisted pin positions. */
  protected abstract get posKey(): string
  /** Panel width (px) — clamp + dock geometry. Override per feature. */
  protected get panelWidth(): number { return 300 }

  /** Map a raw EffectBus payload to a panel identity + data, or null to ignore. */
  protected abstract toPanel(payload: unknown): { key: string; data: T } | null

  /** Render order = stack order (later = on top). At most one ephemeral entry. */
  readonly panels = signal<PinnablePanel<T>[]>([])

  #cleanups: (() => void)[] = []
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekInside = false
  #savedPos: Record<string, { x: number; y: number }>
  #nextId = 1
  #pinnedAnnounced = false
  #dragId: number | null = null
  #dragOffset = { x: 0, y: 0 }

  constructor() {
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
    const peek: PinnablePanel<T> = { id: PEEK_ID, ephemeral: true, key, data, pos: this.#basePos() }
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
  }
  closePanel(id: number): void { this.panels.update(l => l.filter(x => x.id !== id)); this.#announce() }
  onPanelFocus(p: PinnablePanel<T>): void { if (!p.ephemeral) this.#bringToFront(p.id) }

  #bringToFront(id: number): void {
    this.panels.update(l => {
      const i = l.findIndex(x => x.id === id)
      if (i < 0 || i === l.length - 1) return l
      const c = l.slice(); const [x] = c.splice(i, 1); c.push(x); return c
    })
  }
  #update(id: number, data: T): void { this.panels.update(l => l.map(x => x.id === id ? { ...x, data } : x)) }

  /** Tell the host Escape cascade whether any pinned panel is up. */
  #announce(): void {
    const active = this.panels().some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    EffectBus.emit(`${this.ns}:pinned`, { active })
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
    if (panel) { this.#savedPos[panel.key] = panel.pos; this.#savePos() }
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
}
