// presence-banner.view.ts — WHO ELSE IS HERE, as a framework-free custom
// element (everything-is-a-beehavior Phase 2: Angular panels leave the shell
// and arrive as signed modules).
//
// A straight port of shared/ui/presence-banner: same surface name
// (hc-presence-banner), same order band (330), the same six effects in
// (`swarm:presence-changed`, `swarm:label-changed`, `swarm:subscription-
// changed`, `swarm:following-changed`, `mesh:public-changed`, `swarm:filter`)
// and the same ZERO effects out — every gesture goes through an IoC service
// (SwarmDrone, SwarmFilterService), exactly as the component did, and those
// services do the announcing. It now ships from the directory that owns every
// piece of state it renders: swarm.drone.ts and swarm-filter.service.ts are
// both right beside this file.
//
// WHAT IT IS FOR. A quiet, top-centred strip that surfaces who is at the
// current composedSig. One initials badge per participant — you first, then
// each peer — each in a distinct fluorescent hue derived from identity, so the
// set of people present is glanceable at a stroke.
//
//   - YOUR badge is click-to-name: tapping it swaps the badge for an inline
//     field that writes through SwarmDrone.setMyLabel() (persisted to
//     localStorage). Set it once and every future arrival stamps it onto your
//     outgoing layers.
//   - A PEER badge toggles that participant in the canvas filter
//     (SwarmFilterService) — no selection means everyone shows.
//   - The CARET expands the participant panel: one row per peer with two icon
//     toggles, subscribe (data flow + consent handshake) and follow
//     (navigation sync).
//
// The strip stays inert without a SwarmDrone in IoC, so non-swarm shells pay
// zero cost.
//
// PRIVATE MODE GATE. Presence is a public (swarm) concept. In private mode the
// mesh is disabled, so no peer can ever surface — it is only you, and a badge
// for yourself alone is noise. The whole strip stays hidden until mesh-public
// is on, driven by the processor's `mesh:public-changed` broadcast.
//
// LIFECYCLE NOTE. The Angular version wrapped everything in `@if (visible())`,
// so the strip only existed while the swarm had been seen AND mesh-public was
// on. A registry-fed element is mounted ONCE at boot and stays, so visibility
// is a class on the host (`.open`, the sequence-viewer pattern) PLUS a genuine
// detach of the wrapper — a surface that merely `display:none`s still answers
// querySelector, and re-inserting the node is also what restarts the
// badge-strip's fade-in, which `@if` gave for free. The host starts hidden;
// EffectBus last-value replay means a late mount still receives the live
// values, so there is no catch-up logic here.
//
// Its strings ship WITH it (presence-banner.i18n.ts, extracted from all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { PRESENCE_BANNER_TRANSLATIONS } from './presence-banner.i18n.js'

const SURFACE_NAME = 'hc-presence-banner'

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SWARM_FILTER_KEY = '@diamondcoreprocessor.com/SwarmFilterService'

interface PresencePayload {
  sig?: string
  peerCount?: number
  alone?: boolean
  peers?: readonly string[]
  reason?: string
}

/** The slice of SwarmDrone this surface consumes, resolved through IoC at
 *  runtime — a module never reaches for another module's class. */
interface SwarmConsumerApi {
  labelFor: (pubkey: string) => string
  myLabel: () => string
  setMyLabel: (label: string) => void
  subscribedTo: () => string
  following: () => string
  subscribeTo: (pubkey: string | null) => Promise<void>
  follow: (pubkey: string | null) => Promise<void>
}

/** The participant filter (SwarmFilterService), same story. */
interface SwarmFilterApi {
  selected: ReadonlySet<string>
  toggle: (pubkey: string) => void
}

/** One participant chip in the top strip. */
interface Badge {
  /** Stable key — pubkey for peers, 'self' for you. */
  key: string
  /** Two-letter initials (or '+' for an unnamed self badge). */
  initials: string
  /** Fluorescent text colour, hashed from identity. */
  color: string
  /** Matching neon glow for text-shadow. */
  glow: string
  isSelf: boolean
  /** True on the self badge when no label is set yet — renders the
   *  "add name" affordance instead of letters. */
  unnamed: boolean
  /** True when this peer is in the participant-filter selection. */
  selected: boolean
}

/** One row in the expanded participant panel. */
interface Row {
  pubkey: string
  label: string
  subscribed: boolean
  following: boolean
  selected: boolean
}

/** The three nodes a row keeps alive across rebuilds (see `#rowNode`). */
interface RowNodes {
  li: HTMLLIElement
  label: HTMLButtonElement
  subscribe: HTMLButtonElement
  follow: HTMLButtonElement
}

// Same contract as the shell pipe, minus interpolation: not one `presence.`
// key takes a {token} or a count, so there is no fill step and no plural
// branch to mirror. The fallback is the English catalog text, so a bare host
// with no i18n reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The strip's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(PRESENCE_BANNER_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── identity → colour (pure, unchanged from the component) ────────────────

/** First codepoint — astral-safe, so an emoji name never splits mid-surrogate. */
const head = (s: string): string => Array.from(s)[0] ?? ''

/** Two-letter initials from a label. Two+ words → first letter of each of the
 *  first two words; one word → its first two characters. */
const initialsOf = (label: string): string => {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (head(parts[0] ?? '') + head(parts[1] ?? '')).toUpperCase()
  }
  return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
}

/** DJB2 → hue in [0, 360). */
const hueOf = (seed: string): number => {
  let h = 5381
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  }
  return h % 360
}

/** Fluorescent chip colour + glow, hashed from a seed so each identity gets a
 *  stable, distinct neon hue. */
const chip = (seed: string): { color: string; glow: string } => {
  const hue = hueOf(seed)
  return {
    color: `hsl(${hue} 100% 64%)`,
    glow: `0 0 6px hsl(${hue} 100% 58% / 0.7), 0 0 2px hsl(${hue} 100% 74% / 0.85)`,
  }
}

// ── row icons ─────────────────────────────────────────────────────────────
// subscribe = data flow = downstream arrow; follow = nav sync = step forward.
const SVG_NS = 'http://www.w3.org/2000/svg'
const SUBSCRIBE_PATH = 'M12 5v14M5 12l7 7 7-7'
const FOLLOW_PATH = 'M5 12h14M13 6l6 6-6 6'

const icon = (d: string): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  return svg
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — every rule keeps its relative specificity because they all gain
// the same one element, and nothing can leak out of the strip.
//
// Two positions worth keeping the reasoning for:
//   - TOP sits just BELOW the header bar (2.5rem desktop, scaled by the global
//     --hc-header-zoom knob; 3.5rem on touch shells). The header is z-index
//     60000 with a frosted background, so anchoring at top:0 would render the
//     badges underneath it.
//   - Z-INDEX 59990: #pixi-host reparents to <body> at 59989 with a
//     pointer-events:auto canvas inside (pixi-host.worker.ts). Below it the
//     badges and panel rows painted fine but every click landed on the canvas.
//     Sit one step above it, still below all shell chrome (edit-actions 59995,
//     controls/hint bars 59999, header 60000) and one step under the preview
//     banner (59991) — the old 55-under-56 order.
//
// Both @keyframes names are namespaced with the surface prefix because a
// document-level sheet shares ONE global animation namespace. `-webkit-`
// prefixes for backdrop-filter and appearance are written by hand here —
// Angular's build autoprefixed them.
const CSS = `
${SURFACE_NAME}{position:fixed;top:max(calc(2.5rem * var(--hc-header-zoom,1) + 0.4rem),calc(var(--hc-header-anchor) + 0.07rem));left:50%;transform:translateX(-50%);z-index:59990;pointer-events:none;display:none;max-width:70vw}
${SURFACE_NAME}.open{display:block}
@media (pointer:coarse){${SURFACE_NAME}{top:max(calc(3.5rem * var(--hc-header-zoom,1) + 0.4rem),calc(var(--hc-header-anchor) + 1.07rem))}}
${SURFACE_NAME} .presence-wrapper{display:flex;flex-direction:column;align-items:center;pointer-events:none}
${SURFACE_NAME} .badge-strip{display:flex;align-items:center;gap:.3rem;padding:.22rem .4rem;background:color-mix(in srgb,var(--md-surface-c-low,#1a1a1a) 72%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(245,245,245,.08);border-radius:999px;pointer-events:auto;max-width:68vw;overflow-x:auto;scrollbar-width:none;animation:hc-presence-banner-fade-in 360ms ease-out}
${SURFACE_NAME} .badge-strip::-webkit-scrollbar{display:none}
${SURFACE_NAME} .badge{-webkit-appearance:none;appearance:none;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:1.85rem;height:1.85rem;padding:0;background:color-mix(in srgb,var(--md-surface-c-low,#101010) 85%,transparent);border:1px solid rgba(245,245,245,.14);border-radius:50%;font-family:var(--hc-font);font-weight:700;font-size:.68rem;letter-spacing:.03em;line-height:1;cursor:pointer;transition:transform 140ms ease,border-color 140ms ease,filter 140ms ease}
${SURFACE_NAME} .badge:hover{filter:brightness(1.15);transform:translateY(-1px)}
${SURFACE_NAME} .badge.self{box-shadow:0 0 0 1px rgba(255,255,255,.05) inset}
${SURFACE_NAME} .badge.add-name{color:rgba(245,245,245,.5)!important;text-shadow:none!important;border-style:dashed;border-color:rgba(245,245,245,.28)!important;font-weight:400;font-size:.95rem}
${SURFACE_NAME} .badge.selected{background:color-mix(in srgb,currentColor 16%,rgba(0,0,0,.6));box-shadow:0 0 0 1px currentColor inset}
${SURFACE_NAME} .name-input{flex:0 0 auto;width:8.5rem;height:1.85rem;padding:0 .6rem;background:rgba(0,0,0,.35);border:1px solid var(--md-primary,#7eb6d6);border-radius:999px;color:rgba(245,245,245,.95);caret-color:var(--md-primary,#7eb6d6);font-family:var(--hc-font);font-size:.72rem;letter-spacing:.02em;outline:none;pointer-events:auto}
${SURFACE_NAME} .name-input::placeholder{color:rgba(245,245,245,.35)}
${SURFACE_NAME} .strip-caret{-webkit-appearance:none;appearance:none;flex:0 0 auto;padding:0 .15rem 0 0;background:transparent;border:none;color:rgba(245,245,245,.4);font-size:.7rem;cursor:pointer}
${SURFACE_NAME} .strip-caret:hover{color:rgba(245,245,245,.75)}
${SURFACE_NAME} .presence-caption{margin-top:.3rem;color:rgba(245,245,245,.3);font-family:var(--hc-font);font-size:.68rem;font-style:italic;letter-spacing:.02em;pointer-events:none}
${SURFACE_NAME} .participant-panel{margin-top:.4rem;min-width:220px;max-width:60vw;background:color-mix(in srgb,var(--md-surface-c-low,#1a1a1a) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(245,245,245,.1);border-radius:var(--hc-radius-floating);padding:.35rem .25rem;pointer-events:auto;box-shadow:0 6px 20px rgba(0,0,0,.35);animation:hc-presence-banner-panel-fade-in 220ms ease-out}
${SURFACE_NAME} .participant-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
${SURFACE_NAME} .participant-row{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.3rem .55rem;border-radius:var(--hc-radius-control);transition:background 120ms ease}
${SURFACE_NAME} .participant-row:hover{background:rgba(245,245,245,.04)}
${SURFACE_NAME} .participant-row.selected{background:rgba(245,245,245,.07)}
${SURFACE_NAME} .participant-label{-webkit-appearance:none;appearance:none;flex:1;min-width:0;padding:0;background:transparent;border:none;text-align:left;color:rgba(245,245,245,.85);font-family:var(--hc-font);font-size:.78rem;letter-spacing:.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
${SURFACE_NAME} .participant-label:hover{color:rgba(245,245,245,1)}
${SURFACE_NAME} .participant-actions{display:flex;align-items:center;gap:.25rem;flex-shrink:0}
${SURFACE_NAME} .row-toggle{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;justify-content:center;width:1.7em;height:1.7em;padding:0;background:transparent;border:1px solid transparent;border-radius:50%;color:rgba(245,245,245,.45);cursor:pointer;transition:color 150ms ease,background 150ms ease,border-color 150ms ease,box-shadow 150ms ease}
${SURFACE_NAME} .row-toggle:hover{color:rgba(245,245,245,.85);background:rgba(245,245,245,.06)}
${SURFACE_NAME} .row-toggle.active{color:var(--md-on-primary,#0a0a0a);background:var(--md-primary,#7eb6d6);border-color:var(--md-primary,#7eb6d6);box-shadow:0 0 5px rgba(126,182,214,.45)}
${SURFACE_NAME} .row-toggle.active:hover{filter:brightness(1.08)}
${SURFACE_NAME} .row-toggle svg{display:block}
${SURFACE_NAME} .follow-toggle.active{background:#6ec96e;border-color:#6ec96e;box-shadow:0 0 5px rgba(110,201,110,.45)}
@keyframes hc-presence-banner-fade-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
@keyframes hc-presence-banner-panel-fade-in{from{opacity:0;transform:translateY(-4px) scaleY(.95);transform-origin:top}to{opacity:1;transform:translateY(0) scaleY(1)}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-presence-banner', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class PresenceBannerElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (the component's signals, as plain fields) ───────────────────
  // Every one of these is a MIRROR of state that lives in a service; the DOM
  // holds nothing, so throwing nodes away and rebuilding is always safe.

  /** Whether the swarm has connected at any point this session. Until the
   *  first presence event lands the strip stays hidden (no cold-boot flash). */
  #seen = false
  /** True while mesh-public (swarm) mode is on — private mode can never have
   *  peers, so presence is a public-only affordance. */
  #public = false
  /** Pubkeys of the live participants at our location, freshest first. */
  #peers: readonly string[] = []
  /** True when the swarm published a presence event and we are alone. */
  #alone = true
  /** Our own chosen label — seeded from the swarm on mount, updated locally
   *  the instant we rename (setMyLabel persists it). */
  #myLabel = ''
  /** Expanded participant panel state. Toggles on caret click. */
  #expanded = false
  /** Inline name editor state + draft. */
  #editingName = false
  #draftName = ''
  /** Live subscribe + follow targets, mirrored from swarm via EffectBus so
   *  the row indicators update without polling. */
  #subscribedTo = ''
  #following = ''
  /** Participant-filter selection, mirrored from `swarm:filter`
   *  (SwarmFilterService owns the truth; empty = everyone shows). */
  #selected: ReadonlySet<string> = new Set()

  // ── chrome, built once ─────────────────────────────────────────────────
  // These containers are kept rather than rebuilt because BOTH carry an
  // entrance animation: .badge-strip fades in, .participant-panel fades +
  // scales. Rebuilding them on every peer event would re-run those animations
  // on data that merely changed, which Angular's `@if` never did — it created
  // each node once, on the transition into view. Detaching and re-attaching is
  // exactly that transition, so the fades still play when they should.
  #wrapper: HTMLDivElement | null = null
  #strip: HTMLDivElement | null = null
  #caret: HTMLButtonElement | null = null
  #caption: HTMLSpanElement | null = null
  #panel: HTMLDivElement | null = null
  #list: HTMLUListElement | null = null
  #nameInput: HTMLInputElement | null = null

  /** Keyed live rows — the ONE sanctioned exception to rebuild-on-change.
   *  Every gesture here re-renders the surface that carries it: clicking a
   *  peer badge fires `swarm:filter`, clicking subscribe fires
   *  `swarm:subscription-changed`. Rebuilding would therefore blur the button
   *  the participant just pressed, on every press — so the nodes are keyed and
   *  MOVED into data order, never re-created. (Angular's `@for … track` gave
   *  the same guarantee for free.) */
  #badges = new Map<string, HTMLButtonElement>()
  #rows = new Map<string, RowNodes>()

  connectedCallback(): void {
    installCss()
    this.#build()

    // Seed from the live service first — the replayed effects below cover the
    // event-shaped state, but the label / subscribe / follow targets are only
    // readable through the drone.
    const swarm = this.#swarm()
    if (swarm) {
      try { this.#myLabel = swarm.myLabel() ?? '' } catch { /* default empty */ }
      try { this.#subscribedTo = swarm.subscribedTo() ?? '' } catch { /* default empty */ }
      try { this.#following = swarm.following() ?? '' } catch { /* default empty */ }
    }

    // Last-value replay means a late mount still receives the current presence,
    // mesh mode and filter — there is no catch-up to write here.
    this.#offs.push(
      EffectBus.on<PresencePayload>('swarm:presence-changed', (payload) => {
        const peers = Array.isArray(payload?.peers) ? payload.peers : []
        const alone = payload?.alone ?? peers.length === 0
        this.#peers = peers
        this.#alone = alone
        this.#seen = true
        // Last peer left: the caret unmounts with them, so an expanded panel
        // would have no way left to close. Collapse with them.
        if (alone) this.#expanded = false
        this.#render()
      }),

      // A peer's label arrived (or changed) — re-letter the badges and rows.
      // (The component bumped a #labelVersion signal to force the same
      // recompute; a render IS the recompute here.)
      EffectBus.on('swarm:label-changed', () => this.#render()),

      // Subscribe/follow target changes — mirror locally so row state lights
      // up the moment the swarm flips.
      EffectBus.on<{ pubkey?: string }>('swarm:subscription-changed', (p) => {
        this.#subscribedTo = String(p?.pubkey ?? '')
        this.#render()
      }),
      EffectBus.on<{ pubkey?: string }>('swarm:following-changed', (p) => {
        this.#following = String(p?.pubkey ?? '')
        this.#render()
      }),

      // Public/private toggle — presence is public-only, so the strip hides
      // the instant mesh-public goes off (and reappears on).
      EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
        this.#public = !!p?.public
        this.#render()
      }),

      // Participant-filter selection — mirror so badges/rows relight (the
      // service reconciles departures on peers-changed itself).
      EffectBus.on<{ participants?: readonly string[] }>('swarm:filter', (p) => {
        this.#selected = new Set((p?.participants ?? []).map(String))
        this.#render()
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved its strings through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN strip on the spot —
      // including the caret and both row toggles, which are the only labels a
      // screen reader has to work with here. An element renders when it decides
      // to, so the locale switch has to be a reason to render.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // The panel is dismissible from anywhere: a pointer down outside the strip,
    // or Escape, collapses it. The caret alone was the only way out — a small
    // target that is easy to miss on a phone, which is why the panel read as
    // stuck open once shown.
    const onPointerDown = (ev: Event): void => {
      if (!this.#expanded) return
      if (this.contains(ev.target as Node)) return
      this.#expanded = false
      this.#render()
    }
    const onKeydown = (ev: KeyboardEvent): void => {
      if (!this.#expanded || ev.key !== 'Escape') return
      ev.stopPropagation()
      this.#expanded = false
      this.#render()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeydown, true)
    // Removed with the SAME function references they were added with — a
    // fresh closure at teardown silently leaves both listeners on document.
    this.#offs.push(() => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeydown, true)
    })

    // Seed from the live service — the replayed effect covers most mounts, but
    // a fresh mount before any toggle has no last value.
    const filter = this.#filter()
    if (filter) this.#selected = new Set(filter.selected)

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#badges.clear()
    this.#rows.clear()
    this.#wrapper = null
    this.#strip = null
    this.#caret = null
    this.#caption = null
    this.#panel = null
    this.#list = null
    this.#nameInput = null
    this.replaceChildren()
    this.classList.remove('open')
  }

  // ── chrome (built once) ────────────────────────────────────────────────
  #build(): void {
    if (this.#wrapper) return

    const wrapper = document.createElement('div')
    wrapper.className = 'presence-wrapper'

    const strip = document.createElement('div')
    strip.className = 'badge-strip'
    strip.setAttribute('role', 'group')
    // The strip is the wrapper's permanent first child; the caption and the
    // panel come and go around it.
    wrapper.appendChild(strip)

    const caret = document.createElement('button')
    caret.type = 'button'
    caret.className = 'strip-caret'
    caret.addEventListener('click', () => this.#onCaretClick())

    const caption = document.createElement('span')
    caption.className = 'presence-caption'

    const panel = document.createElement('div')
    panel.className = 'participant-panel'
    panel.setAttribute('role', 'dialog')

    const list = document.createElement('ul')
    list.className = 'participant-list'
    panel.appendChild(list)

    // The inline name field. Built once and kept: it holds a draft AND the
    // caret position while you type, and a peer arriving mid-rename must not
    // cost you either. Its listeners are wired here, so they survive every
    // attach/detach.
    const nameInput = document.createElement('input')
    nameInput.className = 'name-input'
    nameInput.type = 'text'
    nameInput.maxLength = 64
    nameInput.autocomplete = 'off'
    nameInput.spellcheck = false
    // A keystroke changes the DRAFT ONLY — no render. The Angular original ran
    // change detection per keystroke but wrote nothing back, because the
    // `[value]` binding was already in sync with the field it came from.
    nameInput.addEventListener('input', () => { this.#draftName = nameInput.value })
    nameInput.addEventListener('keydown', (ev) => this.#onNameKeydown(ev))
    nameInput.addEventListener('blur', () => this.#commitName())

    this.#wrapper = wrapper
    this.#strip = strip
    this.#caret = caret
    this.#caption = caption
    this.#panel = panel
    this.#list = list
    this.#nameInput = nameInput
  }

  // ── rendering ──────────────────────────────────────────────────────────
  #render(): void {
    const wrapper = this.#wrapper
    const strip = this.#strip
    const caret = this.#caret
    const caption = this.#caption
    const panel = this.#panel
    const list = this.#list
    const nameInput = this.#nameInput
    if (!wrapper || !strip || !caret || !caption || !panel || !list || !nameInput) return

    // PRESERVE THE PREDICATE'S POLARITY. The Angular original showed the strip
    // on `#seen() && #public()`; keep that direction rather than negating it,
    // so anything falsy on either side stays hidden instead of falling through
    // a `!hidden` guard into a half-painted strip.
    const visible = this.#seen && this.#public
    if (!visible) {
      // `@if` REMOVED the node. Detach the wrapper for real — a surface that is
      // merely display:none still answers querySelector, and a caller (or an
      // acceptance driver) asserting on absence would read a present strip.
      // Re-attaching later is also what replays the badge strip's fade-in.
      this.classList.remove('open')
      wrapper.remove()
      return
    }

    const alone = this.#alone
    const editing = this.#editingName
    // Captured BEFORE any mutation: the field is focused when it first appears
    // (opening the editor, or the strip coming back into view while a rename
    // was in flight), and never re-focused while it is already up — refocusing
    // mid-typing would re-select and clobber the caret.
    const inputWasConnected = nameInput.isConnected

    // ── the badge strip: you first, then each peer ──
    const stripChildren: Element[] = []
    const liveBadges = new Set<string>()
    for (const badge of this.#badgeData()) {
      liveBadges.add(badge.key)
      if (badge.isSelf && editing) {
        // The inline field takes the self slot, exactly as the template's
        // `@if (b.isSelf && editingName())` did.
        nameInput.placeholder = t('presence.name-placeholder', 'your name')
        nameInput.setAttribute('aria-label', t('presence.set-name', 'set your name'))
        // Written only when it differs — Angular's `[value]` binding wrote on
        // change too, and an identical write can reset the selection.
        if (nameInput.value !== this.#draftName) nameInput.value = this.#draftName
        stripChildren.push(nameInput)
        continue
      }
      stripChildren.push(this.#badgeNode(badge))
    }
    for (const key of [...this.#badges.keys()]) {
      if (!liveBadges.has(key)) this.#badges.delete(key)
    }

    if (!alone) {
      const expandLabel = t('presence.expand', 'show participants')
      caret.textContent = this.#expanded ? '▴' : '▾'
      caret.setAttribute('aria-expanded', String(this.#expanded))
      caret.setAttribute('aria-label', expandLabel)
      caret.title = expandLabel
      stripChildren.push(caret)
    }

    const panelLabel = t('presence.panel-label', 'participants at this location')
    strip.setAttribute('aria-label', panelLabel)
    this.#place(strip, stripChildren)

    // ── the wrapper's tail: the alone caption, the participant panel ──
    const tail: Element[] = [strip]

    if (alone) {
      caption.textContent = t('presence.alone', 'first one here')
      tail.push(caption)
    }

    if (this.#expanded && !alone) {
      panel.setAttribute('aria-label', panelLabel)
      const liveRows = new Set<string>()
      const rowNodes: Element[] = []
      for (const row of this.#rowData()) {
        liveRows.add(row.pubkey)
        rowNodes.push(this.#rowNode(row))
      }
      for (const key of [...this.#rows.keys()]) {
        if (!liveRows.has(key)) this.#rows.delete(key)
      }
      this.#place(list, rowNodes)
      tail.push(panel)
    } else if (this.#rows.size) {
      // Collapsed: the panel's `@if` destroyed its rows, so drop them here too
      // rather than carrying nodes for peers who may be long gone.
      this.#rows.clear()
      list.replaceChildren()
    }

    this.#place(wrapper, tail)

    if (wrapper.parentNode !== this) this.appendChild(wrapper)
    this.classList.add('open')

    if (editing && !inputWasConnected) {
      // The HTML `autofocus` attribute does not fire on dynamically-inserted
      // nodes, so the focus is explicit — deferred by a microtask so it lands
      // after the gesture that opened the editor has finished settling focus.
      queueMicrotask(() => {
        if (!this.#editingName || !nameInput.isConnected) return
        nameInput.focus()
        nameInput.select()
      })
    }
  }

  /** Put `nodes` in order under `parent`, touching only what is out of place.
   *
   *  Not a reconciler and not reusable — it is this panel's half of the keyed
   *  Map above. `appendChild` and `insertBefore` both DETACH before inserting,
   *  and detaching a focused node blurs it, so re-placing a node that is
   *  already where it belongs would undo the very thing the keying exists to
   *  protect. Departed nodes leave FIRST (otherwise every survivor behind one
   *  of them shifts, and shifting is detaching); everything still in position
   *  after that is left completely alone. */
  #place(parent: HTMLElement, nodes: readonly Element[]): void {
    const wanted = new Set<Element>(nodes)
    for (const child of [...parent.children]) {
      if (!wanted.has(child)) child.remove()
    }
    nodes.forEach((node, i) => {
      const at = parent.children.item(i)
      if (at !== node) parent.insertBefore(node, at)
    })
  }

  // ── derived data (the component's computed signals) ────────────────────

  /** The full badge strip — you first, then each peer. */
  #badgeData(): Badge[] {
    const swarm = this.#swarm()
    const out: Badge[] = []

    // Self badge always leads the strip.
    const myLabel = this.#myLabel.trim()
    out.push({
      key: 'self',
      ...chip(myLabel || 'me'),
      initials: myLabel ? initialsOf(myLabel) : '+',
      isSelf: true,
      unnamed: !myLabel,
      selected: false,
    })

    const selected = this.#selected
    for (const pk of this.#peers) {
      const label = (swarm?.labelFor?.(pk) ?? '').trim()
      out.push({
        key: pk,
        // Colour seeds from the stable pubkey, not the label — a peer keeps
        // their hue even before (and across) a rename.
        ...chip(pk),
        initials: label ? initialsOf(label) : pk.slice(0, 2).toUpperCase(),
        isSelf: false,
        unnamed: false,
        selected: selected.has(pk),
      })
    }
    return out
  }

  /** Per-row participant data for the expanded panel. Labels collide-safe:
   *  when two peers share a label, we suffix the pubkey to disambiguate
   *  ("Alice • a1b2"). */
  #rowData(): Row[] {
    const swarm = this.#swarm()
    const subscribedTo = this.#subscribedTo
    const following = this.#following
    const selected = this.#selected
    const raw = this.#peers.map(pk => ({
      pubkey: pk,
      label: (swarm?.labelFor?.(pk) ?? '').trim() || `${pk.slice(0, 6)}…`,
    }))
    const labelCount = new Map<string, number>()
    for (const r of raw) labelCount.set(r.label, (labelCount.get(r.label) ?? 0) + 1)
    return raw.map(r => ({
      pubkey: r.pubkey,
      label: (labelCount.get(r.label) ?? 0) > 1
        ? `${r.label} • ${r.pubkey.slice(0, 4)}`
        : r.label,
      subscribed: r.pubkey === subscribedTo && !!subscribedTo,
      following: r.pubkey === following && !!following,
      selected: selected.has(r.pubkey),
    }))
  }

  // ── keyed nodes (created once per identity, re-dressed every render) ────

  #badgeNode(badge: Badge): HTMLButtonElement {
    let button = this.#badges.get(badge.key)
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      // Both captured at creation: a badge keyed 'self' is always yours, a
      // badge keyed by pubkey is always that peer's.
      const key = badge.key
      const isSelf = badge.isSelf
      button.addEventListener('click', () => {
        if (isSelf) this.#onSelfBadgeClick()
        else this.#onPeerBadgeClick(key)
      })
      this.#badges.set(key, button)
    }

    button.className = 'badge'
      + (badge.isSelf ? ' self' : '')
      + (badge.unnamed ? ' add-name' : '')
      + (badge.selected ? ' selected' : '')
    // Colour and glow ride inline per identity — the fluorescent hue lives on
    // the text, not the chip, so the strip stays cold. (.add-name overrides
    // both with !important, exactly as the SCSS did.)
    button.style.color = badge.color
    button.style.textShadow = badge.glow
    // `[style.border-color]="isSelf || selected ? color : null"` — null REMOVED
    // the inline style and let the sheet's border colour back through.
    if (badge.isSelf || badge.selected) button.style.borderColor = badge.color
    else button.style.removeProperty('border-color')
    // `[attr.aria-pressed]="isSelf ? null : selected"` — the self badge is not
    // a toggle, so it carries no pressed state at all.
    if (badge.isSelf) button.removeAttribute('aria-pressed')
    else button.setAttribute('aria-pressed', String(badge.selected))

    const label = badge.isSelf
      ? t('presence.set-name', 'set your name')
      : t('presence.filter-toggle', "Show only this participant's tiles")
    button.setAttribute('aria-label', label)
    button.title = label
    button.textContent = badge.initials
    return button
  }

  #rowNode(row: Row): HTMLLIElement {
    let nodes = this.#rows.get(row.pubkey)
    if (!nodes) {
      const pubkey = row.pubkey
      const li = document.createElement('li')

      // The row name is the same filter toggle as the badge — button chrome
      // stripped so it still reads as a label.
      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'participant-label'
      label.addEventListener('click', () => this.#onPeerBadgeClick(pubkey))

      const actions = document.createElement('div')
      actions.className = 'participant-actions'

      const subscribe = document.createElement('button')
      subscribe.type = 'button'
      subscribe.appendChild(icon(SUBSCRIBE_PATH))
      subscribe.addEventListener('click', () => this.#onSubscribeToggle(pubkey))

      const follow = document.createElement('button')
      follow.type = 'button'
      follow.appendChild(icon(FOLLOW_PATH))
      follow.addEventListener('click', () => this.#onFollowToggle(pubkey))

      actions.append(subscribe, follow)
      li.append(label, actions)
      nodes = { li, label, subscribe, follow }
      this.#rows.set(pubkey, nodes)
    }

    nodes.li.className = 'participant-row' + (row.selected ? ' selected' : '')

    const filterLabel = t('presence.filter-toggle', "Show only this participant's tiles")
    nodes.label.textContent = row.label
    nodes.label.setAttribute('aria-pressed', String(row.selected))
    nodes.label.title = filterLabel

    const subscribeLabel = t('presence.subscribe', 'subscribe to their hive')
    nodes.subscribe.className = 'row-toggle subscribe-toggle' + (row.subscribed ? ' active' : '')
    nodes.subscribe.setAttribute('aria-pressed', String(row.subscribed))
    nodes.subscribe.setAttribute('aria-label', subscribeLabel)
    nodes.subscribe.title = subscribeLabel

    const followLabel = t('presence.follow', 'follow them as they navigate')
    nodes.follow.className = 'row-toggle follow-toggle' + (row.following ? ' active' : '')
    nodes.follow.setAttribute('aria-pressed', String(row.following))
    nodes.follow.setAttribute('aria-label', followLabel)
    nodes.follow.title = followLabel

    return nodes.li
  }

  // ── gestures ───────────────────────────────────────────────────────────
  // None of these emits an effect. Every one writes through the service that
  // owns the state, and that service announces the change — which is what
  // brings the render back around. One writer, one announcement.

  /** Click a peer badge (or their row name) → toggle that participant in the
   *  canvas filter. No selection = everyone shows. A toggle the service
   *  refuses (a stale badge for an expired peer) announces nothing, so the
   *  strip correctly does not move. */
  #onPeerBadgeClick(pubkey: string): void {
    this.#filter()?.toggle(pubkey)
  }

  /** The caret toggles the expanded participant panel (expansion no longer
   *  rides badge clicks — those select). */
  #onCaretClick(): void {
    if (this.#alone) return
    this.#expanded = !this.#expanded
    this.#render()
  }

  /** Click your own badge → open the inline name editor, seeded with the raw
   *  label so a name with spacing survives a cancel. */
  #onSelfBadgeClick(): void {
    this.#draftName = this.#myLabel
    this.#editingName = true
    this.#render()
  }

  /** Commit the drafted name. Writes through the swarm (which persists to
   *  localStorage) and updates the local mirror so the badge re-letters
   *  immediately. Empty input clears the name.
   *
   *  EXACTLY ONCE. Three paths reach this — Enter, blur, and the blur that
   *  FOLLOWS Enter (or a pointer landing elsewhere) — so the editor flag is
   *  both the guard and the latch: it is cleared before the render that
   *  detaches the field, and every later call early-returns against it. Escape
   *  clears the same flag first, so the blur it causes cannot resurrect a
   *  cancelled rename. */
  #commitName(): void {
    if (!this.#editingName) return
    const next = this.#draftName.trim().slice(0, 64)
    const swarm = this.#swarm()
    try { swarm?.setMyLabel?.(next) } catch { /* best-effort */ }
    this.#myLabel = next
    this.#editingName = false
    this.#render()
  }

  /** Close without saving. Flips the flag first so the blur-triggered commit
   *  early-returns. */
  #cancelName(): void {
    this.#editingName = false
    this.#render()
  }

  /** Keep the editor's keystrokes out of the app's global shortcuts; Enter
   *  commits, Escape cancels. (Note: while the participant panel is OPEN the
   *  document-level capture handler above eats Escape first and collapses the
   *  panel instead — the component behaved identically, and the field's own
   *  Escape is one keypress away once the panel is closed.) */
  #onNameKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation()
    if (ev.key === 'Enter') { ev.preventDefault(); this.#commitName() }
    else if (ev.key === 'Escape') { ev.preventDefault(); this.#cancelName() }
  }

  /** Row action: flip subscribe for this pubkey. Single-target — if already
   *  subscribed to someone else, the swarm switches. Calling with the same
   *  pubkey unsubscribes (toggle semantics). */
  #onSubscribeToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.subscribeTo) return
    const current = swarm.subscribedTo()
    void swarm.subscribeTo(current === pubkey ? null : pubkey)
  }

  /** Row action: flip follow (nav-sync) for this pubkey. */
  #onFollowToggle(pubkey: string): void {
    const swarm = this.#swarm()
    if (!swarm?.follow) return
    const current = swarm.following()
    void swarm.follow(current === pubkey ? null : pubkey)
  }

  // ── IoC lookups (lazy — the strip stays inert without a swarm) ──────────

  #swarm(): SwarmConsumerApi | undefined {
    return window.ioc?.get?.(SWARM_KEY) as SwarmConsumerApi | undefined
  }

  #filter(): SwarmFilterApi | undefined {
    return window.ioc?.get?.(SWARM_FILTER_KEY) as SwarmFilterApi | undefined
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
  customElements.define(SURFACE_NAME, PresenceBannerElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/PresenceBannerElement',
    element: SURFACE_NAME,
    order: 330,
  })
})
