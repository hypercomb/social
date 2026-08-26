// pheromone-tiles.view.ts — THE CARD BESIDE THE HEX, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/pheromone-tiles: same surface name
// (hc-pheromone-tiles), same order band (175), the same four effects in
// (`pheromone:hover-show`, `pheromone:hover-pin`, `pheromone:hover-hide`,
// `pheromone:hover-unpin`) and the same three out (`pheromone:pinned`,
// `pheromone:card-left`, `pheromone:remove-from-tile`). It now ships from the
// directory that owns the other half of this surface: pheromone-tiles.drone.ts
// is right beside this file, and the two are one feature.
//
// WHAT IT IS FOR. While the Pheromones window is open, hovering a tile that
// carries keywords pops an ephemeral card of coloured chips BESIDE THE HEX —
// to its right, or its left when the viewport runs out — in one stable spot
// per tile, however the cursor wanders. The ⌖ in its header PINS it (draggable,
// per the shared pin stack) so the ×'s are easy to hit. An × takes that one
// keyword off that one tile: the surgical counterpart to the panel's bulk
// staged removal, "this tile, this keyword, gone."
//
// The pin used to be an icon on the tile's hover band. That band no longer
// shows while this window is open — it sat on top of this card and swallowed
// the press meant for the hive — so the pin moved onto the card.
//
// THE PIN STACK CAME WITH IT. The Angular component composed
// the former `PinnableHoverBase` Angular directive — the hover-peek →
// click-to-pin → drag stack the contact card also uses. The base is now
// retired; the stack this ONE surface actually uses is inlined below, with
// the base's own settings folded in as
// constants rather than overridable getters —
//
//   ns              'pheromone'              → the four effect names
//   posKey          'hc:pheromone-pins-pos'  → INERT here, see below
//   panelWidth      240px                    → clamp + beside-the-hex geometry
//   pageScoped      true                     → pins belong to the page they
//                                              were pinned on: park on
//                                              navigate-away, come back on
//                                              return
//   stickyPositions false                    → move a pin and it stays put,
//                                              but HIDING it forgets the spot,
//                                              so the next hover lands back at
//                                              the tile-side default
//   persistent      false (the base default) → a pheromone session is a
//                                              session; nothing survives a
//                                              refresh
//
// Two consequences worth naming, because they look like omissions:
//   • `hc:pheromone-pins-pos` is NOT a stream and is NOT written here. It is
//     the base's per-key saved-position map in localStorage, and the base
//     reads it only `stickyPositions ? saved : undefined` — which is always
//     `undefined` for this panel. The Angular version loaded the key and then
//     never consulted it. Consulting it here would be a behaviour CHANGE (a
//     stale entry left by some other build would drag a fresh pin to the wrong
//     spot), so the port neither reads nor writes it.
//   • `hc:tag-colors` is not a stream either: it is the localStorage fallback
//     the TagRegistry lookup falls through to when the registry is absent,
//     read once per chip while building a card.
//
// RENDER STRATEGY. Rebuild-on-change, with the ONE sanctioned exception: each
// card's <aside> ROOT is kept in `#cards` and reused, because the root IS the
// hover surface. Its `pointerleave` is what dismisses the peek, and destroying
// a hovered node makes the browser fire that leave — so rebuilding the root
// when a chip is removed (which happens with the pointer sitting ON the card)
// would dismiss the card out from under the participant mid-gesture. Angular's
// `@for … track panel.id` reused the node for exactly this reason. The root's
// CHILDREN rebuild freely on every render (state lives in `#panels`, never in
// the DOM), and reordering moves roots with `appendChild`, which MOVES rather
// than re-creates. The drag is a position stream: it mutates the live node's
// left/top and the panel's `pos` in state — no render per pointermove.
//
// Its strings ship WITH it (pheromone-tiles.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, holdWindow, type I18nProvider, type WindowSession } from '@hypercomb/core'
import { PHEROMONE_TILES_TRANSLATIONS } from './pheromone-tiles.i18n.js'

const SURFACE_NAME = 'hc-pheromone-tiles'

/** Reserved id for the lone hover peek — the base's PEEK_ID. */
const PEEK_ID = 0
/** How long the peek lingers after the pointer leaves it. */
const HIDE_DELAY_MS = 260
/** Card width; the clamp and the beside-the-hex flip both read it. */
const PANEL_WIDTH = 240
/** Chip colour of last resort — no registry, no stored colour. */
const DEFAULT_CHIP = '#7eb6d6'
/** Small gap so the card lands beside the cursor, not under it — the fallback
 *  when no tile anchor arrived with the hover. */
const CURSOR_GAP = { x: 16, y: 12 }
/** Breathing room between the hex's edge and the card. */
const TILE_GAP = 18

const LINEAGE_KEY = '@hypercomb.social/Lineage'
const TAG_REGISTRY_KEY = '@hypercomb.social/TagRegistry'
/** The colour cache the Pheromones panel writes; read-only from here. */
const TAG_COLORS_STORAGE = 'hc:tag-colors'

interface PheromoneChip { name: string; color: string }

interface PheromoneTileData {
  label: string
  segments: string[]
  chips: PheromoneChip[]
}

/** The tile's screen geometry, sent by PheromoneTilesDrone: hex centre +
 *  circumradius in client coordinates. */
type TileAnchor = { x: number; y: number; radius: number }
type HoverPayload = { label?: string; segments?: string[]; pheromones?: string[]; anchor?: TileAnchor | null }
type TagRegistryLike = { color(name: string): string }
type LineageLike = { explorerSegments?: () => readonly string[] }

/** One card in the stack. Render order = stack order (later = on top); at most
 *  one ephemeral entry, and it always sits last. */
interface Panel {
  id: number
  ephemeral: boolean
  /** Identity for de-dupe — the tile's label. */
  key: string
  data: PheromoneTileData
  pos: { x: number; y: number }
}

const iocGet = <T,>(key: string): T | undefined =>
  window.ioc?.get?.(key) as T | undefined

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation. The fallback is the English catalog text, and it
// interpolates the same tokens so a bare host with no i18n reads identically.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  if (value && value !== key) return value
  if (!params) return fallback
  return fallback.replace(/\{(\w+)\}/g, (whole, token: string) =>
    token in params ? String(params[token]) : whole)
}

// The card's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(PHEROMONE_TILES_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the card. The SCSS's `$accent: #ffcf6b` is expanded
// to literal rgba(255,207,107,…); `var(--hc-radius-floating)` and
// `var(--hc-mono)` stay as they are. No @keyframes here, so nothing to
// namespace. `user-select` is hand-prefixed — Angular's build autoprefixed it,
// a document-level sheet does not.
//
// The HOST is a full-screen, pointer-events:none pane at z-index 100002 (the
// tool-window layer) whose only job is to hold absolutely-positioned cards.
// It has no paint of its own, so an EMPTY host is invisible and inert — which
// is exactly what the Angular component was between hovers, and why this
// surface needs no `.open` class. The cards themselves are what come and go,
// and they genuinely leave the DOM (`@if`/`@for` semantics, preserved).
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;z-index:100002;pointer-events:none}
${SURFACE_NAME} .pheromone-card{pointer-events:auto;position:absolute;width:240px;max-height:calc(100vh - 2rem);display:flex;flex-direction:column;background:rgba(14,14,22,.96);border:1px solid rgba(255,207,107,.4);border-radius:var(--hc-radius-floating);box-shadow:0 14px 44px rgba(0,0,0,.55),0 0 0 1px rgba(255,207,107,.06) inset;font-family:var(--hc-mono,system-ui);color:#f3f3f3;overflow:hidden}
${SURFACE_NAME} .pheromone-card.pinned{border-color:rgba(255,207,107,.7);box-shadow:0 14px 44px rgba(0,0,0,.6),0 0 0 1px rgba(255,207,107,.18) inset}
${SURFACE_NAME} .pheromone-card-header{display:flex;align-items:center;gap:.4rem;padding:.5rem .65rem;border-bottom:1px solid rgba(255,207,107,.2);cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
${SURFACE_NAME} .pheromone-card-header:active{cursor:grabbing}
${SURFACE_NAME} .pheromone-card-header.static,${SURFACE_NAME} .pheromone-card-header.static:active{cursor:default}
${SURFACE_NAME} .pheromone-grip{color:rgba(255,255,255,.35);font-size:.85rem;line-height:1}
${SURFACE_NAME} .pheromone-card-cell{flex:1;font-size:.78rem;color:rgba(255,255,255,.72);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .pheromone-card-close,${SURFACE_NAME} .pheromone-card-pin{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.5);font-size:1.1rem;line-height:1;cursor:pointer;padding:0 .15rem;transition:color 150ms ease}
${SURFACE_NAME} .pheromone-card-close:hover{color:#ffc8c8}
${SURFACE_NAME} .pheromone-card-pin:hover{color:#ffcf6b}
${SURFACE_NAME} .pheromone-chips{list-style:none;margin:0;padding:.55rem;display:flex;flex-wrap:wrap;gap:.4rem;overflow-y:auto}
${SURFACE_NAME} .pheromone-chip{display:inline-flex;align-items:center;gap:.4rem;padding:.22rem .3rem .22rem .35rem;border-radius:var(--hc-radius-floating);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);font-size:.76rem;line-height:1.2;color:#e8eef5;max-width:100%}
${SURFACE_NAME} .pheromone-chip-swatch{flex:0 0 auto;width:.85rem;height:.85rem;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.45) inset}
${SURFACE_NAME} .pheromone-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .pheromone-chip-x{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:1.05rem;height:1.05rem;border:none;border-radius:50%;background:rgba(0,0,0,.22);color:#b9c8d6;font-size:.9rem;line-height:1;cursor:pointer;opacity:.75;transition:opacity 130ms ease,background 130ms ease,color 130ms ease}
${SURFACE_NAME} .pheromone-chip-x:hover{opacity:1;background:rgba(0,0,0,.34);color:#ffc8c8}
${SURFACE_NAME} .pheromone-card-hint{margin:0;padding:0 .65rem .55rem;font-size:.66rem;color:rgba(255,255,255,.4)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-pheromone-tiles', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class PheromoneTilesElement extends HTMLElement {

  #offs: Array<() => void> = []

  /** The stack. Render order = stack order (later = on top). */
  #panels: Panel[] = []
  /** Card roots by panel id — the sanctioned keyed map. The root carries the
   *  peek's pointerenter/pointerleave, so it must OUTLIVE a data rebuild. */
  #cards = new Map<number, HTMLElement>()

  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekInside = false
  #nextId = 1
  #pinnedAnnounced = false
  #releaseSession: (() => void) | null = null

  // Page-scoped pins: pinned panels for pages OTHER than the visible one are
  // parked here (hidden), keyed by page; `#panels` holds only the current
  // page's pins (+ the peek).
  #parkedByPage = new Map<string, Panel[]>()
  #currentPage = ''
  #lineage: EventTarget | null = null

  // Session parking — the installer covers the hive, so the pins go away and
  // come back. Held apart from `#parkedByPage`: parking is not a navigation,
  // and a park must survive one.
  #sessionParked: Panel[] = []

  #dragId: number | null = null
  #dragOffset = { x: 0, y: 0 }

  /** The hovered tile's screen geometry, from the drone. While it is known the
   *  card anchors to the TILE — one stable spot per hex — never the cursor. */
  #anchor: TileAnchor | null = null
  /** Chip count of the incoming card — feeds the height estimate that keeps
   *  the card vertically centred on the hex. */
  #chipCount = 1
  /** Last pointer position — the fallback anchor when no tile geometry came. */
  #mouse = { x: 24, y: 96 }

  #onMove = (e: PointerEvent): void => { this.#mouse = { x: e.clientX, y: e.clientY } }
  #onNav = (): void => this.#onPageChange()

  /** How this pin stack is put away while the hive is covered, and brought
   *  back. Positions, stacking order and each panel's data all survive. No
   *  `dismiss`/`close`: the pinnable stack registers neither, and that is how
   *  it keeps its own Escape-cascade rung (see core/window-session.ts). */
  readonly windowSession: WindowSession = {
    park: () => {
      if (this.#sessionParked.length) return
      this.#sessionParked = this.#panels.filter(p => !p.ephemeral)
      if (!this.#sessionParked.length) return
      this.#setPanels([])          // drops the transient peek with them
      this.#announce()
    },
    unpark: () => {
      const back = this.#sessionParked
      this.#sessionParked = []
      if (!back.length) return
      this.#setPanels(back)
      this.#announce()
    },
  }

  connectedCallback(): void {
    installCss()

    this.#offs.push(
      // A tile's keywords arrived. A card ALREADY PINNED for this tile is
      // refreshed in place (and the peek stood down); otherwise the peek shows.
      EffectBus.on<HoverPayload>('pheromone:hover-show', (payload) => {
        const m = this.#toPanel(payload); if (!m) return
        const pinned = this.#panels.find(x => !x.ephemeral && x.key === m.key)
        if (pinned) { this.#update(pinned.id, m.data); this.#hidePeek(); return }
        this.#cancelHide(); this.#showPeek(m.key, m.data)
      }),
      // Pin from SOMEWHERE ELSE (a tile icon, a list row). PheromoneTilesDrone
      // never emits it today — the card carries its own ⌖ — but the base wired
      // it for the namespace and dropping it would quietly close a door.
      EffectBus.on<HoverPayload>('pheromone:hover-pin', (payload) => {
        const m = this.#toPanel(payload); if (!m) return
        this.#pin(m.key, m.data)
      }),
      EffectBus.on('pheromone:hover-hide', () => {
        if (this.#peekInside) return
        this.#scheduleHide()
      }),
      // Escape cascade: close the front-most pin, one press at a time.
      EffectBus.on('pheromone:hover-unpin', () => {
        for (let i = this.#panels.length - 1; i >= 0; i--) {
          if (!this.#panels[i].ephemeral) { this.#closePanel(this.#panels[i].id); return }
        }
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved every label through
      // the `t` pipe, declared `pure: false`, so each change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN card on the spot —
      // its aria-label, the ⌖'s title, each ×'s "remove {tag} from this tile",
      // and the peek's hint line. An element renders when it decides to, so
      // the locale switch has to BE a reason to render.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // The cursor fallback: where to put the card when a hover arrived with no
    // tile geometry. Passive — this never blocks a scroll.
    document.addEventListener('pointermove', this.#onMove, { passive: true })

    // Page-scoped pins: track the active page and swap the visible pin set as
    // the participant navigates. Lineage is resolved lazily; when it is absent
    // (bare hosts, specs) the feature degrades to global pins, exactly as the
    // base did.
    this.#currentPage = this.#currentPageKey()
    const lineage = iocGet<EventTarget>(LINEAGE_KEY)
    if (lineage?.addEventListener) {
      this.#lineage = lineage
      lineage.addEventListener('change', this.#onNav)
    }

    // No `#restoreOpen()`: `persistent` is false for this surface — a
    // pheromone session is a session, and nothing is rebuilt from storage.

    this.#render()
  }

  disconnectedCallback(): void {
    // Timers first, then the drag, then everything that was subscribed —
    // every listener removed with the SAME function reference used to add it.
    this.#cancelHide()
    this.#detachDrag()
    this.#dragId = null
    document.removeEventListener('pointermove', this.#onMove)
    this.#lineage?.removeEventListener('change', this.#onNav)
    this.#lineage = null
    this.#releaseSession?.()
    this.#releaseSession = null
    // The base announced the pins down on destroy so the host cascade and the
    // screen agree; a disconnected element shows nothing.
    if (this.#pinnedAnnounced) EffectBus.emit('pheromone:pinned', { active: false })
    this.#pinnedAnnounced = false
    this.#offs.forEach(off => off())
    this.#offs = []
    // Back to the constructed state — a re-connect rebuilds from the effects'
    // last-value replay, which is what a fresh Angular mount did.
    this.#panels = []
    this.#parkedByPage.clear()
    this.#sessionParked = []
    this.#cards.clear()
    this.#peekInside = false
    this.#anchor = null
    this.replaceChildren()
  }

  // ── payload → panel ───────────────────────────────────────────────────

  /** Map the drone's hover payload to a card. Null means "nothing to show":
   *  no label, or a tile carrying no keywords. Captures the tile anchor and
   *  chip count as a side effect — both feed `#anchorPos()`. */
  #toPanel(payload: unknown): { key: string; data: PheromoneTileData } | null {
    const p = payload as HoverPayload | undefined
    if (!p?.label) return null
    const names = Array.isArray(p.pheromones) ? p.pheromones.filter(n => typeof n === 'string' && n) : []
    if (names.length === 0) return null
    if (p.anchor && typeof p.anchor.x === 'number') {
      this.#anchor = p.anchor
      this.#chipCount = names.length
    }
    const segments = Array.isArray(p.segments) ? p.segments.map(String) : []
    return {
      key: p.label,
      data: { label: p.label, segments, chips: names.map(name => ({ name, color: this.#colorOf(name) })) },
    }
  }

  /** Colours come from the TagRegistry, exactly as the Pheromones panel
   *  resolves them, so a keyword reads the same colour on the tile as in the
   *  list. `hc:tag-colors` is the localStorage fallback for hosts with no
   *  registry — read here, never written. */
  #colorOf(name: string): string {
    const registry = iocGet<TagRegistryLike>(TAG_REGISTRY_KEY)
    const c = registry?.color(name)
    if (c) return c
    try {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem(TAG_COLORS_STORAGE) ?? '{}')
      if (stored[name]) return stored[name]
    } catch { /* fall through */ }
    return DEFAULT_CHIP
  }

  // ── geometry ──────────────────────────────────────────────────────────

  /** Beside the hex: to its right, vertically centred — or to its left when
   *  the right side would run off the viewport. Falls back to the cursor only
   *  when the hover carried no tile geometry. (The base allowed a null here,
   *  meaning "use the top-right dock"; this surface always answers, so the
   *  dock and its cascade offset never apply.) */
  #anchorPos(): { x: number; y: number } {
    const a = this.#anchor
    if (!a) return { x: this.#mouse.x + CURSOR_GAP.x, y: this.#mouse.y + CURSOR_GAP.y }
    const rightX = a.x + a.radius + TILE_GAP
    const fitsRight = rightX + PANEL_WIDTH <= window.innerWidth - 8
    const x = fitsRight ? rightX : a.x - a.radius - TILE_GAP - PANEL_WIDTH
    return { x, y: a.y - this.#estimatedHeight() / 2 }
  }

  /** Rough card height from the chip count (~2 chips per row at this width) —
   *  only used to centre on the hex, so rough is fine. */
  #estimatedHeight(): number {
    return 58 + Math.ceil(Math.max(1, this.#chipCount) / 2) * 34
  }

  #clamp(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - PANEL_WIDTH - 8)
    const maxY = Math.max(0, window.innerHeight - 80)
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) }
  }

  // ── the stack ─────────────────────────────────────────────────────────

  #setPanels(next: Panel[]): void {
    this.#panels = next
    this.#render()
  }

  #showPeek(key: string, data: PheromoneTileData): void {
    const a = this.#anchorPos()
    const peek: Panel = { id: PEEK_ID, ephemeral: true, key, data, pos: this.#clamp(a.x, a.y) }
    // ONE assignment, peek last — the id survives, so `#render` reuses the
    // existing root and a pointer already inside it never sees a leave.
    this.#setPanels([...this.#panels.filter(x => x.id !== PEEK_ID), peek])
  }

  #hidePeek(): void {
    this.#peekInside = false
    this.#setPanels(this.#panels.filter(x => x.id !== PEEK_ID))
  }

  #scheduleHide(): void {
    this.#cancelHide()
    this.#hideTimer = setTimeout(() => this.#hidePeek(), HIDE_DELAY_MS)
  }

  #cancelHide(): void {
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = null }
  }

  #pin(key: string, data: PheromoneTileData): void {
    this.#hidePeek()
    const existing = this.#panels.find(x => !x.ephemeral && x.key === key)
    if (existing) { this.#update(existing.id, data); this.#bringToFront(existing.id); return }
    const panel: Panel = { id: this.#nextId++, ephemeral: false, key, data, pos: this.#nextPinPos() }
    this.#setPanels([...this.#panels, panel])
    this.#announce()
  }

  /** Anchored features pin where the participant is LOOKING — the same spot
   *  the peek occupied. (`stickyPositions` is false, so the base's per-key
   *  saved position is never consulted; see the header note on
   *  `hc:pheromone-pins-pos`.) */
  #nextPinPos(): { x: number; y: number } {
    const a = this.#anchorPos()
    return this.#clamp(a.x, a.y)
  }

  #closePanel(id: number): void {
    this.#setPanels(this.#panels.filter(x => x.id !== id))
    this.#announce()
  }

  #update(id: number, data: PheromoneTileData): void {
    this.#setPanels(this.#panels.map(x => x.id === id ? { ...x, data } : x))
  }

  #bringToFront(id: number): void {
    const list = this.#panels
    const i = list.findIndex(x => x.id === id)
    if (i < 0 || i === list.length - 1) return
    const copy = list.slice()
    const [x] = copy.splice(i, 1)
    copy.push(x)
    this.#setPanels(copy)
  }

  /** Tell the host Escape cascade whether any pinned card is up — and join or
   *  leave the window session on the same transition, since "a pin is up" IS
   *  this feature's window being open. */
  #announce(): void {
    const active = this.#panels.some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    if (active) this.#releaseSession = holdWindow('pheromone', this.windowSession)
    else { this.#releaseSession?.(); this.#releaseSession = null }
    EffectBus.emit('pheromone:pinned', { active })
  }

  /** Identity of the current navigation page — the parent segments joined.
   *  Opaque to the stack: only compared for equality. */
  #currentPageKey(): string {
    const lineage = iocGet<LineageLike>(LINEAGE_KEY)
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  /** Navigation changed: park the visible page's pins and bring the new page's
   *  pins (if any) back into view. The transient peek is dropped. Only pins on
   *  the CURRENT page are ever in `#panels`, so parking the whole visible set
   *  under the old page key is correct. */
  #onPageChange(): void {
    const next = this.#currentPageKey()
    if (next === this.#currentPage) return
    const leaving = this.#panels.filter(p => !p.ephemeral)
    if (leaving.length) this.#parkedByPage.set(this.#currentPage, leaving)
    else this.#parkedByPage.delete(this.#currentPage)
    this.#currentPage = next
    const arriving = this.#parkedByPage.get(next) ?? []
    this.#parkedByPage.delete(next)
    this.#setPanels(arriving)
    this.#announce()
  }

  // ── gestures ──────────────────────────────────────────────────────────

  /** Leaving the card is what dismisses it (the drone deliberately does NOT
   *  drop it when the pointer leaves the TILE — see PheromoneTilesDrone). Tell
   *  the drone so it forgets which tile is showing; otherwise its same-label
   *  de-dupe would refuse to re-open this tile's card next hover.
   *
   *  The lookup by id is what keeps this answering exactly ONCE. When the peek
   *  is torn down under the pointer — pinned, or its last chip removed — the
   *  browser may still fire a `pointerleave` at the detached root; the panel is
   *  already gone from state, so nothing is emitted, which is precisely what
   *  Angular's destroyed listener did. */
  #onPeekLeave(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel?.ephemeral) return
    this.#peekInside = false
    this.#scheduleHide()
    EffectBus.emit('pheromone:card-left', {})
  }

  #onPeekEnter(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel?.ephemeral) return
    this.#peekInside = true
    this.#cancelHide()
  }

  #onPanelFocus(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (panel && !panel.ephemeral) this.#bringToFront(id)
  }

  #onHeaderDown(e: PointerEvent, id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel || panel.ephemeral) return          // the peek's header is static
    if (e.button !== 0) return
    e.preventDefault()
    this.#bringToFront(id)
    const current = this.#panels.find(x => x.id === id)
    if (!current) return
    this.#dragId = id
    this.#dragOffset = { x: e.clientX - current.pos.x, y: e.clientY - current.pos.y }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragEnd)
  }

  /** A POSITION STREAM, not a render. The panel's `pos` is updated in state
   *  (so any rebuild that lands mid-drag paints it in the right place) and the
   *  live node's left/top are mutated directly — rebuilding a card per
   *  pointermove would be the regression. */
  #onDragMove = (e: PointerEvent): void => {
    if (this.#dragId === null) return
    const pos = this.#clamp(e.clientX - this.#dragOffset.x, e.clientY - this.#dragOffset.y)
    const panel = this.#panels.find(x => x.id === this.#dragId)
    if (!panel) return
    panel.pos = pos
    const root = this.#cards.get(panel.id)
    if (root) { root.style.left = `${pos.x}px`; root.style.top = `${pos.y}px` }
  }

  /** Nothing to persist: `stickyPositions` is false (a moved pin stays put
   *  while it is up, and hiding it forgets the spot) and `persistent` is
   *  false. All this does is put the drag down. */
  #onDragEnd = (): void => {
    if (this.#dragId === null) return
    this.#dragId = null
    this.#detachDrag()
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragEnd)
  }

  /** Keep this card up. It used to be pinned by an icon on the tile's hover
   *  band, but that band stands down while the Pheromones window is open (it
   *  covered this very card), so the pin lives on the card itself. */
  #pinFromCard(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel) return
    this.#pin(panel.key, panel.data)
  }

  /** Take one keyword off this one tile. Optimistically drops the chip so the
   *  card reacts instantly; the drone's `tags:changed` refresh confirms it (and
   *  hides the card if that was the last keyword). Exactly one
   *  `pheromone:remove-from-tile` per press, in the shape the drone splices on:
   *  { label, name, segments }. */
  #remove(id: number, chip: PheromoneChip): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel) return
    EffectBus.emit('pheromone:remove-from-tile', {
      label: panel.data.label,
      name: chip.name,
      segments: panel.data.segments,
    })
    const remaining = panel.data.chips.filter(c => c.name !== chip.name)
    if (remaining.length === 0) {
      if (panel.ephemeral) this.#hidePeek(); else this.#closePanel(panel.id)
      return
    }
    this.#update(panel.id, { ...panel.data, chips: remaining })
  }

  // ── rendering ─────────────────────────────────────────────────────────

  /** Rebuild every card's CONTENTS from `#panels`, reusing each root, and put
   *  the roots in stack order. `appendChild` MOVES a node that is already a
   *  child, so re-ordering never re-creates one. Departed panels take their
   *  root out of the DOM entirely — `@for` removed the node, and a card left
   *  behind as `display:none` would still answer `querySelector` (and, worse,
   *  still answer `closest('[data-pheromone-tile]')` for a bouquet drop). */
  #render(): void {
    const seen = new Set<number>()
    for (const panel of this.#panels) {
      seen.add(panel.id)
      const root = this.#rootFor(panel)
      this.#paint(root, panel)
      this.appendChild(root)
    }
    for (const [id, root] of [...this.#cards]) {
      if (seen.has(id)) continue
      root.remove()
      this.#cards.delete(id)
    }
  }

  /** The card shell, built ONCE per panel id and kept. Its listeners resolve
   *  the panel by id at event time — the panel OBJECT is replaced on every
   *  data change, so capturing one would go stale. */
  #rootFor(panel: Panel): HTMLElement {
    const cached = this.#cards.get(panel.id)
    if (cached) return cached
    const root = document.createElement('aside')
    const id = panel.id
    root.setAttribute('role', 'dialog')
    root.addEventListener('pointerenter', () => this.#onPeekEnter(id))
    root.addEventListener('pointerleave', () => this.#onPeekLeave(id))
    root.addEventListener('pointerdown', () => this.#onPanelFocus(id))
    this.#cards.set(id, root)
    return root
  }

  #paint(root: HTMLElement, panel: Panel): void {
    root.className = `pheromone-card ${panel.ephemeral ? 'peek' : 'pinned'}`
    root.style.left = `${panel.pos.x}px`
    root.style.top = `${panel.pos.y}px`
    // LOAD-BEARING: the Pheromones panel resolves a bouquet dropped onto a
    // tile's own card with `closest('[data-pheromone-tile]')` (tags-viewer).
    root.setAttribute('data-pheromone-tile', panel.data.label)
    root.setAttribute('aria-label', t('pheromone.card.title', 'Pheromones'))

    const parts: HTMLElement[] = [this.#header(panel), this.#chips(panel)]

    if (panel.ephemeral) {
      const hint = document.createElement('p')
      hint.className = 'pheromone-card-hint'
      hint.textContent = t('pheromone.card.peek.hint', 'Click ⌖ to keep this open.')
      parts.push(hint)
    }

    root.replaceChildren(...parts)
  }

  #header(panel: Panel): HTMLElement {
    const id = panel.id
    const header = document.createElement('header')
    header.className = `pheromone-card-header${panel.ephemeral ? ' static' : ''}`
    header.addEventListener('pointerdown', (e) => this.#onHeaderDown(e, id))

    const parts: HTMLElement[] = []

    if (!panel.ephemeral) {
      const grip = document.createElement('span')
      grip.className = 'pheromone-grip'
      grip.setAttribute('aria-hidden', 'true')
      grip.textContent = '⠿'
      parts.push(grip)
    }

    const cell = document.createElement('span')
    cell.className = 'pheromone-card-cell'
    cell.textContent = panel.data.label
    parts.push(cell)

    const button = document.createElement('button')
    button.type = 'button'
    // The press must not also start a drag or refocus the stack — the same
    // `$event.stopPropagation()` the template put on both buttons.
    button.addEventListener('pointerdown', (e) => e.stopPropagation())
    if (panel.ephemeral) {
      // The peek's only control — it keeps the card up, which is what makes
      // the chips' ×'s reachable now that the tile's hover band stands down.
      const label = t('pheromone.card.pin', 'keep this card open')
      button.className = 'pheromone-card-pin'
      button.setAttribute('aria-label', label)
      button.setAttribute('title', label)
      button.textContent = '⌖'
      button.addEventListener('click', () => this.#pinFromCard(id))
    } else {
      button.className = 'pheromone-card-close'
      button.setAttribute('aria-label', t('pheromone.card.close', 'close'))
      button.textContent = '×'
      button.addEventListener('click', () => this.#closePanel(id))
    }
    parts.push(button)

    header.replaceChildren(...parts)
    return header
  }

  /** Square left, label right — the same pairing the list row and the drag
   *  ghost use, so one pheromone reads identically everywhere it appears. The
   *  COLOUR belongs to the swatch, never the chip fill. */
  #chips(panel: Panel): HTMLElement {
    const id = panel.id
    const list = document.createElement('ul')
    list.className = 'pheromone-chips'

    const rows = panel.data.chips.map(chip => {
      const li = document.createElement('li')
      li.className = 'pheromone-chip'

      const swatch = document.createElement('span')
      swatch.className = 'pheromone-chip-swatch'
      swatch.style.background = chip.color
      swatch.setAttribute('aria-hidden', 'true')

      const name = document.createElement('span')
      name.className = 'pheromone-chip-name'
      name.textContent = chip.name

      const x = document.createElement('button')
      x.type = 'button'
      x.className = 'pheromone-chip-x'
      x.setAttribute('aria-label', t('pheromone.card.remove', 'remove {tag} from this tile', { tag: chip.name }))
      x.setAttribute('title', t('pheromone.card.remove.hint', 'take this pheromone off this tile'))
      x.textContent = '×'
      x.addEventListener('pointerdown', (e) => e.stopPropagation())
      x.addEventListener('click', () => this.#remove(id, chip))

      li.replaceChildren(swatch, name, x)
      return li
    })

    list.replaceChildren(...rows)
    return list
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, PheromoneTilesElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/PheromoneTilesElement',
    element: SURFACE_NAME,
    order: 175,
  })
})
