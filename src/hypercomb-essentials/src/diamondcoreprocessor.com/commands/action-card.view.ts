// action-card.view.ts — THE ACTION STUDY CARD, the contact-card interaction
// applied to behaviors, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and ship
// as signed modules).
//
// A straight port of shared/ui/action-card: same surface name
// (hc-action-card), same order band (180), the same four effects in
// (`action:hover-show` / `-pin` / `-hide` / `-unpin`), the same one effect out
// (`action:pinned`) — the participant sees the same card, delivered as a
// module instead of compiled into the shell. It lands beside its own feeder,
// action-card.drone.ts, which is what publishes those three inbound payloads.
//
// WHAT IT IS FOR. A true MOUSE-OVER card: hover a tile on the help launcher
// page and the panel peeks AT THE CURSOR with what the action does; CLICK the
// tile and the card PINS right there (HelpGroup routes the click to
// ActionCardDrone as `action:request-pin` → `action:hover-pin`). Pin several
// and drag them apart to compare and study. The card is documentation,
// formatted like a reference entry: the action's name, its shortcut as key
// pills, its category, and what it's used for. Nothing else.
//
// THE BASE CAME WITH IT. The Angular component was three lines of subclass
// over `PinnableHoverBase` — an @Directive that cannot cross into module land
// (no Angular imports, ever). So the base's stack is inlined here, in the ONE
// shape this feature actually uses:
//
//   • ns 'action', position store `hc:action-card-pins-pos`, panel width 300
//   • pageScoped: TRUE — pins belong to the launcher page they were pinned on;
//     they hide on navigate-away and re-show on return
//   • persistent: FALSE — a study session is a session, so the base's
//     open-set localStorage half (`#saveOpen`/`#restoreOpen`, both gated on
//     `persistent`) never ran for this subclass and is not ported. Same for
//     the docked cascade in `#nextPinPos`: this subclass always answers
//     `anchorPos()` with the cursor, so the top-right base spot and its
//     CASCADE_STEP fan were unreachable code here.
//   • stickyPositions: TRUE (the base default) — drag a pin and the spot is
//     remembered per key, participant-local.
//
// THE ANCHOR. This card is anchored to the POINTER, not to a tile's position
// on the canvas, so it can never be dragged out from under by a pan or a zoom.
// What CAN go away is the thing being explained, and both exits are wired:
// the peek leaves on `action:hover-hide` (the drone answers every non-help
// `tile:hover` with it, and tile-overlay emits `tile:hover {label:null}` the
// moment the pointer leaves a tile at all, so a deleted or re-rendered tile
// takes its peek with it), and pinned cards are parked by page — navigate
// away, or park the whole hive for the installer, and they go with it. A card
// is never left standing over a page that no longer explains it.
//
// Its strings ship WITH it (action-card.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, holdWindow, I18N_IOC_KEY, type I18nProvider, type WindowSession } from '@hypercomb/core'
import { ACTION_CARD_TRANSLATIONS } from './action-card.i18n.js'

const SURFACE_NAME = 'hc-action-card'

/** EffectBus namespace + Escape-cascade id. The cascade announces on
 *  `action:pinned` and releases on `action:hover-unpin` — keyboard/escape-
 *  cascade.ts, priority 2d. */
const NS = 'action'

/** localStorage key for per-key dragged pin positions (participant-local). */
const POS_KEY = 'hc:action-card-pins-pos'

/** Panel width (px) — the CSS width AND the clamp geometry; they must agree. */
const PANEL_WIDTH = 300

/** How long the peek survives the pointer leaving (unless it lands ON the
 *  card, which cancels the hide — that is what makes the peek reachable). */
const HIDE_DELAY_MS = 260

/** Reserved id for the lone hover peek: at most one is ever up. */
const PEEK_ID = 0

/** Offset from the cursor so the pointer can travel INTO the card without
 *  sitting on its corner (which would fight the canvas hover underneath). */
const CURSOR_GAP = { x: 18, y: 14 }

// One command-line operation as the card renders it.
//
// IMPORTED, NOT REDECLARED, AND NOT RE-EXPORTED. The port copied this
// interface across from the drone, and two identical
// `export interface ActionCardOp` in one directory make the barrel ambiguous
// (TS2308) — the same collision the panel move hit with `GroupMember`.
// Re-exporting it from here would recreate the ambiguity rather than fix it,
// so the name is imported for local use only. The drone is the owner: it
// BUILDS these ops from behaviour metadata and this view only renders them.
// Type-only, so esbuild erases the edge and the drone's value-import of this
// view stays the only real dependency between the two.
import type { ActionCardOp } from './action-card.drone.js'

/** What one card renders — the drone's `ActionCardPayload`, after `#toPanel`
 *  has narrowed every field. Kept structurally identical to the shared
 *  component's `ActionCardData` so the drone needs no change at all. */
export interface ActionCardData {
  label: string
  cmd: string
  kind: 'key' | 'slash' | 'cli' | 'gesture'
  steps: string[][]
  category: string
  description: string
  /** The behavior's detail — what actually happens when you use it. */
  detail?: string
  usage?: string
  params?: string[]
  aliases?: string[]
  examples?: { input: string; result: string }[]
  ops?: ActionCardOp[]
}

/** Render order = stack order (later = on top). At most one ephemeral entry. */
interface Panel {
  id: number
  ephemeral: boolean
  /** Identity for de-dupe + per-panel position persistence. */
  key: string
  data: ActionCardData
  pos: { x: number; y: number }
}

/** The kept nodes for one panel. `data` is the object the children were last
 *  built FROM — an identity check, not a diff: when the drone refreshes a
 *  pinned card it hands over a fresh object, and everything else (a peek
 *  appearing elsewhere, a bring-to-front, a page swap) leaves it untouched, so
 *  the card the participant is reading is not rebuilt underneath them. */
interface PanelNodes {
  root: HTMLElement
  header: HTMLElement
  body: HTMLElement
  data: ActionCardData | null
  ephemeral: boolean
}

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

// Same contract as the shell pipe: the fallback is the English catalog text,
// so a bare host with no i18n reads identically. None of this surface's keys
// pluralize or interpolate — they are all bare labels.
const t = (key: string, fallback: string): string => {
  const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The card's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
// `shortcuts.chord-sep` is shared with the shortcut sheet; registerTranslations
// MERGES into the namespace, so both surfaces may carry it.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(ACTION_CARD_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the card. The SCSS's one variable ($steel, the
// chrome's cold hairline) is expanded to its literal rgb triple everywhere
// `rgba($steel, …)` appeared; `var(--hc-*)` is left alone.
//
// Two things Angular's build did for free and this string must say itself:
// `-webkit-user-select` beside `user-select` on the drag handle (an iPad
// long-press would otherwise select the card's title mid-drag). There are no
// @keyframes here — the card is deliberately cold and still, no motion, no
// glow — so nothing needs tag-scoped renaming.
//
// Z-INDEX 100003 is above the tool-window dock (100002): a study card is
// something you put on top of what you are studying.
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;z-index:100003;pointer-events:none}
${SURFACE_NAME} .action-card-panel{pointer-events:auto;position:absolute;width:${PANEL_WIDTH}px;max-height:calc(100vh - 2rem);display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(14,19,26,.98),rgba(9,13,18,.98));border:1px solid rgba(126,182,214,.45);border-radius:var(--hc-radius-floating);box-shadow:0 18px 54px rgba(0,0,0,.55),0 0 0 1px rgba(126,182,214,.07) inset;font-family:var(--hc-mono,system-ui);color:#f3f3f3;overflow:hidden}
${SURFACE_NAME} .action-card-panel.pinned{border-color:rgba(126,182,214,.7);box-shadow:0 16px 50px rgba(0,0,0,.6),0 0 0 1px rgba(126,182,214,.18) inset}
${SURFACE_NAME} .action-card-header{display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;border-bottom:1px solid rgba(126,182,214,.22);cursor:grab;-webkit-user-select:none;user-select:none;touch-action:none}
${SURFACE_NAME} .action-card-header:active{cursor:grabbing}
${SURFACE_NAME} .action-card-header.static,${SURFACE_NAME} .action-card-header.static:active{cursor:default}
${SURFACE_NAME} .action-drag-grip{color:rgba(255,255,255,.35);font-size:.85rem;line-height:1}
${SURFACE_NAME} .action-card-name{flex:1;font-size:.95rem;font-weight:600;letter-spacing:.01em;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${SURFACE_NAME} .action-category{flex:0 0 auto;font-size:.6rem;text-transform:uppercase;letter-spacing:.08em;padding:.12rem .42rem;border-radius:999px;border:1px solid rgba(126,182,214,.35);color:rgba(126,182,214,.9)}
${SURFACE_NAME} .action-card-close{flex:0 0 auto;background:transparent;border:none;color:rgba(255,255,255,.5);font-size:1.1rem;line-height:1;cursor:pointer;padding:0 .15rem;transition:color 150ms ease}
${SURFACE_NAME} .action-card-close:hover{color:#ffc8c8}
${SURFACE_NAME} .action-card-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:.65rem .8rem .75rem;display:flex;flex-direction:column;gap:.55rem}
${SURFACE_NAME} .action-fact{display:flex;align-items:center;gap:.6rem}
${SURFACE_NAME} .action-fact-label{flex:0 0 auto;font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.42)}
${SURFACE_NAME} .action-combo{display:inline-flex;align-items:center;flex-wrap:wrap;gap:.28rem}
${SURFACE_NAME} .action-key{font-family:inherit;font-size:.76rem;line-height:1;padding:.28rem .46rem;border-radius:var(--hc-radius-floating);background:linear-gradient(180deg,rgba(126,182,214,.16),rgba(126,182,214,.05));border:1px solid rgba(126,182,214,.5);border-bottom-width:2px;color:#eaf5fb}
${SURFACE_NAME} .action-then{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);padding:0 .1rem}
${SURFACE_NAME} .action-description{margin:0;font-size:.84rem;line-height:1.5;color:rgba(255,255,255,.92)}
${SURFACE_NAME} .action-detail{margin:0;padding-top:.55rem;border-top:1px solid rgba(126,182,214,.16);font-size:.78rem;line-height:1.55;color:rgba(255,255,255,.64)}
${SURFACE_NAME} .action-usage{font-family:inherit;font-size:.8rem;padding:.18rem .45rem;border-radius:4px;background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.4);color:#eaf5fb}
${SURFACE_NAME} .action-usage.muted{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:rgba(255,255,255,.6)}
${SURFACE_NAME} .action-param{font-family:inherit;font-size:.72rem;padding:.14rem .4rem;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(126,182,214,.3);color:rgba(126,182,214,.95)}
${SURFACE_NAME} .action-op{display:flex;flex-direction:column;gap:.35rem;padding-top:.55rem;border-top:1px solid rgba(255,255,255,.08)}
${SURFACE_NAME} .action-op:first-child{padding-top:0;border-top:none}
${SURFACE_NAME} .action-op-head{display:flex;align-items:flex-start;gap:.5rem}
${SURFACE_NAME} .action-op-description{flex:1;font-size:.8rem;line-height:1.45;color:rgba(255,255,255,.9)}
${SURFACE_NAME} .action-example{display:flex;align-items:baseline;flex-wrap:wrap;gap:.35rem;font-size:.74rem}
${SURFACE_NAME} .action-example-input{font-family:inherit;padding:.14rem .4rem;border-radius:4px;background:rgba(126,182,214,.1);border:1px solid rgba(126,182,214,.35);color:#eaf5fb}
${SURFACE_NAME} .action-example-arrow{color:rgba(255,255,255,.35)}
${SURFACE_NAME} .action-example-result{color:rgba(255,255,255,.62);line-height:1.4}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-action-card', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class ActionCardElement extends HTMLElement {

  #offs: Array<() => void> = []

  /** Render order = stack order (later = on top). At most one ephemeral. */
  #panels: Panel[] = []

  /** Keyed live panels — the ONE sanctioned exception to rebuild-on-change,
   *  and here it is load-bearing three times over: a panel being DRAGGED must
   *  not be re-created under the pointer, the close button must not be blurred
   *  by an unrelated peek appearing, and a scrolled card body must keep its
   *  scroll. Angular's `@for … track panel.id` gave all three for free. Nodes
   *  are MOVED into stack order with insertBefore (which moves, preserving
   *  listeners), never rebuilt. */
  #nodes = new Map<number, PanelNodes>()

  #nextId = 1
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #peekInside = false
  #savedPos: Record<string, { x: number; y: number }> = {}
  #pinnedAnnounced = false
  #releaseSession: (() => void) | null = null

  /** Page-scoped pins: pinned panels for pages OTHER than the visible one are
   *  parked here (hidden), keyed by page; `#panels` holds only the current
   *  page's pins (+ the peek). */
  #parkedByPage = new Map<string, Panel[]>()
  #currentPage = ''

  /** Session parking — the installer covers the hive, so the pins go away and
   *  come back. Held apart from `#parkedByPage`: parking is not a navigation,
   *  and a park must survive one. */
  #sessionParked: Panel[] = []

  #dragId: number | null = null
  #dragOffset = { x: 0, y: 0 }

  /** Last pointer position — the anchor that makes this a mouse-over card.
   *  The base's docked top-right default never applies to this subclass. */
  #mouse = { x: 24, y: 96 }
  #onMove = (e: PointerEvent): void => { this.#mouse = { x: e.clientX, y: e.clientY } }

  /** How this pin stack is put away while the hive is covered, and brought
   *  back. Positions, stacking order and each panel's data all survive. */
  #windowSession: WindowSession = {
    park: () => {
      if (this.#sessionParked.length) return
      this.#sessionParked = this.#panels.filter(p => !p.ephemeral)
      if (!this.#sessionParked.length) return
      this.#panels = []            // drops the transient peek with them
      this.#announce()
      this.#render()
    },
    unpark: () => {
      const back = this.#sessionParked
      this.#sessionParked = []
      if (!back.length) return
      this.#panels = back
      this.#announce()
      this.#render()
    },
  }

  connectedCallback(): void {
    installCss()
    this.#savedPos = this.#loadPos()

    // The pointer anchor. Registered here and removed in disconnect with the
    // SAME function reference — a fresh closure at teardown silently leaves
    // the listener on document forever.
    document.addEventListener('pointermove', this.#onMove, { passive: true })
    this.#offs.push(() => document.removeEventListener('pointermove', this.#onMove))

    // Last-value replay means a late mount still receives whatever the drone
    // last published — there is no catch-up logic to write here, and this is
    // the same replay the Angular component got when the registry built it.
    this.#offs.push(
      EffectBus.on('action:hover-show', (p) => {
        const m = this.#toPanel(p)
        if (!m) return
        // Already pinned: refresh THAT card in place rather than floating a
        // duplicate peek over it.
        const pinned = this.#panels.find(x => !x.ephemeral && x.key === m.key)
        if (pinned) { this.#update(pinned.id, m.data); this.#hidePeek(); this.#render(); return }
        this.#cancelHide()
        this.#showPeek(m.key, m.data)
      }),

      EffectBus.on('action:hover-pin', (p) => {
        const m = this.#toPanel(p)
        if (!m) return
        this.#pin(m.key, m.data)
      }),

      EffectBus.on('action:hover-hide', () => {
        // The pointer is ON the card: it travelled INTO the peek, which is the
        // whole point of CURSOR_GAP. Leaving the card schedules its own hide.
        if (this.#peekInside) return
        this.#scheduleHide()
      }),

      // The Escape cascade's release (priority 2d) — front-most pin only, one
      // per press, so Escape stays predictable on the way down to the
      // selection clear.
      EffectBus.on('action:hover-unpin', () => {
        for (let i = this.#panels.length - 1; i >= 0; i--) {
          if (!this.#panels[i].ephemeral) { this.#closePanel(this.#panels[i].id); return }
        }
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved its labels through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN card on the spot —
      // including "Shortcut"/"Gesture"/"Type"/"Options"/"Aliases", the chord
      // separator between key pills, and the dialog + close aria-labels, which
      // are all a screen reader has here. An element renders when it decides
      // to, so the locale switch has to be a reason to render — and a reason
      // to REBUILD, since the per-panel identity check would otherwise decide
      // nothing had changed.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    // Page-scoped pins: track the active page and swap the visible pin set as
    // the participant navigates. Lineage is resolved lazily; when it is absent
    // (a bare host, a test) the feature degrades to global pins, exactly as
    // the shared base did.
    this.#currentPage = this.#currentPageKey()
    const lineage = ioc<EventTarget>('@hypercomb.social/Lineage')
    if (lineage?.addEventListener) {
      const onNav = (): void => this.#onPageChange()
      lineage.addEventListener('change', onNav)
      this.#offs.push(() => lineage.removeEventListener('change', onNav))
    }

    this.#render()
  }

  disconnectedCallback(): void {
    this.#cancelHide()
    this.#detachDrag()
    this.#dragId = null
    this.#releaseSession?.()
    this.#releaseSession = null
    // EVERY EXIT ANSWERS ONCE. `action:pinned` is a latched announce: the
    // cascade is told `true` on the transition into "a pin is up" and `false`
    // on the way out — never twice, never not at all. Going away with a pin up
    // IS the way out, so the shell's Escape cascade must not be left thinking
    // this surface still owns priority 2d.
    if (this.#pinnedAnnounced) EffectBus.emit(`${NS}:pinned`, { active: false })
    this.#pinnedAnnounced = false
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#panels = []
    this.#sessionParked = []
    this.#parkedByPage.clear()
    this.#nodes.clear()
    this.replaceChildren()
  }

  // ── payload → panel ───────────────────────────────────────────────────
  // A byte-for-byte port of the component's `toPanel`: every field narrowed,
  // every optional collapsed to `undefined` when empty, so a foreign emitter
  // cannot paint half a card. The `key` is the command — that is what makes a
  // second hover REFRESH a pin instead of stacking a duplicate.
  #toPanel(payload: unknown): { key: string; data: ActionCardData } | null {
    const p = payload as Partial<ActionCardData> | undefined
    if (!p?.cmd || !p.label) return null
    return {
      key: p.cmd,
      data: {
        label: p.label,
        cmd: p.cmd,
        kind: p.kind === 'slash' || p.kind === 'cli' || p.kind === 'gesture' ? p.kind : 'key',
        steps: Array.isArray(p.steps) ? p.steps.map(s => (Array.isArray(s) ? s.map(String) : [])) : [],
        category: typeof p.category === 'string' ? p.category : '',
        description: typeof p.description === 'string' ? p.description : '',
        detail: typeof p.detail === 'string' && p.detail ? p.detail : undefined,
        usage: typeof p.usage === 'string' && p.usage ? p.usage : undefined,
        params: Array.isArray(p.params) && p.params.length ? p.params.map(String) : undefined,
        aliases: Array.isArray(p.aliases) && p.aliases.length ? p.aliases.map(String) : undefined,
        examples: Array.isArray(p.examples) && p.examples.length
          ? p.examples
              .filter(e => e && typeof e.input === 'string' && typeof e.result === 'string')
              .map(e => ({ input: e.input, result: e.result }))
          : undefined,
        ops: Array.isArray(p.ops) && p.ops.length
          ? p.ops.map(o => ({
              trigger: String(o?.trigger ?? ''),
              description: String(o?.description ?? ''),
              example: o?.example && typeof o.example.input === 'string' && typeof o.example.result === 'string'
                ? { input: o.example.input, result: o.example.result }
                : undefined,
            }))
          : undefined,
      },
    }
  }

  // ── peek (transient hover) ────────────────────────────────────────────
  #showPeek(key: string, data: ActionCardData): void {
    const a = this.#anchorPos()
    const peek: Panel = { id: PEEK_ID, ephemeral: true, key, data, pos: this.#clamp(a.x, a.y) }
    this.#panels = [...this.#panels.filter(x => x.id !== PEEK_ID), peek]
    this.#render()
  }

  #hidePeek(): void {
    this.#peekInside = false
    this.#panels = this.#panels.filter(x => x.id !== PEEK_ID)
  }

  #scheduleHide(): void {
    this.#cancelHide()
    this.#hideTimer = setTimeout(() => { this.#hidePeek(); this.#render() }, HIDE_DELAY_MS)
  }

  #cancelHide(): void {
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = null }
  }

  // ── pin / stack ───────────────────────────────────────────────────────
  #pin(key: string, data: ActionCardData): void {
    this.#hidePeek()
    const existing = this.#panels.find(x => !x.ephemeral && x.key === key)
    if (existing) { this.#update(existing.id, data); this.#bringToFront(existing.id); this.#render(); return }
    const panel: Panel = { id: this.#nextId++, ephemeral: false, key, data, pos: this.#nextPinPos(key) }
    this.#panels = [...this.#panels, panel]
    this.#announce()
    this.#render()
  }

  #closePanel(id: number): void {
    this.#panels = this.#panels.filter(x => x.id !== id)
    this.#announce()
    this.#render()
  }

  #bringToFront(id: number): void {
    const i = this.#panels.findIndex(x => x.id === id)
    if (i < 0 || i === this.#panels.length - 1) return
    const copy = this.#panels.slice()
    const [x] = copy.splice(i, 1)
    copy.push(x)
    this.#panels = copy
  }

  /** Replace a panel's data. A FRESH object every time, which is exactly what
   *  the per-panel identity check keys off — this is the one thing that makes
   *  a card rebuild its children. */
  #update(id: number, data: ActionCardData): void {
    this.#panels = this.#panels.map(x => (x.id === id ? { ...x, data } : x))
  }

  /** Tell the host Escape cascade whether any pinned panel is up — and join or
   *  leave the window session on the same transition, since "a pin is up" IS
   *  this feature's window being open. Latched: the emit only ever happens on
   *  a genuine change of state. */
  #announce(): void {
    const active = this.#panels.some(x => !x.ephemeral)
    if (active === this.#pinnedAnnounced) return
    this.#pinnedAnnounced = active
    if (active) this.#releaseSession = holdWindow(NS, this.#windowSession)
    else { this.#releaseSession?.(); this.#releaseSession = null }
    EffectBus.emit(`${NS}:pinned`, { active })
  }

  // ── pages ─────────────────────────────────────────────────────────────
  /** Identity of the current navigation page — the launcher page's explorer
   *  segments joined. Opaque: only ever compared for equality. */
  #currentPageKey(): string {
    const lineage = ioc<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  /** Navigation changed: park the visible page's pins and bring the new page's
   *  pins (if any) back into view. The transient peek is dropped with them —
   *  a card explaining a tile on a page you have left is a card over nothing.
   *  Only pins on the CURRENT page are ever in `#panels`, so parking the whole
   *  visible set under the old page key is correct. */
  #onPageChange(): void {
    const next = this.#currentPageKey()
    if (next === this.#currentPage) return
    const leaving = this.#panels.filter(p => !p.ephemeral)
    if (leaving.length) this.#parkedByPage.set(this.#currentPage, leaving)
    else this.#parkedByPage.delete(this.#currentPage)
    this.#currentPage = next
    const arriving = this.#parkedByPage.get(next) ?? []
    this.#parkedByPage.delete(next)
    this.#panels = arriving
    this.#announce()
    this.#render()
  }

  // ── drag (pinned panels only) ─────────────────────────────────────────
  #startDrag(e: PointerEvent, id: number): void {
    if (e.button !== 0) return
    e.preventDefault()
    this.#bringToFront(id)
    const panel = this.#panels.find(x => x.id === id)
    if (!panel) return
    this.#dragId = id
    this.#dragOffset = { x: e.clientX - panel.pos.x, y: e.clientY - panel.pos.y }
    document.addEventListener('pointermove', this.#onDragMove)
    document.addEventListener('pointerup', this.#onDragEnd)
    this.#render()
  }

  /** A POSITION STREAM, and the one place a full render would be the bug:
   *  the card being dragged is under the pointer, so it is mutated in place —
   *  new left/top on the SAME node, no rebuild, no re-insert. Rebuilding the
   *  card sixty times a second would drop its listeners and its scroll and
   *  fight the pointer. Mutating an existing node's position is not a
   *  reconciler; it is the correct thing to do. */
  #onDragMove = (e: PointerEvent): void => {
    if (this.#dragId === null) return
    const panel = this.#panels.find(x => x.id === this.#dragId)
    if (!panel) return
    panel.pos = this.#clamp(e.clientX - this.#dragOffset.x, e.clientY - this.#dragOffset.y)
    const rec = this.#nodes.get(panel.id)
    if (!rec) return
    rec.root.style.left = `${panel.pos.x}px`
    rec.root.style.top = `${panel.pos.y}px`
  }

  #onDragEnd = (): void => {
    if (this.#dragId === null) return
    const panel = this.#panels.find(x => x.id === this.#dragId)
    // stickyPositions is on for this feature: move a pin and the spot is
    // remembered per command, so re-pinning the same action lands where the
    // participant put it last.
    if (panel) { this.#savedPos[panel.key] = panel.pos; this.#savePos() }
    this.#dragId = null
    this.#detachDrag()
  }

  #detachDrag(): void {
    document.removeEventListener('pointermove', this.#onDragMove)
    document.removeEventListener('pointerup', this.#onDragEnd)
  }

  // ── positions ─────────────────────────────────────────────────────────
  /** New peeks and fresh pins land beside the cursor, not at a dock. */
  #anchorPos(): { x: number; y: number } {
    return { x: this.#mouse.x + CURSOR_GAP.x, y: this.#mouse.y + CURSOR_GAP.y }
  }

  #clamp(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - PANEL_WIDTH - 8)
    const maxY = Math.max(0, window.innerHeight - 80)
    return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) }
  }

  #nextPinPos(key: string): { x: number; y: number } {
    const saved = this.#savedPos[key]
    if (saved) return this.#clamp(saved.x, saved.y)
    const a = this.#anchorPos()
    return this.#clamp(a.x, a.y)
  }

  #loadPos(): Record<string, { x: number; y: number }> {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw) {
        const o = JSON.parse(raw)
        if (o && typeof o === 'object') return o as Record<string, { x: number; y: number }>
      }
    } catch { /* ignore */ }
    return {}
  }

  #savePos(): void {
    try { localStorage.setItem(POS_KEY, JSON.stringify(this.#savedPos)) } catch { /* ignore */ }
  }

  // ── rendering ─────────────────────────────────────────────────────────
  /** Locale switched: every label on every card has to be re-resolved, and the
   *  identity check would say "same data, nothing to do". Clearing the built-
   *  from marker is the re-render trigger. */
  #relabel(): void {
    for (const rec of this.#nodes.values()) rec.data = null
    this.#render()
  }

  #render(): void {
    // Departed panels take their nodes with them — Angular's `@for` removed
    // them from the DOM outright, and absence (not `display:none`) is what a
    // querySelector-based driver reads.
    const live = new Set(this.#panels.map(p => p.id))
    for (const [id, rec] of this.#nodes) {
      if (live.has(id)) continue
      rec.root.remove()
      this.#nodes.delete(id)
    }

    this.#panels.forEach((panel, index) => {
      let rec = this.#nodes.get(panel.id)
      if (!rec) { rec = this.#createPanel(panel.id); this.#nodes.set(panel.id, rec) }

      // Position is always a straight mutation of the existing node.
      rec.root.style.left = `${panel.pos.x}px`
      rec.root.style.top = `${panel.pos.y}px`

      // Children are rebuilt only when the card's DATA changed (or the locale
      // did) — never because some other panel appeared or the stack reordered.
      if (rec.data !== panel.data || rec.ephemeral !== panel.ephemeral) this.#fill(rec, panel)

      // DOM order IS stack order (all panels are absolutely positioned with no
      // z-index between them, so later = on top). insertBefore MOVES the live
      // node when it is out of place, and does nothing when it is not — which
      // matters, because re-inserting a node resets the scroll of the card body
      // inside it.
      const at = this.children[index]
      if (at !== rec.root) this.insertBefore(rec.root, at ?? null)
    })
  }

  /** The chrome of one card, built once and kept: the frame that carries the
   *  position, the drag, the focus-raise and the peek's enter/leave. */
  #createPanel(id: number): PanelNodes {
    const root = document.createElement('aside')
    root.className = 'action-card-panel'
    root.setAttribute('role', 'dialog')
    // Pointer INTO the peek cancels its hide; pointer out schedules it again.
    // Pins ignore both — they are not on a timer.
    root.addEventListener('pointerenter', () => {
      if (!this.#isEphemeral(id)) return
      this.#peekInside = true
      this.#cancelHide()
    })
    root.addEventListener('pointerleave', () => {
      if (!this.#isEphemeral(id)) return
      this.#peekInside = false
      this.#scheduleHide()
    })
    // Press anywhere on a pin to raise it — the compare gesture: two cards
    // side by side, tap the one you are reading.
    root.addEventListener('pointerdown', () => {
      if (this.#isEphemeral(id)) return
      this.#bringToFront(id)
      this.#render()
    })

    const header = document.createElement('header')
    header.className = 'action-card-header'
    header.addEventListener('pointerdown', (e) => {
      if (this.#isEphemeral(id)) return
      this.#startDrag(e, id)
    })

    const body = document.createElement('div')
    body.className = 'action-card-body'

    root.append(header, body)
    return { root, header, body, data: null, ephemeral: false }
  }

  #isEphemeral(id: number): boolean {
    return this.#panels.find(x => x.id === id)?.ephemeral ?? false
  }

  /** Rebuild one card's contents from its data — the house pattern: state
   *  lives in `#panels`, never in the DOM, so a rebuild is always safe. */
  #fill(rec: PanelNodes, panel: Panel): void {
    const d = panel.data
    const ephemeral = panel.ephemeral
    rec.data = d
    rec.ephemeral = ephemeral

    rec.root.classList.toggle('pinned', !ephemeral)
    rec.root.classList.toggle('peek', ephemeral)
    rec.root.setAttribute('aria-label', t('action.hover.title', 'Action'))
    rec.header.classList.toggle('static', ephemeral)

    // ── header: grip · name · category · close ───────────────────────
    const head: HTMLElement[] = []
    if (!ephemeral) {
      const grip = document.createElement('span')
      grip.className = 'action-drag-grip'
      grip.setAttribute('aria-hidden', 'true')
      grip.textContent = '⠿'
      head.push(grip)
    }

    const name = document.createElement('span')
    name.className = 'action-card-name'
    name.textContent = d.label
    head.push(name)

    if (d.category) {
      const category = document.createElement('span')
      category.className = 'action-category'
      category.textContent = d.category
      head.push(category)
    }

    if (!ephemeral) {
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'action-card-close'
      close.textContent = '×'
      close.setAttribute('aria-label', t('action.hover.close', 'close'))
      close.addEventListener('click', () => this.#closePanel(panel.id))
      // Without this the press would also start a drag on the header beneath
      // and raise the card — closing something you had to grab first.
      close.addEventListener('pointerdown', (e) => e.stopPropagation())
      head.push(close)
    }
    rec.header.replaceChildren(...head)

    // ── body ─────────────────────────────────────────────────────────
    const parts: HTMLElement[] = []

    // keyboard action: its shortcut; tutorial basics: the gesture
    if (d.steps.length) {
      const combo = document.createElement('span')
      combo.className = 'action-combo'
      d.steps.forEach((step, i) => {
        if (i > 0) {
          const then = document.createElement('span')
          then.className = 'action-then'
          then.textContent = t('shortcuts.chord-sep', 'then')
          combo.appendChild(then)
        }
        for (const part of step) {
          const key = document.createElement('kbd')
          key.className = 'action-key'
          key.textContent = part
          combo.appendChild(key)
        }
      })
      parts.push(this.#fact(
        d.kind === 'gesture'
          ? t('action.hover.gesture', 'Gesture')
          : t('action.hover.shortcut', 'Shortcut'),
        combo,
      ))
    }

    // slash behaviour: how it's typed, its options, its aliases
    if (d.usage) {
      const usage = document.createElement('code')
      usage.className = 'action-usage'
      usage.textContent = d.usage
      parts.push(this.#fact(t('action.hover.usage', 'Type'), usage))
    }

    if (d.params?.length) {
      const combo = document.createElement('span')
      combo.className = 'action-combo'
      for (const opt of d.params) {
        const param = document.createElement('code')
        param.className = 'action-param'
        param.textContent = opt
        combo.appendChild(param)
      }
      parts.push(this.#fact(t('action.hover.options', 'Options'), combo))
    }

    if (d.aliases?.length) {
      const combo = document.createElement('span')
      combo.className = 'action-combo'
      for (const alias of d.aliases) {
        const code = document.createElement('code')
        code.className = 'action-usage muted'
        code.textContent = alias
        combo.appendChild(code)
      }
      parts.push(this.#fact(t('action.hover.aliases', 'Aliases'), combo))
    }

    if (d.description) {
      const p = document.createElement('p')
      p.className = 'action-description'
      p.textContent = d.description
      parts.push(p)
    }

    // the behavior's detail — what actually happens when you use it
    if (d.detail) {
      const p = document.createElement('p')
      p.className = 'action-detail'
      p.textContent = d.detail
      parts.push(p)
    }

    // author-supplied worked examples (slash behaviors)
    for (const ex of d.examples ?? []) parts.push(this.#example(ex))

    // command-line behavior: each operation with trigger + example
    for (const op of d.ops ?? []) {
      const wrap = document.createElement('div')
      wrap.className = 'action-op'

      const opHead = document.createElement('div')
      opHead.className = 'action-op-head'
      const description = document.createElement('span')
      description.className = 'action-op-description'
      description.textContent = op.description
      opHead.appendChild(description)
      if (op.trigger) {
        const trigger = document.createElement('kbd')
        trigger.className = 'action-key'
        trigger.textContent = op.trigger
        opHead.appendChild(trigger)
      }
      wrap.appendChild(opHead)

      if (op.example) wrap.appendChild(this.#example(op.example))
      parts.push(wrap)
    }

    rec.body.replaceChildren(...parts)
  }

  /** One labelled row: an uppercase micro-label and its value. */
  #fact(label: string, value: HTMLElement): HTMLElement {
    const fact = document.createElement('div')
    fact.className = 'action-fact'
    const tag = document.createElement('span')
    tag.className = 'action-fact-label'
    tag.textContent = label
    fact.append(tag, value)
    return fact
  }

  /** `input → result`, the worked-example line. */
  #example(ex: { input: string; result: string }): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'action-example'

    const input = document.createElement('code')
    input.className = 'action-example-input'
    input.textContent = ex.input

    const arrow = document.createElement('span')
    arrow.className = 'action-example-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    arrow.textContent = '→'

    const result = document.createElement('span')
    result.className = 'action-example-result'
    result.textContent = ex.result

    wrap.append(input, arrow, result)
    return wrap
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
  customElements.define(SURFACE_NAME, ActionCardElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ActionCardElement',
    element: SURFACE_NAME,
    order: 180,
  })
})
