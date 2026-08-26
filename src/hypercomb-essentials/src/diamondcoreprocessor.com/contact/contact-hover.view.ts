// contact-hover.view.ts — THE CONTACT DETAILS CARD, as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and ship as signed modules).
//
// A straight port of shared/ui/contact-card/contact-hover: same surface name
// (hc-contact-hover), same order band (170), the same four effects in
// (`contact:hover-show`, `contact:hover-pin`, `contact:hover-hide`,
// `contact:hover-unpin`) and the same two out (`contact:pinned`,
// `contact:remove`). It ships beside contact.drone.ts and contact-form.view.ts
// — one folder, one beehavior, TWO surfaces. The form is 160 and this is 170,
// and they must stay two registrations: the order is what stacks this card over
// the form's backdrop, and merging them would change what paints on top.
//
// WHAT IT IS FOR. Hover a contact tile and ContactDrone emits
// `contact:hover-show`, which pops an ephemeral PEEK of that tile's cards.
// Click the tile and the drone emits `contact:hover-pin`, which parks a real
// panel: independently draggable, cascade-offset so several fan out, brought to
// front on touch, and — because contact opts into `persistent` — RE-OPENED at
// its saved position next session. Each card offers "Save to contacts", which
// writes a .vcf so a viewer can take the shared contact into their own address
// book, and an × that detaches that one card from the tile.
//
// THE PIN STACK CAME WITH IT. The Angular component composed
// `PinnableHoverBase` (shared/ui/pinnable) — an @Directive, and `pinnable` is
// still on the Phase 2 "gate first" list, so there is no framework-free
// primitive to lean on yet. The stack THIS surface uses is inlined below, with
// the subclass's overrides folded in as constants rather than overridable
// getters (the pheromone-tiles.view.ts precedent, which inlined the same base):
//
//   ns              'contact'                → the four effect names + the
//                                              `contact:pinned` announce
//   posKey          'hc:contact-pins-pos'    → per-key dragged positions
//   panelWidth      360px                    → clamp + dock geometry
//   stickyPositions true (the base default)  → drag a pin and the spot sticks
//                                              for that tile, across opens
//   persistent      true                     → the open SET survives a refresh
//                                              (`hc:contact-pins-pos:open`)
//   pageScoped      true                     → pins belong to the page they
//                                              were pinned on: park on
//                                              navigate-away, come back on
//                                              return, and the persisted set is
//                                              a { page: snaps } map so a
//                                              refresh restores only the page
//                                              you land on
//   anchorPos       null (the base default)  → the classic top-right dock with
//                                              a 26px cascade, never the cursor
//
// PERSONAL DATA, WRITTEN TO localStorage. `persistent` means the open-pin
// snapshot carries each card's DATA — names, phone numbers, emails — into
// `hc:contact-pins-pos:open` so the panel can be rebuilt next session. That is
// the original's behaviour, carried across deliberately and unchanged; it is
// participant-local, never a layer write and never leaves the browser. Naming
// it here so nobody has to rediscover it.
//
// RENDER STRATEGY. Rebuild-on-change, with the ONE sanctioned exception: each
// panel's <aside> ROOT, its header and its body are kept in `#cards` and
// reused. Three reasons, each load-bearing:
//   • the root IS the hover surface — its `pointerleave` dismisses the peek, so
//     destroying it under the pointer would dismiss the card mid-gesture;
//   • the root carries the DRAG, and a drag is a position stream: it mutates
//     the live node's left/top, never re-renders;
//   • `pointerdown` on a panel brings it to front, which REORDERS the stack
//     while the press that will become a `click` is still in flight. Rebuilding
//     the card there would destroy the button between its pointerdown and its
//     click, and the press would do nothing. Reordering MOVES roots with
//     `insertBefore` (anchor walk, skipping anything already in place), so the
//     button that was pressed is the button that is clicked.
// Card CONTENTS rebuild whenever the panel's data object changes — state lives
// in `#panels`, never in the DOM — behind a focus snapshot/restore keyed on
// `data-focus-key`, because a card holds four links and two buttons and a
// rebuild that forgets would drop the ring onto <body>.
//
// Its strings ship WITH it (contact-hover.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice. Four of its
// keys (`contact.field.phone` / `.email` / `.website` / `.address`) are ALSO
// rendered by hc-contact-form, so both catalogs carry them: a surface must
// carry everything it renders, and `registerTranslations` merges rather than
// replaces.

import { EffectBus, I18N_IOC_KEY, holdWindow, type I18nProvider, type WindowSession } from '@hypercomb/core'
import { CONTACT_HOVER_TRANSLATIONS } from './contact-hover.i18n.js'
import { downloadVCard, type ContactFields } from './vcard.js'

const SURFACE_NAME = 'hc-contact-hover'

/** Reserved id for the lone hover peek — the base's PEEK_ID. */
const PEEK_ID = 0
/** How long the peek lingers after the pointer leaves it. */
const HIDE_DELAY_MS = 260
/** px each fresh pin is offset, so several fan out instead of stacking. */
const CASCADE_STEP = 26
/** Panel width; the clamp and the dock anchor both read it. */
const PANEL_WIDTH = 360
/** The base's `posKey` — per-tile dragged positions. */
const POS_KEY = 'hc:contact-pins-pos'
/** The base's `#openKey()` — which pins are open, with a data snapshot. */
const OPEN_KEY = `${POS_KEY}:open`

const LINEAGE_KEY = '@hypercomb.social/Lineage'

type ContactCard = ContactFields & { decorationSig: string }
type HoverPayload = { label?: string; segments?: string[]; contacts?: ContactCard[] }

/** Per-panel data. The stack keys panels by tile label; the segments (needed to
 *  act on a card) and the contact list travel alongside. */
interface ContactData {
  label: string
  segments: string[]
  contacts: ContactCard[]
}

/** One panel in the stack. Render order = stack order (later = on top); at most
 *  one ephemeral entry. */
interface Panel {
  id: number
  ephemeral: boolean
  /** Identity for de-dupe + per-panel position persistence: the tile label. */
  key: string
  data: ContactData
  pos: { x: number; y: number }
}

/** A persisted open-pin: identity + last-known data + position (position may be
 *  absent in older/corrupt entries — restore falls back to the base spot). */
type OpenSnap = { key: string; data: ContactData; pos?: { x: number; y: number } }

/** The nodes kept alive for one panel id. `data` is the LAST PAINTED data
 *  object; contents repaint only when it changes identity. */
interface CardNodes {
  root: HTMLElement
  header: HTMLElement
  body: HTMLElement
  data: ContactData | null
}

type LineageLike = { explorerSegments?: () => readonly string[] }

const iocGet = <T,>(key: string): T | undefined =>
  window.ioc?.get?.(key) as T | undefined

// Same contract as the shell pipe: the live provider resolves the key, and the
// fallback is the English catalog text so a bare host with no i18n reads
// identically. None of this panel's eight keys take params.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The card's strings travel with it — registered as soon as the i18n service is
// up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(CONTACT_HOVER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the card. `$accent: #a8ffd8` (the mint that matches
// the contact overlay icon's hoverTint) is expanded to literal
// rgba(168,255,216,…); `var(--hc-radius-floating)`, `var(--hc-radius-card)` and
// `var(--hc-mono)` stay as they are, and `.contact-mini`'s hand-written 4px
// radius stays a literal because that is what the SCSS said. No mixins here and
// no @keyframes, so nothing to expand and nothing to namespace. `user-select`
// is hand-prefixed — Angular's build autoprefixed it, a document-level sheet
// does not.
//
// The HOST is a full-screen, pointer-events:none pane at z-index 100003 (just
// under the contact FORM at 100004, so the dialog always wins) whose only job
// is to hold absolutely-positioned panels. It has no paint of its own, so an
// empty host is invisible and inert — which is exactly what the Angular
// component was between hovers, and why this surface needs no `.open` class.
// The panels themselves come and go, and they genuinely leave the DOM
// (`@for` semantics, preserved).
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;z-index:100003;pointer-events:none}
${SURFACE_NAME} .contact-hover-panel{pointer-events:auto;position:absolute;width:360px;max-height:calc(100vh - 2rem);display:flex;flex-direction:column;background:rgba(14,14,22,.96);border:1px solid rgba(168,255,216,.45);border-radius:var(--hc-radius-floating);box-shadow:0 16px 50px rgba(0,0,0,.55),0 0 0 1px rgba(168,255,216,.06) inset;font-family:var(--hc-mono,system-ui);color:#f3f3f3;overflow:hidden}
${SURFACE_NAME} .contact-hover-panel.pinned{border-color:rgba(168,255,216,.7);box-shadow:0 16px 50px rgba(0,0,0,.6),0 0 0 1px rgba(168,255,216,.18) inset}
${SURFACE_NAME} .contact-hover-header{display:flex;align-items:center;gap:.45rem;padding:.6rem .8rem;border-bottom:1px solid rgba(168,255,216,.22);cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
${SURFACE_NAME} .contact-hover-header:active{cursor:grabbing}
${SURFACE_NAME} .contact-hover-header.static,${SURFACE_NAME} .contact-hover-header.static:active{cursor:default}
${SURFACE_NAME} .contact-hover-close{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.5);font-size:1.1rem;line-height:1;cursor:pointer;padding:0 .15rem;margin-left:.1rem;transition:color 150ms ease}
${SURFACE_NAME} .contact-hover-close:hover{color:#ffc8c8}
${SURFACE_NAME} .contact-drag-grip{color:rgba(255,255,255,.35);font-size:.85rem;line-height:1}
${SURFACE_NAME} .contact-hover-title{font-size:.82rem;letter-spacing:.05em;color:rgba(168,255,216,.95)}
${SURFACE_NAME} .contact-hover-cell{flex:1;text-align:right;font-size:.74rem;color:rgba(255,255,255,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .contact-hover-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.5rem;display:flex;flex-direction:column;gap:.5rem}
${SURFACE_NAME} .contact-card{border:1px solid rgba(255,255,255,.08);border-radius:var(--hc-radius-card);padding:.6rem .7rem;background:rgba(255,255,255,.02)}
${SURFACE_NAME} .contact-card-head{display:flex;flex-direction:column;gap:.1rem;margin-bottom:.45rem}
${SURFACE_NAME} .contact-name{font-size:.95rem;font-weight:600;color:#fff}
${SURFACE_NAME} .contact-org{font-size:.74rem;color:rgba(168,255,216,.8)}
${SURFACE_NAME} .contact-lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.3rem}
${SURFACE_NAME} .contact-lines li{display:flex;gap:.5rem;font-size:.78rem;line-height:1.35}
${SURFACE_NAME} .contact-lines a{color:#a8ffd8;text-decoration:none;overflow-wrap:anywhere}
${SURFACE_NAME} .contact-lines a:hover{text-decoration:underline}
${SURFACE_NAME} .contact-key{flex:0 0 4.2rem;text-transform:uppercase;letter-spacing:.04em;font-size:.62rem;color:rgba(255,255,255,.4);padding-top:.12rem}
${SURFACE_NAME} .contact-val{color:rgba(255,255,255,.85);overflow-wrap:anywhere}
${SURFACE_NAME} .contact-note .contact-val{font-style:italic;color:rgba(255,255,255,.65)}
${SURFACE_NAME} .contact-card-actions{display:flex;align-items:center;gap:.4rem;margin-top:.55rem}
${SURFACE_NAME} .contact-mini{font-family:inherit;font-size:.72rem;cursor:pointer;border-radius:4px;transition:background 150ms ease,color 150ms ease,border-color 150ms ease}
${SURFACE_NAME} .contact-mini.primary{flex:1;padding:.32rem .5rem;background:rgba(168,255,216,.14);border:1px solid rgba(168,255,216,.5);color:#a8ffd8}
${SURFACE_NAME} .contact-mini.primary:hover{background:rgba(168,255,216,.26);color:#fff;border-color:#a8ffd8}
${SURFACE_NAME} .contact-mini.ghost{background:transparent;border:none;color:rgba(255,255,255,.4);font-size:1.05rem;line-height:1;padding:0 .3rem}
${SURFACE_NAME} .contact-mini.ghost:hover{color:#ffc8c8}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-contact-hover', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The component's `websiteHref` — a bare domain gets https:// so the link is
 *  absolute rather than resolving against the hive's own path. */
const websiteHref = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : `https://${url}`

export class ContactHoverElement extends HTMLElement {

  #offs: Array<() => void> = []

  /** The stack. Render order = stack order (later = on top). */
  #panels: Panel[] = []
  /** Panel nodes by id — the sanctioned keyed map (see the header note). */
  #cards = new Map<number, CardNodes>()
  /** Forces a contents repaint on the next render even when the data object is
   *  unchanged. Set only by `locale:changed`. */
  #repaintAll = false

  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekInside = false
  #nextId = 1
  #pinnedAnnounced = false
  #releaseSession: (() => void) | null = null

  /** Dragged positions by tile label — the base's `#savedPos`, persisted under
   *  `hc:contact-pins-pos`. `stickyPositions` is true here, so it is both read
   *  and written. */
  #savedPos: Record<string, { x: number; y: number }> = {}

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

  #onNav = (): void => this.#onPageChange()

  /** How this pin stack is put away while the hive is covered, and brought
   *  back. Positions, stacking order and each panel's data all survive — the
   *  persisted open-set is left untouched, so a refresh while parked still
   *  restores the pins the participant actually put up. No `dismiss`/`close`:
   *  the pinnable stack registers neither, and that is how it keeps its own
   *  Escape-cascade rung (see core/window-session.ts). */
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

    this.#savedPos = this.#loadPos()

    // Subscribed in the base's ngOnInit order — it matters, because
    // EffectBus.on replays the last value at subscribe time and `#restoreOpen`
    // below deliberately runs after (and therefore wins over) any replay.
    this.#offs.push(
      // A tile's cards arrived. A panel ALREADY PINNED for this tile is
      // refreshed in place (and the peek stood down); otherwise the peek shows.
      EffectBus.on<HoverPayload>('contact:hover-show', (payload) => {
        const m = this.#toPanel(payload); if (!m) return
        const pinned = this.#panels.find(x => !x.ephemeral && x.key === m.key)
        if (pinned) { this.#update(pinned.id, m.data); this.#hidePeek(); return }
        this.#cancelHide(); this.#showPeek(m.key, m.data)
      }),
      // Tapping the tile pins the card — ContactDrone#pin.
      EffectBus.on<HoverPayload>('contact:hover-pin', (payload) => {
        const m = this.#toPanel(payload); if (!m) return
        this.#pin(m.key, m.data)
      }),
      EffectBus.on('contact:hover-hide', () => {
        if (this.#peekInside) return
        this.#scheduleHide()
      }),
      // Escape cascade: close the front-most pin, one press at a time.
      EffectBus.on('contact:hover-unpin', () => {
        for (let i = this.#panels.length - 1; i >= 0; i--) {
          if (!this.#panels[i].ephemeral) { this.#closePanel(this.#panels[i].id); return }
        }
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved every label through
      // the `t` pipe, declared `pure: false`, so each change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN card on the spot —
      // its aria-label, the header title, the close ×'s label, the four field
      // captions on every card and both action buttons. An element renders when
      // it decides to, so the locale switch has to BE a reason to repaint —
      // and because a card's contents only repaint when its data object
      // changes, this one asks for the repaint explicitly.
      EffectBus.on('locale:changed', () => { this.#repaintAll = true; this.#render(); this.#repaintAll = false }),
    )

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

    // Re-open pins parked in a previous session — contact is `persistent`.
    this.#restoreOpen()

    this.#render()
  }

  disconnectedCallback(): void {
    // Timers first, then the drag, then everything that was subscribed —
    // every listener removed with the SAME function reference used to add it.
    this.#cancelHide()
    this.#detachDrag()
    this.#dragId = null
    this.#lineage?.removeEventListener('change', this.#onNav)
    this.#lineage = null
    this.#releaseSession?.()
    this.#releaseSession = null
    // The base announced the pins down on destroy so the host cascade and the
    // screen agree; a disconnected element shows nothing.
    if (this.#pinnedAnnounced) EffectBus.emit('contact:pinned', { active: false })
    this.#pinnedAnnounced = false
    this.#offs.forEach(off => off())
    this.#offs = []
    // Back to the constructed state — a re-connect reloads the saved positions,
    // restores the persisted open set and rebuilds from the effects' last-value
    // replay, which is what a fresh Angular mount did.
    this.#panels = []
    this.#parkedByPage.clear()
    this.#sessionParked = []
    this.#cards.clear()
    this.#peekInside = false
    this.replaceChildren()
  }

  // ── payload → panel ───────────────────────────────────────────────────

  /** The subclass's `toPanel()`. Null means "ignore this payload". Note the
   *  original does NOT require a non-empty contact list here — a payload with
   *  no cards still opens an (empty) panel, and the drone is what refuses to
   *  emit for a tile with none. Copied, not tightened. */
  #toPanel(payload: unknown): { key: string; data: ContactData } | null {
    const p = payload as HoverPayload | undefined
    if (!p?.label) return null
    const segments = Array.isArray(p.segments) ? p.segments.map(String) : []
    const contacts = Array.isArray(p.contacts) ? p.contacts : []
    return { key: p.label, data: { label: p.label, segments, contacts } }
  }

  // ── geometry ──────────────────────────────────────────────────────────

  /** The dock: top-right, one panel width in. (`anchorPos()` is null for
   *  contact — the base default — so the card never follows the cursor.) */
  #basePos(): { x: number; y: number } {
    const x = typeof window !== 'undefined' ? Math.max(8, window.innerWidth - PANEL_WIDTH - 24) : 24
    return { x, y: 96 }
  }

  #clamp(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - PANEL_WIDTH - 8)
    const maxY = Math.max(0, window.innerHeight - 80)
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) }
  }

  /** Where a FRESH pin lands: the spot this tile was last dragged to, or the
   *  dock with a cascade offset per pin already up, so several fan out. */
  #nextPinPos(key: string): { x: number; y: number } {
    const saved = this.#savedPos[key]
    if (saved) return this.#clamp(saved.x, saved.y)
    const base = this.#basePos()
    const n = this.#panels.filter(x => !x.ephemeral).length
    return this.#clamp(base.x - n * CASCADE_STEP, base.y + n * CASCADE_STEP)
  }

  // ── peek (transient hover) ────────────────────────────────────────────

  #showPeek(key: string, data: ContactData): void {
    // `anchorPos()` is null, so the peek takes the dock spot unclamped —
    // exactly the base's `a ? clamp(a) : basePos()`.
    const peek: Panel = { id: PEEK_ID, ephemeral: true, key, data, pos: this.#basePos() }
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

  #onPeekEnter(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel?.ephemeral) return
    this.#peekInside = true
    this.#cancelHide()
  }

  #onPeekLeave(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel?.ephemeral) return
    this.#peekInside = false
    this.#scheduleHide()
  }

  // ── pin / stack ───────────────────────────────────────────────────────

  #setPanels(next: Panel[]): void {
    this.#panels = next
    this.#render()
  }

  #pin(key: string, data: ContactData): void {
    this.#hidePeek()
    const existing = this.#panels.find(x => !x.ephemeral && x.key === key)
    if (existing) { this.#update(existing.id, data); this.#bringToFront(existing.id); return }
    const panel: Panel = { id: this.#nextId++, ephemeral: false, key, data, pos: this.#nextPinPos(key) }
    this.#setPanels([...this.#panels, panel])
    this.#announce()
    this.#saveOpen()
  }

  #closePanel(id: number): void {
    this.#setPanels(this.#panels.filter(x => x.id !== id))
    this.#announce()
    this.#saveOpen()
  }

  #update(id: number, data: ContactData): void {
    this.#setPanels(this.#panels.map(x => x.id === id ? { ...x, data } : x))
    this.#saveOpen()
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

  #onPanelFocus(id: number): void {
    const panel = this.#panels.find(x => x.id === id)
    if (panel && !panel.ephemeral) this.#bringToFront(id)
  }

  /** Tell the host Escape cascade whether any pinned panel is up — and join or
   *  leave the window session on the same transition, since "a pin is up" IS
   *  this feature's window being open. The transition guard is what makes this
   *  idempotent: the same state asserted twice announces once. */
  #announce(): void {
    const active = this.#panels.some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    if (active) this.#releaseSession = holdWindow('contact', this.windowSession)
    else { this.#releaseSession?.(); this.#releaseSession = null }
    EffectBus.emit('contact:pinned', { active })
  }

  // ── page scoping ──────────────────────────────────────────────────────

  /** Current explorer location, joined — the page a pinned card belongs to.
   *  Mirrors ContactDrone's `#parentSegments()` so a card pinned while viewing
   *  this location re-appears at exactly the same location. Opaque to the
   *  stack: only compared for equality. */
  #currentPageKey(): string {
    const lineage = iocGet<LineageLike>(LINEAGE_KEY)
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  /** Navigation changed: park the visible page's pins and bring the new page's
   *  pins (if any) back into view. The transient peek is dropped. Only pins on
   *  the CURRENT page are ever in `#panels`, so parking the whole visible set
   *  under the old page key is correct. (The base does NOT re-save here — the
   *  persisted map is rewritten by the next pin/close/update/drag instead.) */
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

  // ── drag (pinned panels only) ─────────────────────────────────────────

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

  /** A POSITION STREAM, not a render. The panel's `pos` is updated in state (so
   *  any rebuild that lands mid-drag paints it in the right place) and the live
   *  node's left/top are mutated directly — rebuilding a panel per pointermove
   *  would be the regression. */
  #onDragMove = (e: PointerEvent): void => {
    if (this.#dragId === null) return
    const pos = this.#clamp(e.clientX - this.#dragOffset.x, e.clientY - this.#dragOffset.y)
    const panel = this.#panels.find(x => x.id === this.#dragId)
    if (!panel) return
    panel.pos = pos
    const nodes = this.#cards.get(panel.id)
    if (nodes) { nodes.root.style.left = `${pos.x}px`; nodes.root.style.top = `${pos.y}px` }
  }

  /** Put the drag down and remember the spot. `stickyPositions` is true for
   *  contact, so the dragged position is saved per TILE and the next open of
   *  that tile's card lands where the participant left it. */
  #onDragEnd = (): void => {
    if (this.#dragId === null) return
    const panel = this.#panels.find(x => x.id === this.#dragId)
    if (panel) {
      this.#savedPos[panel.key] = panel.pos
      this.#savePos()
      this.#saveOpen()
    }
    this.#dragId = null
    this.#detachDrag()
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragEnd)
  }

  // ── the effect out that acts on a card ────────────────────────────────

  /** Detach one card from the tile. Exactly ONE `contact:remove` per press, in
   *  the shape the drone splices on: { decorationSig, segments }. The list is
   *  then updated optimistically; the drone's `contacts:changed` refresh comes
   *  back as another `contact:hover-show`, which SETS the list rather than
   *  appending to it — so the doubled delivery an effect-as-state-assertion is
   *  prone to costs nothing here. */
  #remove(id: number, card: ContactCard): void {
    const panel = this.#panels.find(x => x.id === id)
    if (!panel) return
    EffectBus.emit('contact:remove', { decorationSig: card.decorationSig, segments: panel.data.segments })
    const remaining = panel.data.contacts.filter(x => x.decorationSig !== card.decorationSig)
    if (remaining.length === 0) {
      // Last card gone: drop the peek, or close the pinned panel.
      if (panel.ephemeral) this.#hidePeek(); else this.#closePanel(panel.id)
      return
    }
    this.#update(panel.id, { ...panel.data, contacts: remaining })
  }

  // ── positions + open-pin persistence (participant-local) ──────────────

  #loadPos(): Record<string, { x: number; y: number }> {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw) {
        const o: unknown = JSON.parse(raw)
        if (o && typeof o === 'object') return o as Record<string, { x: number; y: number }>
      }
    } catch { /* ignore */ }
    return {}
  }

  #savePos(): void {
    try { localStorage.setItem(POS_KEY, JSON.stringify(this.#savedPos)) } catch { /* ignore */ }
  }

  /** One open-pin snapshot: identity + last-known data + position. */
  #snapshot(p: Panel): OpenSnap {
    return { key: p.key, data: p.data, pos: p.pos }
  }

  /** Rebuild panels from persisted snapshots (fresh ids, clamped positions). */
  #snapsToPanels(arr: unknown): Panel[] {
    if (!Array.isArray(arr)) return []
    return (arr as unknown[])
      .filter((e): e is OpenSnap => !!e && typeof (e as { key?: unknown }).key === 'string')
      .map((e) => ({
        id: this.#nextId++,
        ephemeral: false,
        key: e.key,
        // Data snapshot is last-known; the next hover refreshes it in place.
        data: e.data,
        pos: this.#clamp(e.pos?.x ?? this.#basePos().x, e.pos?.y ?? this.#basePos().y),
      }))
  }

  /** Record WHICH pins are open, with a snapshot of their data, so they can be
   *  rebuilt on the next mount. Page-scoped, so the store is a
   *  `{ [page]: snapshot[] }` map — every parked page plus the currently-visible
   *  one — and a refresh restores only the page you land on. */
  #saveOpen(): void {
    try {
      const visible = this.#panels.filter(p => !p.ephemeral).map(p => this.#snapshot(p))
      const map: Record<string, OpenSnap[]> = {}
      for (const [page, list] of this.#parkedByPage) {
        if (list.length) map[page] = list.map(p => this.#snapshot(p))
      }
      if (visible.length) map[this.#currentPage] = visible
      else delete map[this.#currentPage]
      if (Object.keys(map).length) localStorage.setItem(OPEN_KEY, JSON.stringify(map))
      else localStorage.removeItem(OPEN_KEY)
    } catch { /* ignore */ }
  }

  /** Show the current page's pins now; park every other page so they re-appear
   *  on return. A legacy FLAT ARRAY from before page-scoping is ignored — pins
   *  re-pin on the next click. */
  #restoreOpen(): void {
    try {
      const raw = localStorage.getItem(OPEN_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      for (const [page, list] of Object.entries(parsed as Record<string, unknown>)) {
        const panels = this.#snapsToPanels(list)
        if (!panels.length) continue
        if (page === this.#currentPage) this.#panels = panels
        else this.#parkedByPage.set(page, panels)
      }
      if (this.#panels.some(p => !p.ephemeral)) this.#announce()
    } catch { /* ignore */ }
  }

  // ── rendering ─────────────────────────────────────────────────────────

  /** Place every panel root in stack order and repaint the ones whose data
   *  changed. Departed panels leave FIRST, so the placement walk never has to
   *  step over a corpse — and therefore never moves a survivor. */
  #render(): void {
    const focusKey = this.#focusSnapshot()

    const alive = new Set(this.#panels.map(p => p.id))
    for (const [id, nodes] of [...this.#cards]) {
      if (alive.has(id)) continue
      nodes.root.remove()
      this.#cards.delete(id)
    }

    // The anchor walk SKIPS a root already sitting where it belongs. That is
    // the whole point: `insertBefore` on an attached node is a remove plus an
    // insert, which drops focus out of the subtree — so only genuinely
    // out-of-place roots are ever touched.
    let anchor: ChildNode | null = this.firstChild
    for (const panel of this.#panels) {
      const nodes = this.#cards.get(panel.id) ?? this.#buildCard(panel)
      nodes.root.className = `contact-hover-panel ${panel.ephemeral ? 'peek' : 'pinned'}`
      nodes.root.style.left = `${panel.pos.x}px`
      nodes.root.style.top = `${panel.pos.y}px`
      if (nodes.data !== panel.data || this.#repaintAll) {
        this.#paint(nodes, panel)
        nodes.data = panel.data
      }
      if (anchor === nodes.root) { anchor = nodes.root.nextSibling; continue }
      this.insertBefore(nodes.root, anchor)
    }

    this.#restoreFocus(focusKey)
  }

  /** The focus key of whatever inside this surface currently holds the ring.
   *  Restoring by a key we STAMP, never by a class — two buttons in one card
   *  share `.contact-mini`, so restoring by class would put the ring on Save
   *  after the participant pressed the ×. */
  #focusSnapshot(): string {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || !this.contains(active)) return ''
    return active.dataset['focusKey'] ?? ''
  }

  #restoreFocus(key: string): void {
    if (!key) return
    // `globalThis.CSS` — a bare `CSS` would resolve to this module's stylesheet
    // string, which is a `const CSS` two hundred lines up.
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(key) : key
    const node = this.querySelector<HTMLElement>(`[data-focus-key="${escaped}"]`)
    if (node && node !== document.activeElement) node.focus()
  }

  /** The panel shell, built ONCE per panel id and kept: the root (which carries
   *  the peek's enter/leave and the stack's focus press) and the header (which
   *  carries the drag). Their listeners resolve the panel by id at event time —
   *  the panel OBJECT is replaced on every data change, so capturing one would
   *  go stale. Built DETACHED; `#render`'s anchor walk places it. */
  #buildCard(panel: Panel): CardNodes {
    const id = panel.id

    const root = document.createElement('aside')
    root.setAttribute('role', 'dialog')
    root.addEventListener('pointerenter', () => this.#onPeekEnter(id))
    root.addEventListener('pointerleave', () => this.#onPeekLeave(id))
    root.addEventListener('pointerdown', () => this.#onPanelFocus(id))

    const header = document.createElement('header')
    header.addEventListener('pointerdown', (e) => this.#onHeaderDown(e, id))

    const body = document.createElement('div')
    body.className = 'contact-hover-body'

    root.append(header, body)

    const nodes: CardNodes = { root, header, body, data: null }
    this.#cards.set(id, nodes)
    return nodes
  }

  /** Repaint one panel's contents from its data. Every string is re-resolved
   *  here, which is what the impure pipe was doing on every tick. */
  #paint(nodes: CardNodes, panel: Panel): void {
    const id = panel.id
    const heading = t('contact.hover.title', 'Contact')
    nodes.root.setAttribute('aria-label', heading)

    // ── header ──
    nodes.header.className = `contact-hover-header${panel.ephemeral ? ' static' : ''}`
    const headerParts: HTMLElement[] = []

    if (!panel.ephemeral) {
      const grip = document.createElement('span')
      grip.className = 'contact-drag-grip'
      grip.setAttribute('aria-hidden', 'true')
      grip.textContent = '⠿'
      headerParts.push(grip)
    }

    const title = document.createElement('span')
    title.className = 'contact-hover-title'
    title.textContent = heading
    headerParts.push(title)

    const cell = document.createElement('span')
    cell.className = 'contact-hover-cell'
    cell.textContent = panel.data.label
    headerParts.push(cell)

    if (!panel.ephemeral) {
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'contact-hover-close'
      close.dataset['focusKey'] = `close:${id}`
      close.setAttribute('aria-label', t('contact.hover.close', 'close'))
      close.textContent = '×'
      // The press must not also start a drag — the template's own
      // `$event.stopPropagation()` on this one button, and only this one.
      close.addEventListener('pointerdown', (e) => e.stopPropagation())
      close.addEventListener('click', () => this.#closePanel(id))
      headerParts.push(close)
    }

    nodes.header.replaceChildren(...headerParts)

    // ── body ──
    nodes.body.replaceChildren(...panel.data.contacts.map(c => this.#cardArticle(id, c)))
  }

  /** One contact card inside a panel. */
  #cardArticle(id: number, c: ContactCard): HTMLElement {
    const article = document.createElement('article')
    article.className = 'contact-card'

    const head = document.createElement('div')
    head.className = 'contact-card-head'

    const name = document.createElement('span')
    name.className = 'contact-name'
    name.textContent = c.name
    head.appendChild(name)

    // `@if (c.title || c.organization)` — truthiness, copied from the template.
    if (c.title || c.organization) {
      const org = document.createElement('span')
      org.className = 'contact-org'
      // The template read `{{ c.title }}@if (c.title && c.organization) { · }{{ c.organization }}`
      // — the middle dot appears only when there is something on both sides.
      const separator = c.title && c.organization ? ' · ' : ''
      org.textContent = `${c.title ?? ''}${separator}${c.organization ?? ''}`
      head.appendChild(org)
    }

    const lines = document.createElement('ul')
    lines.className = 'contact-lines'

    if (c.phone) {
      lines.appendChild(this.#lineLink(
        t('contact.field.phone', 'Phone'), c.phone, `tel:${c.phone}`, false, `phone:${id}:${c.decorationSig}`))
    }
    if (c.email) {
      lines.appendChild(this.#lineLink(
        t('contact.field.email', 'Email'), c.email, `mailto:${c.email}`, false, `email:${id}:${c.decorationSig}`))
    }
    if (c.website) {
      lines.appendChild(this.#lineLink(
        t('contact.field.website', 'Website'), c.website, websiteHref(c.website), true, `website:${id}:${c.decorationSig}`))
    }
    if (c.address) {
      lines.appendChild(this.#lineText(t('contact.field.address', 'Address'), c.address))
    }
    if (c.note) {
      // The note line carries no key label — just the text, in italic.
      const li = document.createElement('li')
      li.className = 'contact-note'
      const val = document.createElement('span')
      val.className = 'contact-val'
      val.textContent = c.note
      li.appendChild(val)
      lines.appendChild(li)
    }

    const actions = document.createElement('div')
    actions.className = 'contact-card-actions'

    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'contact-mini primary'
    save.dataset['focusKey'] = `save:${id}:${c.decorationSig}`
    save.textContent = t('contact.hover.save', 'Save to contacts')
    // Builds the .vcf in the browser and hands it to the download — nothing is
    // uploaded, and the escaping is vcard.ts's, unchanged.
    save.addEventListener('click', () => downloadVCard(c))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'contact-mini ghost'
    remove.dataset['focusKey'] = `remove:${id}:${c.decorationSig}`
    remove.setAttribute('aria-label', t('contact.hover.remove', 'remove contact'))
    remove.textContent = '×'
    remove.addEventListener('click', () => this.#remove(id, c))

    // Neither action stops propagation — the template didn't, so pressing
    // either also brings its panel to the front, exactly as before.
    actions.append(save, remove)

    article.append(head, lines, actions)
    return article
  }

  /** `<li><span class="contact-key">KEY</span><a href=…>value</a></li>` */
  #lineLink(key: string, value: string, href: string, external: boolean, focusKey: string): HTMLLIElement {
    const li = document.createElement('li')

    const label = document.createElement('span')
    label.className = 'contact-key'
    label.textContent = key

    const link = document.createElement('a')
    link.href = href
    link.textContent = value
    link.dataset['focusKey'] = focusKey
    if (external) {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    }

    li.append(label, link)
    return li
  }

  /** `<li><span class="contact-key">KEY</span><span class="contact-val">…</span></li>` */
  #lineText(key: string, value: string): HTMLLIElement {
    const li = document.createElement('li')

    const label = document.createElement('span')
    label.className = 'contact-key'
    label.textContent = key

    const val = document.createElement('span')
    val.className = 'contact-val'
    val.textContent = value

    li.append(label, val)
    return li
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md). This is the SECOND of the
// contact folder's two surfaces — hc-contact-form registers separately at 160.
// Two surfaces, two registrations, two orders: sharing a folder is not a reason
// to share an element, and merging them would change what paints on top.
//
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ContactHoverElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ContactHoverElement',
    element: SURFACE_NAME,
    order: 170,
  })
})
