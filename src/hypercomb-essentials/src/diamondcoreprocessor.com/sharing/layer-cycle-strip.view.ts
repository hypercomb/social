// layer-cycle-strip.view.ts — the peer-cycling strip as a framework-free
// custom element (everything-is-a-beehavior Phase 2: Angular panels leave the
// shell and arrive as signed modules).
//
// A straight port of shared/ui/layer-cycle-strip: same surface name
// (hc-layer-cycle-strip), same order band (310), same two effects in
// (`swarm:peers-changed`, `spotlight:changed`) and the same ZERO effects out —
// the strip talks to the SpotlightService through IoC, exactly as the
// component did, and the service does the announcing. It now ships from the
// module that owns both halves of the state it renders: spotlight.service.ts
// (which peer is surfaced) and swarm.drone.ts (who is publishing here) are
// both in this directory.
//
// WHAT IT IS FOR. At a swarm location there may be N peers publishing visuals
// at the same address. The default render composites all of them. This strip
// is the visible roster: one glow dot per peer, in that peer's deterministic
// colour, and tapping one spotlights that peer's layer — tapping the spotlit
// one drops back to the merged render. It is the pointing-device half of the
// same cycle alt+wheel drives (spotlight-scroll.input.ts); both go through
// SpotlightService so the two can never disagree.
//
// The strip carries `[data-consumes-wheel]`, which is load-bearing and not
// decoration: spotlight-scroll bails on any wheel event inside a marked
// subtree, so alt+wheel OVER the strip deliberately does not cycle. Wheeling
// across the roster while reading it must not move the thing being read.
//
// Not a docked panel: it extends HTMLElement directly and its inner container
// positions itself fixed, bottom-centre, exactly as the Angular SCSS did.
//
// WIDGET ZOOM. The template stamped `hcWidget="layer-cycle-strip"` with
// `anchor="bottom"`; that directive's mechanics are now core's
// `attachWidgetZoom()` (hypercomb-core/src/core/panels/widget-zoom.ts). Same
// id, same anchor, same localStorage key — a participant who had already
// scaled this strip keeps their scale across the conversion.
//
// LIFECYCLE NOTE. The Angular version wrapped its markup in `@if (visible())`,
// so the strip only existed while peers were present. A registry-fed element
// is mounted ONCE at boot and stays, so the container is built once and kept,
// and `#render` attaches / detaches it — it genuinely leaves the DOM when
// there is nobody to list, and the host starts hidden. Re-inserting the node
// also restarts the fade-in animation, which is what `@if` gave for free.
//
// Its strings ship WITH it (the Phase 2 catalog split — three keys, all 14
// shell catalogs) and register under the 'app' namespace, so every key
// resolves exactly as before.

import {
  EffectBus,
  I18N_IOC_KEY,
  attachWidgetZoom,
  type I18nProvider,
} from '@hypercomb/core'
import { LAYER_CYCLE_TRANSLATIONS as LAYER_CYCLE_STRIP_TRANSLATIONS } from './layer-cycle-strip.i18n.js'

const SURFACE_NAME = 'hc-layer-cycle-strip'

const SPOTLIGHT_KEY = '@diamondcoreprocessor.com/SpotlightService'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'

/** The widget id + anchor the Angular template passed to `hcWidget`. Both are
 *  participant-visible state (the scale is persisted under this id), so they
 *  must not drift. */
const WIDGET_ID = 'layer-cycle-strip'
const WIDGET_ANCHOR = 'bottom' as const

interface SpotlightServiceLike {
  readonly activePeer: string | null
  participants(): readonly string[]
  set(pubkey: string | null): void
  dismiss(): void
}

interface SwarmDroneLike {
  participantsAtCurrentSig?: () => readonly string[]
}


/** Same contract as the shell pipe, minus interpolation — none of the three
 *  keys takes a param, so there is nothing to fill. The fallback is the
 *  English catalog text, so a bare host with no i18n reads identically. */
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  return value && value !== key ? value : fallback
}

// The strip's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(LAYER_CYCLE_STRIP_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

/** Deterministic per-pubkey color (DJB2 → HSL → RGB). Same algorithm
 *  show-cell uses for label-derived tints, so identity color is
 *  consistent across the canvas, the strip, and any future affordance.
 *  Returns CSS rgb() string.
 *
 *  Ported byte-for-byte from the Angular component — the numbers ARE the
 *  contract. A peer's dot here and that peer's tiles on the canvas must be
 *  the same colour, and the canvas side did not move. */
function pubkeyColor(pubkey: string): string {
  if (!pubkey) return 'rgb(160, 160, 160)'
  let hash = 5381
  for (let i = 0; i < pubkey.length; i++) hash = ((hash << 5) + hash + pubkey.charCodeAt(i)) | 0
  hash = hash >>> 0
  const hue = (hash % 360) / 360
  const sat = 0.65
  const lit = 0.6
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lit - c / 2
  let r = 0, g = 0, b = 0
  const sector = (hue * 6) | 0
  if (sector === 0)      { r = c; g = x; b = 0 }
  else if (sector === 1) { r = x; g = c; b = 0 }
  else if (sector === 2) { r = 0; g = c; b = x }
  else if (sector === 3) { r = 0; g = x; b = c }
  else if (sector === 4) { r = x; g = 0; b = c }
  else                   { r = c; g = 0; b = x }
  const R = Math.round((r + m) * 255)
  const G = Math.round((g + m) * 255)
  const B = Math.round((b + m) * 255)
  return `rgb(${R}, ${G}, ${B})`
}

/** One row of the roster. The Angular `PeerEntry` also carried
 *  `label: pubkey.slice(0, 8)` — computed on every recomputation and never
 *  referenced by the template, which renders the dot alone. Dropped rather
 *  than ported as dead weight; if the label is ever wanted it is one line. */
interface PeerEntry {
  readonly pubkey: string
  readonly color: string
  readonly active: boolean
}

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the strip. The keyframes are renamed with
// the surface prefix because @keyframes names are global in a document-level
// sheet, and `strip-fade-in` is exactly the kind of name a second surface
// would also reach for.
//
// The z-index reasoning from the SCSS, kept verbatim because it is the fix for
// a real bug: 59991 sits above the reparented Pixi canvas (#pixi-host, z 59989,
// pointer-events:auto — pixi-host.worker.ts). Below it the peer entries painted
// but tapping one to cycle to that peer's location hit the canvas instead.
// Still under all shell chrome (edit-actions 59995, controls/hint bars 59999,
// header 60000).
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .layer-cycle-strip{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:59991;display:flex;flex-direction:row;align-items:center;gap:.4rem;padding:.4rem .6rem;background:rgba(14,18,24,.82);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.45);animation:hc-layer-cycle-strip-fade-in 180ms ease-out;user-select:none}
@keyframes hc-layer-cycle-strip-fade-in{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
${SURFACE_NAME} .entry{display:inline-flex;align-items:center;padding:.3rem;background:transparent;border:1px solid transparent;border-radius:50%;cursor:pointer;transition:background 120ms ease,border-color 120ms ease,transform 120ms ease}
${SURFACE_NAME} .entry:hover{background:rgba(255,255,255,.06);transform:scale(1.08)}
${SURFACE_NAME} .entry.active{border-color:rgba(255,255,255,.45)}
${SURFACE_NAME} .entry .dot{display:inline-block;width:.8rem;height:.8rem;border-radius:50%;transition:box-shadow 150ms ease,transform 150ms ease}
${SURFACE_NAME} .entry.active .dot{transform:scale(1.15)}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-layer-cycle-strip', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class LayerCycleStripElement extends HTMLElement {

  #offs: Array<() => void> = []
  #detachZoom: (() => void) | null = null

  /** Who is publishing here, freshness-first — read from the SwarmDrone,
   *  never accumulated locally. */
  #participants: readonly string[] = []
  /** Which of them is spotlit, mirrored from the `spotlight:changed`
   *  payload exactly as the Angular signal was. */
  #activePeer: string | null = null

  /** The fixed-position container. Built ONCE and kept: it is what carries
   *  the widget-zoom stamp (inline `zoom`, the persisted participant scale)
   *  and `[data-consumes-wheel]`, and rebuilding it would drop both on every
   *  peer arrival. Its CHILDREN rebuild on every change — the house pattern:
   *  the state lives in SpotlightService and SwarmDrone, so throwing the rows
   *  away and rebuilding them is always safe. */
  #strip: HTMLDivElement | null = null

  connectedCallback(): void {
    installCss()
    const strip = this.#build()

    // The `hcWidget` directive's job, now core's function. Same id and anchor
    // the template passed, so the persisted scale carries over untouched.
    this.#detachZoom = attachWidgetZoom(strip, WIDGET_ID, WIDGET_ANCHOR)

    // Initial snapshot — covers the case where peers are already present
    // (publishing from another tab, relay echo on join, etc.). This is NOT
    // bus catch-up: it reads the SwarmDrone directly, which is what the
    // component's ngOnInit did before subscribing to anything.
    this.#refresh()

    this.#offs.push(
      // The swarm fires peers-changed on every join / leave / stale / mode
      // toggle. We re-snapshot the participant list and let the spotlight
      // service reconcile on its own (it subscribes to the same effect and
      // dismisses if the active peer evaporated — the dismissal reaches us
      // as a spotlight:changed echo, below).
      EffectBus.on('swarm:peers-changed', () => this.#refresh()),

      // Spotlight changes — the strip re-renders so the active entry
      // highlights correctly. activePeer comes from the event payload, as it
      // did in the component; last-value replay means a late mount picks up
      // an already-set spotlight without any catch-up read here.
      EffectBus.on<{ activePeer: string | null }>('spotlight:changed', (payload) => {
        this.#activePeer = payload?.activePeer ?? null
        this.#render()
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved its aria-label and
      // title through the `t` pipe, declared `pure: false`, so every
      // change-detection tick re-read them and `/language ja` re-labelled an
      // OPEN strip on the spot. An element renders when it decides to, so the
      // locale switch has to be a reason to render — otherwise the roster
      // keeps its old-locale labels until a peer happens to join or leave,
      // and on a strip whose entire text is assistive-technology text that is
      // the difference between usable and not.
      EffectBus.on('locale:changed', () => this.#render()),
    )
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#detachZoom?.()
    this.#detachZoom = null
    this.#strip?.remove()
    this.#strip = null
    this.replaceChildren()
  }

  // ── chrome (built once) ──────────────────────────────────────────────
  #build(): HTMLDivElement {
    const existing = this.#strip
    if (existing) return existing
    const strip = document.createElement('div')
    strip.className = 'layer-cycle-strip'
    // Load-bearing: spotlight-scroll.input.ts bails on any wheel event whose
    // target `.closest('[data-consumes-wheel]')` hits, so alt+wheel over the
    // roster deliberately does NOT cycle it out from under the reader.
    strip.setAttribute('data-consumes-wheel', '')
    // Built DETACHED. `#render` attaches it when there is somebody to list
    // and takes it back out when there is not — so the strip is absent from
    // the DOM at rest, exactly as the Angular `@if` left it, with no
    // transient attach on the way through mount.
    this.#strip = strip
    return strip
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ──
  #render(): void {
    const strip = this.#strip
    if (!strip) return

    const active = this.#activePeer
    const entries: PeerEntry[] = this.#participants.map(pubkey => ({
      pubkey,
      color: pubkeyColor(pubkey),
      active: pubkey === active,
    }))

    // The original predicate, copied not re-derived: `visible = entries().length > 0`
    // and `@if (visible())`. Branching on `!visible` keeps the polarity, so an
    // empty (or otherwise falsy-length) roster stays hidden instead of falling
    // through a negated guard.
    const visible = entries.length > 0
    if (!visible) {
      // Nobody here: TAKE THE STRIP OUT OF THE DOM. Angular's `@if` removed
      // it entirely, and a surface that is merely display:none still answers
      // querySelector — which acceptance drivers assert on. Detaching also
      // means the fade-in animation replays on the next show, which is what
      // `@if` gave for free by recreating the node.
      strip.replaceChildren()
      strip.remove()
      return
    }

    // Rows are rebuilt, so a focused entry would lose focus on every
    // spotlight change — and a spotlight change is exactly what pressing
    // Enter on an entry causes. Snapshot which peer's button held focus and
    // give it back afterwards. (Angular's `@for … track entry.pubkey` kept
    // the same button element across the change, so focus survived there.)
    const focused = document.activeElement
    const refocus = focused instanceof HTMLElement && strip.contains(focused)
      ? focused.dataset['peer'] ?? ''
      : ''

    const buttons = entries.map(entry => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = entry.active ? 'entry active' : 'entry'
      // Identity for the focus restore above — the roster is ordered by
      // freshness, so the index is not stable but the pubkey is.
      button.dataset['peer'] = entry.pubkey
      button.setAttribute('aria-label', entry.active
        ? t('layer-cycle.active', 'Active layer (click to dismiss)')
        : t('layer-cycle.spotlight', 'Spotlight this layer'))
      // `[title]` was a property binding: inactive entries carried title=""
      // rather than no attribute. Same here.
      button.title = entry.active ? t('layer-cycle.dismiss', 'click to dismiss') : ''
      button.addEventListener('click', () => this.#onEntryClick(entry))

      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.backgroundColor = entry.color
      dot.style.boxShadow = entry.active
        ? `0 0 14px ${entry.color}, 0 0 4px ${entry.color}`
        : 'none'
      button.appendChild(dot)
      return button
    })

    strip.replaceChildren(...buttons)
    // Back in, if it was out. `appendChild` MOVES a live node — the widget
    // zoom stamp and the wheel guard ride along untouched.
    if (strip.parentNode !== this) this.appendChild(strip)

    if (refocus) {
      const again = buttons.find(button => button.dataset['peer'] === refocus)
      again?.focus()
    }
  }

  // ── the one gesture ──────────────────────────────────────────────────
  // Resolved lazily, at call time: on web the drones arrive from OPFS after
  // the shell, so a reference captured at construction would be null forever.
  #onEntryClick(entry: PeerEntry): void {
    const spotlight = window.ioc?.get?.(SPOTLIGHT_KEY) as SpotlightServiceLike | undefined
    if (!spotlight) return
    // Clicking the spotlit entry dismisses back to the default merged render;
    // clicking any other surfaces that peer. The service announces
    // `spotlight:changed`, which is what repaints this strip — nothing is
    // written to the DOM here.
    if (entry.active) spotlight.dismiss()
    else spotlight.set(entry.pubkey)
  }

  #refresh(): void {
    const swarm = window.ioc?.get?.(SWARM_KEY) as SwarmDroneLike | undefined
    this.#participants = swarm?.participantsAtCurrentSig?.() ?? []
    // If the active peer just dropped out of the participant list,
    // SpotlightService.reconcile() (subscribed to the same effect) will
    // dismiss; our #activePeer follows via the spotlight:changed echo.
    this.#render()
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts this tag
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, LayerCycleStripElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/LayerCycleStripElement',
    element: SURFACE_NAME,
    order: 310,
  })
})
