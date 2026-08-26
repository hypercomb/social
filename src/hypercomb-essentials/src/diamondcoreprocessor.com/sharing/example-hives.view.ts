// example-hives.view.ts — THE FIRST BOOT, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and
// arrive as signed modules).
//
// A straight port of shared/ui/example-hives/example-hives-offer: same
// surface name (hc-example-hives-offer), same order band (350), the same
// four effects in (`examples:offer`, `render:cell-count`, `examples:adopted`,
// `adopt:progress`) and the same four out (`examples:adopt`,
// `examples:dismiss`, `hive:empty:add-tile`, `tutorial:start`) — the new
// participant sees the same card, delivered by the module that owns the
// state it renders (sharing/example-hives.worker.ts, right beside this file).
//
// WHAT IT IS FOR. A brand-new install lands on an empty hive. This card is
// the first thing anyone ever sees of the hypercomb, and it offers three
// honest ways forward: follow the bee (`tutorial:start`), name your first
// tile (`hive:empty:add-tile`), or take one of the published example hives
// (`examples:adopt`). It is a PURE RENDERER — the worker owns detection, the
// roster, the adopt calls and the "don't offer again" flag; this card only
// draws and emits. Nothing folds without a click, and closing it writes
// nothing to the hive.
//
// FIRST-BOOT UI IS THE SHARP EDGE HERE. A registry-fed element is mounted
// ONCE at boot and stays, so a surface that paints before its payload says so
// would flash this welcome in the face of every returning participant. Two
// locks, both copied verbatim from the Angular original, keep that from
// happening — and BOTH must be true before a single node is attached:
//
//   1. `render:cell-count` must report a SETTLED EMPTY page (`count === 0 &&
//      settled === true`). History can report an empty root while its tiles
//      are still hydrating; only the renderer's settled-empty result may
//      reveal this surface, and any tile count hides it immediately, even
//      mid-render-pass. This starts FALSE, so the card cannot paint before
//      the renderer has spoken.
//   2. `examples:offer` must carry `active === true` with at least one
//      example. The worker only emits that after a delayed, retried,
//      cold-miss-aware emptiness probe — and only when the local
//      "dismissed" flag is clear.
//
// THE REPLAY IS NOT A GESTURE. `EffectBus.on()` hands the last value to a
// late subscriber, so this element receives whatever `examples:offer` last
// said the moment it subscribes. That is safe here because the worker
// ANSWERS ITS OWN OFFER: `#dismiss()` emits `examples:offer {active:false}`,
// overwriting the replayed value, so a card the participant closed can never
// be re-opened by a replay — and a participant who dismissed in an earlier
// session gets no emit at all (the localStorage flag returns before the
// probe). The element therefore needs no extra "already answered" guard, and
// adding one would only hide the worker's real state. What it DOES need is
// to start hidden, which lock 1 guarantees on its own.
//
// Not a docked panel: it extends HTMLElement directly and positions itself
// fixed over the whole viewport, exactly as the Angular `:host` did.
//
// NO KEYBOARD BINDING. The Angular original had neither
// `@HostListener('document:keydown.escape')` nor a raw keydown listener, and
// the backdrop is a click BLOCKER (pointer-events:auto so the hive cannot be
// poked through it), never a dismiss target. Adding Escape or
// backdrop-to-close here would be new behaviour on the one surface that must
// not surprise a first-time participant — so neither is here.
//
// Its strings ship WITH it (example-hives.i18n.ts) and register under the
// 'app' namespace, so every key resolves exactly as before.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { EXAMPLE_HIVES_TRANSLATIONS } from './example-hives.i18n.js'
import { DECK_SILHOUETTE, DECK_TRIADS, DECK_VIEW_BOX } from './behaviors-deck-silhouette.js'

const SURFACE_NAME = 'hc-example-hives-offer'

interface ExampleEntry {
  name: string
  head: string
  tiles?: number
  coverSig?: string
  description?: Record<string, string>
}
interface OfferPayload { active?: boolean; examples?: ExampleEntry[] }
interface AdoptedPayload { name?: string; status?: string }
interface AdoptProgressPayload { layers?: number; leaves?: number; failed?: number }
interface CellCountPayload { count?: number; settled?: boolean }

type RowStatus = 'idle' | 'adopting' | 'added' | 'unavailable'

/** {token} interpolation for the FALLBACK text — the live provider does its
 *  own; this only runs when i18n is absent or the key is unresolved. */
const fill = (template: string, params?: Record<string, string | number>): string =>
  params
    ? template.replace(/\{(\w+)\}/g, (whole, token: string) => {
      const value = params[token]
      return value !== undefined ? String(value) : whole
    })
    : template

// Same contract as the shell pipe: params drive both pluralization
// (`key.one` / `key.other`, chosen on params.count by the i18n service) and
// `{token}` interpolation.
const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key, params)
  return value && value !== key ? value : fill(fallback, params)
}

// The card's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(EXAMPLE_HIVES_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// `:host` became the tag name; every other selector is prefixed with it so
// nothing leaks (there is no shadow DOM here — the tutorial-overlay and
// preview-banner precedent). There are no @keyframes in this surface: the
// silhouette is deliberately STILL — no drift, no pulse — so there is no
// global animation name to re-scope.
//
// One deviation from the SCSS, and it is the registry-fed-element rule: the
// Angular `:host` was always `display:block` because the whole template sat
// behind `@if (visible())`, so an invisible host had no children. This host
// is mounted once and stays, so it defaults to `display:none` and opens on
// `.open` (the preview-banner / landing-badge pattern). Visually identical —
// an empty fixed pointer-events:none box paints nothing either way — but
// "hidden" is now unambiguous instead of implied.
//
// Angular's build autoprefixed; written by hand here: -webkit-backdrop-filter
// on the wash and the card, and -webkit-mask-image beside mask-image (the
// SCSS already spelled that pair out).
const CSS = `
${SURFACE_NAME}{position:fixed;inset:0;z-index:100000;pointer-events:none;display:none}
${SURFACE_NAME}.open{display:block}
${SURFACE_NAME} .offer-hive{position:absolute;inset:0;overflow:hidden;pointer-events:none;-webkit-mask-image:radial-gradient(ellipse at 50% 46%,#000 52%,rgba(0,0,0,.7) 78%,transparent 100%);mask-image:radial-gradient(ellipse at 50% 46%,#000 52%,rgba(0,0,0,.7) 78%,transparent 100%)}
${SURFACE_NAME} .offer-hive svg{width:100%;height:100%;display:block}
${SURFACE_NAME} .offer-hive .halo{fill-opacity:.08}
${SURFACE_NAME} .offer-hive .body{fill-opacity:.12;stroke-opacity:.5;stroke-width:2.5}
${SURFACE_NAME} .offer-hive .ring{stroke-opacity:.55;stroke-width:3}
${SURFACE_NAME} .offer-hive .light-core{stop-color:#cfe6f5;stop-opacity:.085}
${SURFACE_NAME} .offer-hive .light-mid{stop-color:#9fc4dd;stop-opacity:.03}
${SURFACE_NAME} .offer-hive .light-edge{stop-color:#9fc4dd;stop-opacity:0}
${SURFACE_NAME} .offer-backdrop{position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,rgba(126,182,214,.07),transparent 35rem),rgba(7,10,14,.48);-webkit-backdrop-filter:blur(3px) saturate(.75);backdrop-filter:blur(3px) saturate(.75);pointer-events:auto}
${SURFACE_NAME} .offer-card{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(.8);width:min(64rem,calc(100vw - 3rem));max-height:none;overflow:hidden;display:grid;grid-template-columns:minmax(17rem,.72fr) minmax(28rem,1.28fr);border-radius:var(--hc-radius-floating);background:rgba(12,17,24,.94);border:1px solid rgba(216,230,238,.12);box-shadow:0 2rem 6rem rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.18);-webkit-backdrop-filter:blur(18px) saturate(1.1);backdrop-filter:blur(18px) saturate(1.1);color:#d8e6ee;pointer-events:auto}
${SURFACE_NAME} .offer-card h2{margin:0;max-width:9ch;font-size:clamp(2.25rem,4vw,3.75rem);line-height:.96;font-weight:730;letter-spacing:-.045em}
${SURFACE_NAME} .welcome{display:flex;flex-direction:column;padding:clamp(1.75rem,3vw,2.75rem);background:linear-gradient(145deg,rgba(126,182,214,.13),transparent 48%),rgba(8,13,19,.52);border-right:1px solid rgba(216,230,238,.09)}
${SURFACE_NAME} .eyebrow,${SURFACE_NAME} .section-kicker{display:block;margin-bottom:.9rem;color:#7eb6d6;font-size:.68rem;font-weight:750;letter-spacing:.16em;text-transform:uppercase}
${SURFACE_NAME} .subtitle{margin:1rem 0 1.5rem;max-width:30rem;font-size:.94rem;line-height:1.6;color:rgba(216,230,238,.62)}
${SURFACE_NAME} .first-actions{display:grid;gap:.65rem;margin-top:auto}
${SURFACE_NAME} .first-actions button{width:100%;min-height:4.6rem;display:grid;grid-template-columns:2.2rem 1fr auto;align-items:center;gap:.75rem;padding:.75rem .9rem;border:1px solid rgba(126,182,214,.28);border-radius:var(--hc-radius-control);background:rgba(126,182,214,.08);color:#d8e6ee;text-align:left}
${SURFACE_NAME} .first-actions button:hover{background:rgba(126,182,214,.15);border-color:rgba(126,182,214,.48);transform:translateY(-1px)}
${SURFACE_NAME} .action-mark{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:50%;background:#7eb6d6;color:#0c1118;font-size:1.2rem;font-weight:800}
${SURFACE_NAME} .action-mark-add{font-size:1.5rem;font-weight:400}
${SURFACE_NAME} .action-copy{display:grid;gap:.16rem}
${SURFACE_NAME} .action-copy strong{font-size:.88rem}
${SURFACE_NAME} .action-copy small{color:rgba(216,230,238,.5);font-size:.71rem}
${SURFACE_NAME} .action-arrow{color:#7eb6d6;font-size:1.1rem}
${SURFACE_NAME} .examples{min-width:0;padding:clamp(1.5rem,2.5vw,2.25rem)}
${SURFACE_NAME} .section-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem;margin-bottom:1.25rem}
${SURFACE_NAME} .section-heading h3{margin:0;font-size:1.2rem;font-weight:650}
${SURFACE_NAME} .section-kicker{margin-bottom:.35rem;color:rgba(216,230,238,.42)}
${SURFACE_NAME} .section-note{max-width:13rem;color:rgba(216,230,238,.38);font-size:.7rem;line-height:1.4;text-align:right}
${SURFACE_NAME} .rows{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}
${SURFACE_NAME} .row{position:relative;min-width:0;overflow:hidden;display:grid;grid-template-rows:auto 1fr auto;border:1px solid rgba(216,230,238,.1);border-radius:var(--hc-radius-card);background:rgba(216,230,238,.035)}
${SURFACE_NAME} .row.is-added{border-color:rgba(111,211,154,.35)}
${SURFACE_NAME} .cover-wrap{position:relative}
${SURFACE_NAME} .cover{display:block;width:100%;aspect-ratio:2.15/1;object-fit:cover;background:radial-gradient(circle at 38% 45%,rgba(126,182,214,.23),transparent 2.5rem),linear-gradient(135deg,rgba(126,182,214,.1),rgba(216,230,238,.02));border-bottom:1px solid rgba(216,230,238,.08)}
${SURFACE_NAME} .cover-blank{display:block}
${SURFACE_NAME} .text{min-width:0;padding:.85rem .9rem .65rem;display:flex;flex-direction:column;gap:.3rem}
${SURFACE_NAME} .name{font-weight:600;font-size:.9rem;text-transform:capitalize}
${SURFACE_NAME} .description{font-size:.78rem;line-height:1.4;color:rgba(216,230,238,.5)}
${SURFACE_NAME} .meta{position:absolute;right:.55rem;bottom:.55rem;padding:.25rem .45rem;border-radius:999px;background:rgba(8,13,19,.78);font-size:.7rem;color:rgba(216,230,238,.68)}
${SURFACE_NAME} button{border:1px solid rgba(216,230,238,.14);border-radius:var(--hc-radius-control);padding:.48rem .8rem;font:inherit;font-size:.78rem;cursor:pointer;background:transparent;color:rgba(216,230,238,.85);transition:background 120ms ease,border-color 120ms ease,transform 120ms ease}
${SURFACE_NAME} button:hover{background:rgba(216,230,238,.08)}
${SURFACE_NAME} button:focus-visible{outline:2px solid #7eb6d6;outline-offset:2px}
${SURFACE_NAME} .add{justify-self:start;margin:0 .9rem .9rem;border-color:rgba(126,182,214,.38);color:#a8d0e7}
${SURFACE_NAME} .add:hover{background:rgba(126,182,214,.12)}
${SURFACE_NAME} .adding,${SURFACE_NAME} .added{align-self:end;justify-self:start;margin:0 .9rem .9rem;font-size:.74rem;color:rgba(216,230,238,.55);white-space:nowrap}
${SURFACE_NAME} .added{color:#6fd39a}
${SURFACE_NAME} .actions{grid-column:1/-1;display:flex;justify-content:center;padding:.85rem;border-top:1px solid rgba(216,230,238,.08)}
${SURFACE_NAME} .dismiss{border:0;color:rgba(216,230,238,.48);background:transparent}
${SURFACE_NAME} .dismiss:hover{color:rgba(216,230,238,.8);background:transparent}
@media (max-width:760px){
${SURFACE_NAME} .offer-card{top:auto;bottom:0;left:0;transform:none;width:100vw;max-height:94dvh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;grid-template-columns:1fr;border-radius:var(--hc-radius-floating) var(--hc-radius-floating) 0 0;padding-bottom:env(safe-area-inset-bottom,0px)}
${SURFACE_NAME} .welcome{border-right:0;border-bottom:1px solid rgba(216,230,238,.09)}
${SURFACE_NAME} .offer-card h2{max-width:none;font-size:2.35rem}
${SURFACE_NAME} .subtitle{margin:.85rem 0 1.25rem}
${SURFACE_NAME} .rows{grid-template-columns:1fr}
${SURFACE_NAME} .section-note{display:none}
${SURFACE_NAME} .offer-card::-webkit-scrollbar{display:none}
}
@media (min-width:761px) and (max-height:760px){
${SURFACE_NAME} .offer-card{max-height:calc(100dvh - 1.5rem);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}
${SURFACE_NAME} .offer-card::-webkit-scrollbar{display:none}
${SURFACE_NAME} .welcome,${SURFACE_NAME} .examples{padding:1.5rem}
${SURFACE_NAME} .offer-card h2{font-size:clamp(2rem,5vh,2.75rem)}
${SURFACE_NAME} .subtitle{margin:.8rem 0 1rem;line-height:1.45}
${SURFACE_NAME} .first-actions button{min-height:3.8rem}
${SURFACE_NAME} .cover{aspect-ratio:2.65/1}
}
@media (min-width:1200px) and (min-height:761px) and (max-height:1150px){
${SURFACE_NAME} .offer-card{width:min(68rem,calc(100vw - 5rem))}
${SURFACE_NAME} .welcome{padding:2rem}
${SURFACE_NAME} .examples{padding:1.75rem}
${SURFACE_NAME} .offer-card h2{font-size:2.75rem}
${SURFACE_NAME} .subtitle{margin:.85rem 0 1.2rem}
${SURFACE_NAME} .cover{aspect-ratio:2.1/1}
}
@media (min-width:3000px) and (min-height:1200px){
${SURFACE_NAME} .offer-card{width:78rem;grid-template-columns:minmax(22rem,.78fr) minmax(38rem,1.22fr);border-radius:var(--hc-radius-floating)}
${SURFACE_NAME} .welcome{padding:3.25rem}
${SURFACE_NAME} .examples{padding:2.75rem}
${SURFACE_NAME} .offer-card h2{font-size:3.8rem}
${SURFACE_NAME} .subtitle{font-size:1.02rem}
${SURFACE_NAME} .first-actions{gap:.8rem}
${SURFACE_NAME} .first-actions button{min-height:5rem}
${SURFACE_NAME} .rows{gap:1rem}
${SURFACE_NAME} .cover{aspect-ratio:2/1}
}
@media (min-width:2400px) and (min-height:1300px) and (max-aspect-ratio:2/1){
${SURFACE_NAME} .offer-card{width:72rem}
${SURFACE_NAME} .welcome{padding:3rem}
${SURFACE_NAME} .examples{padding:2.5rem}
}
@media (prefers-reduced-motion:reduce){
${SURFACE_NAME} button{transition:none}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-example-hives-offer', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string>,
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  return node
}

export class ExampleHivesOfferElement extends HTMLElement {

  #offs: Array<() => void> = []

  // ── state (the drone's, mirrored — never read back out of the DOM) ─────
  #offer: OfferPayload | null = null
  #status: Record<string, RowStatus> = {}
  #progress = 0
  #hiddenCovers = new Set<string>()
  /** Starts FALSE: the card cannot paint until the renderer confirms a
   *  settled-empty page. This is the lock that keeps first-boot UI off a
   *  returning participant's screen. */
  #renderSettledEmpty = false

  /** The silhouette and the wash never change — static art and a flat pane.
   *  Built once, kept, and MOVED back in by `replaceChildren` on each show;
   *  re-cutting ~50 SVG nodes per status change would be pure waste. */
  #hive: HTMLDivElement | null = null
  #backdrop: HTMLDivElement | null = null

  /** THE ONE SANCTIONED KEYED MAP (documentation/everything-is-a-beehavior
   *  Phase 2, "no reconciler in the kit"): cover images, keyed by example
   *  name. The card rebuilds on every status change, and re-creating an
   *  `<img>` restarts its load — which would blank the cover of the very row
   *  the participant just clicked, twice per adopt. Angular's `@for` with
   *  `track e.name` kept the node alive; so does this. Nodes are MOVED with
   *  appendChild, never re-created. */
  #covers = new Map<string, HTMLImageElement>()

  /** The "Adding… n" labels currently on screen. Progress is a STREAM — it
   *  mutates these nodes in place rather than rebuilding the card (see
   *  #paintProgress). Rebuilt as a side effect of each render. */
  #adding: HTMLElement[] = []

  // ── the original's derived state, copied predicate for predicate ───────

  /** `renderSettledEmpty && active === true && examples.length > 0` — the
   *  Angular `visible()` computed, VERBATIM. Never re-derived by negation:
   *  `> 0` is false for NaN, and the negated spelling would fall through. */
  get #visible(): boolean {
    return this.#renderSettledEmpty
      && this.#offer?.active === true
      && (this.#offer?.examples?.length ?? 0) > 0
  }

  get #examples(): ExampleEntry[] { return this.#offer?.examples ?? [] }

  get #anyAdded(): boolean { return Object.values(this.#status).includes('added') }

  #statusOf(name: string): RowStatus { return this.#status[name] ?? 'idle' }

  connectedCallback(): void {
    installCss()
    this.#offs.push(
      EffectBus.on<OfferPayload>('examples:offer', (payload) => {
        // A SET, not an accumulate — the same payload twice is the same card.
        this.#offer = payload ?? null
        this.#render()
      }),
      EffectBus.on<CellCountPayload>('render:cell-count', (payload) => {
        // History can report an empty root while its tiles are still
        // hydrating. Only the renderer's settled-empty result may reveal this
        // surface. Any tile count hides it immediately, even during another
        // render pass. (Also a SET — repeats are free.)
        this.#renderSettledEmpty = payload?.count === 0 && payload?.settled === true
        this.#render()
      }),
      EffectBus.on<AdoptedPayload>('examples:adopted', (payload) => {
        const name = String(payload?.name ?? '')
        if (!name) return
        const status = String(payload?.status ?? '')
        const row: RowStatus = status === 'adopting' ? 'adopting'
          : (status === 'committed' || status === 'exists') ? 'added'
            : 'unavailable'
        // One row's status is a state ASSERTION: writing the same value twice
        // is a no-op, so the post-commit re-announcement absorbs for free.
        this.#status[name] = row
        if (row === 'adopting') this.#progress = 0
        this.#render()
      }),
      EffectBus.on<AdoptProgressPayload>('adopt:progress', (payload) => {
        // Counts climb only while one of our rows is folding; the broker
        // reports totals-so-far, so the LATEST event is the count — an
        // assignment, never a sum, so a repeated payload lands the same
        // number. (Guard copied verbatim: the broker fires this for every
        // adopt in the app, ours or not.)
        if (!Object.values(this.#status).includes('adopting')) return
        this.#progress = (payload?.layers ?? 0) + (payload?.leaves ?? 0)
        // A STREAM update mutates the label that is already on screen. A
        // rebuild here would throw away the covers, the focus and the scroll
        // position several times a second while a hive folds.
        this.#paintProgress()
      }),
      // THE PIPE WAS IMPURE. The Angular original resolved its strings through
      // the `t` pipe, declared `pure: false`, so every change-detection tick
      // re-read them and `/language ja` re-labelled an OPEN card on the spot.
      // An element renders when it decides to, so the locale switch has to be
      // a reason to render — and here it is load-bearing twice over: the
      // catalog strings AND the per-example description, which is picked from
      // the roster by `document.documentElement.lang` (the same lang the i18n
      // service rewrites on setLocale).
      EffectBus.on('locale:changed', () => this.#render()),
    )
    // Hidden until both locks agree. Replay has already delivered the live
    // values above if there are any, so this is the paint, not a catch-up.
    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.replaceChildren()
    this.classList.remove('open')
    this.#hive = null
    this.#backdrop = null
    this.#covers.clear()
    this.#adding = []
  }

  // ── the gestures (each emits exactly once, per the original) ──────────

  #onAdopt(entry: ExampleEntry): void {
    const status = this.#statusOf(entry.name)
    // The original's own once-guard: a row already folding or already added
    // does not ask again. (The worker has a second one — `#busy` — so a
    // double-click cannot double-fold even if this one were removed.)
    if (status === 'adopting' || status === 'added') return
    EffectBus.emit('examples:adopt', { name: entry.name })
  }

  /** "Add a tile" and "Show me how" are the empty-hive gestures folded in from
   *  collection-empty-prompt's `root` variant. This card stays a PURE
   *  RENDERER: it closes the offer and emits, and the drone (which owns the
   *  command-line focus dance) does the work. */
  #onAddTile(): void {
    EffectBus.emit('examples:dismiss', {})
    EffectBus.emit('hive:empty:add-tile', {})
  }

  #onTour(): void {
    EffectBus.emit('examples:dismiss', {})
    EffectBus.emit('tutorial:start', {})
  }

  #onDismiss(): void {
    EffectBus.emit('examples:dismiss', {})
  }

  // ── rendering (rebuild on change — the house pattern, no reconciler) ───

  #render(): void {
    const visible = this.#visible
    // Snapshot BEFORE the teardown. Angular's static template nodes survived
    // every state change, so a participant tabbed onto Dismiss kept focus
    // when a row flipped to "Adding…". A full rebuild drops it to <body> —
    // one keystroke from nothing. Keys are stable strings, so a control that
    // genuinely went away (the row's Add button becoming an "Adding…" label,
    // exactly as Angular's @switch did) simply is not found, and focus falls
    // where it would have fallen before.
    const focusKey = this.#focusKey()

    this.#adding = []

    if (!visible) {
      // Angular's `@if` removed the whole thing. Detach for real — a surface
      // that is merely display:none still answers querySelector.
      this.replaceChildren()
      this.classList.remove('open')
      return
    }

    const hive = this.#hive ?? (this.#hive = this.#buildHive())
    const backdrop = this.#backdrop ?? (this.#backdrop = this.#buildBackdrop())

    // replaceChildren MOVES the two kept nodes back in; only the card is new.
    this.replaceChildren(hive, backdrop, this.#buildCard())
    this.classList.add('open')
    this.#restoreFocus(focusKey)
  }

  #buildBackdrop(): HTMLDivElement {
    const backdrop = document.createElement('div')
    backdrop.className = 'offer-backdrop'
    backdrop.setAttribute('aria-hidden', 'true')
    // No click handler, by design: the wash exists to STOP clicks reaching
    // the hive underneath (pointer-events:auto), not to close the card. The
    // Angular original had none either, and inventing one here would give a
    // first-time participant a way to lose the welcome by mis-clicking.
    return backdrop
  }

  #focusKey(): string {
    const active = document.activeElement
    return active instanceof HTMLElement && this.contains(active)
      ? String(active.dataset['focus'] ?? '')
      : ''
  }

  /** Scanned rather than selected: an example name is participant-facing
   *  roster data, and building a selector string out of it is how an
   *  attribute selector gets broken by a value nobody predicted. */
  #restoreFocus(key: string): void {
    if (!key) return
    for (const node of this.querySelectorAll<HTMLElement>('[data-focus]')) {
      if (node.dataset['focus'] === key) { node.focus(); return }
    }
  }

  /** Progress is the one update that does NOT rebuild: it writes the new
   *  count into the labels already on screen. Mutating an existing node on a
   *  stream update is not a reconciler. If nothing is on screen yet the count
   *  is still stored, and the next rebuild paints it. */
  #paintProgress(): void {
    if (!this.#adding.length) return
    const label = t('examples.offer.adding', 'Adding… {count}', { count: this.#progress })
    for (const span of this.#adding) span.textContent = label
  }

  // ── the hive behind the card (built once — static art) ────────────────

  #buildHive(): HTMLDivElement {
    const host = document.createElement('div')
    host.className = 'offer-hive'
    host.setAttribute('aria-hidden', 'true')

    const root = svgEl('svg', {
      viewBox: DECK_VIEW_BOX,
      preserveAspectRatio: 'xMidYMid slice',
      focusable: 'false',
    })

    // The viewBox as x/y/width/height — the mask needs it in user space.
    const [vx = '0', vy = '0', vw = '0', vh = '0'] = DECK_VIEW_BOX.split(' ')

    const defs = svgEl('defs', {})
    // The comb itself, as a stencil: light lands on tiles, never on the
    // ground between them.
    const mask = svgEl('mask', {
      id: 'hc-deck-comb', maskUnits: 'userSpaceOnUse', x: vx, y: vy, width: vw, height: vh,
    })
    for (const tile of DECK_SILHOUETTE) {
      mask.appendChild(svgEl('polygon', { points: tile.body, fill: '#fff' }))
    }
    defs.appendChild(mask)

    // One source per triad. Strength lives in the stylesheet.
    for (const light of DECK_TRIADS) {
      const gradient = svgEl('radialGradient', {
        id: light.id, gradientUnits: 'userSpaceOnUse', cx: light.cx, cy: light.cy, r: light.r,
      })
      gradient.appendChild(svgEl('stop', { class: 'light-core', offset: '0%' }))
      gradient.appendChild(svgEl('stop', { class: 'light-mid', offset: '42%' }))
      gradient.appendChild(svgEl('stop', { class: 'light-edge', offset: '100%' }))
      defs.appendChild(gradient)
    }
    root.appendChild(defs)

    for (const tile of DECK_SILHOUETTE) {
      const group = svgEl('g', { stroke: tile.color, fill: tile.color })
      group.appendChild(svgEl('polygon', { class: 'halo', points: tile.halo, stroke: 'none' }))
      group.appendChild(svgEl('polygon', { class: 'body', points: tile.body }))
      group.appendChild(svgEl('polygon', { class: 'ring', points: tile.ring, fill: 'none' }))
      root.appendChild(group)
    }

    const lights = svgEl('g', { class: 'lights', mask: 'url(#hc-deck-comb)' })
    for (const light of DECK_TRIADS) {
      lights.appendChild(svgEl('circle', {
        cx: light.cx, cy: light.cy, r: light.r, fill: `url(#${light.id})`,
      }))
    }
    root.appendChild(lights)

    host.appendChild(root)
    return host
  }

  // ── the card ──────────────────────────────────────────────────────────

  #buildCard(): HTMLDivElement {
    const card = document.createElement('div')
    card.className = 'offer-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-labelledby', 'example-hives-title')
    card.append(this.#buildWelcome(), this.#buildExamples(), this.#buildActions())
    return card
  }

  #buildWelcome(): HTMLElement {
    const welcome = document.createElement('header')
    welcome.className = 'welcome'

    const eyebrow = document.createElement('span')
    eyebrow.className = 'eyebrow'
    eyebrow.textContent = t('examples.offer.eyebrow', 'A place for everything you’re making')

    const title = document.createElement('h2')
    title.id = 'example-hives-title'
    title.textContent = t('examples.offer.title', 'Make this hive yours.')

    const subtitle = document.createElement('p')
    subtitle.className = 'subtitle'
    subtitle.textContent = t('examples.offer.subtitle',
      'Keep a thought, a picture, a whole project — then connect it to whatever comes next. '
      + 'There is no wrong place to begin.')

    const actions = document.createElement('div')
    actions.className = 'first-actions'
    actions.append(
      this.#firstAction(
        '∞', false,
        t('hive.empty.tour', 'Show me how'),
        t('hive.empty.tour.detail', 'Follow the bee for a one-minute tour'),
        'tour', () => this.#onTour(),
      ),
      this.#firstAction(
        '+', true,
        t('hive.empty.action', 'Add a tile'),
        t('hive.empty.action.detail', 'Name the first thing you want to keep'),
        'add-tile', () => this.#onAddTile(),
      ),
    )

    welcome.append(eyebrow, title, subtitle, actions)
    return welcome
  }

  #firstAction(
    glyph: string, plus: boolean, heading: string, detail: string,
    focusKey: string, onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['focus'] = focusKey
    button.addEventListener('click', onClick)

    const mark = document.createElement('span')
    mark.className = plus ? 'action-mark action-mark-add' : 'action-mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.textContent = glyph

    const copy = document.createElement('span')
    copy.className = 'action-copy'
    const strong = document.createElement('strong')
    strong.textContent = heading
    const small = document.createElement('small')
    small.textContent = detail
    copy.append(strong, small)

    const arrow = document.createElement('span')
    arrow.className = 'action-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    arrow.textContent = '→'

    button.append(mark, copy, arrow)
    return button
  }

  #buildExamples(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'examples'
    section.setAttribute('aria-labelledby', 'examples-heading')

    const heading = document.createElement('div')
    heading.className = 'section-heading'

    const left = document.createElement('div')
    const kicker = document.createElement('span')
    kicker.className = 'section-kicker'
    kicker.textContent = t('examples.offer.or', 'Or')
    const subheading = document.createElement('h3')
    subheading.id = 'examples-heading'
    subheading.textContent = t('examples.offer.examples-title', 'Begin with something alive')
    left.append(kicker, subheading)

    const note = document.createElement('span')
    note.className = 'section-note'
    note.textContent = t('examples.offer.examples-note',
      'Every example becomes yours. Remove it whenever you like.')

    heading.append(left, note)

    const rows = document.createElement('ul')
    rows.className = 'rows'
    const live = new Set<string>()
    for (const entry of this.#examples) {
      live.add(entry.name)
      rows.appendChild(this.#buildRow(entry))
    }
    // Keep the cover map to the roster actually on offer — a replaced roster
    // must not leave orphan images pinned for the life of the session.
    for (const name of [...this.#covers.keys()]) if (!live.has(name)) this.#covers.delete(name)

    section.append(heading, rows)
    return section
  }

  #buildRow(entry: ExampleEntry): HTMLLIElement {
    const status = this.#statusOf(entry.name)

    const row = document.createElement('li')
    row.className = status === 'added' ? 'row is-added' : 'row'

    const coverWrap = document.createElement('div')
    coverWrap.className = 'cover-wrap'

    const url = entry.coverSig ? `/@resource/${entry.coverSig}` : ''
    if (url && !this.#hiddenCovers.has(entry.name)) {
      coverWrap.appendChild(this.#coverFor(entry.name, url, this.#displayName(entry)))
    } else {
      const blank = document.createElement('span')
      blank.className = 'cover cover-blank'
      blank.setAttribute('aria-hidden', 'true')
      coverWrap.appendChild(blank)
    }

    // `@if (e.tiles)` — truthiness, so an absent count AND a zero count both
    // draw nothing. Copied, not re-derived.
    if (entry.tiles) {
      const meta = document.createElement('span')
      meta.className = 'meta'
      // Plural key: the provider resolves .one/.other from `count` (there is
      // no bare `examples.offer.tiles` in any catalog); the fallback picks the
      // same branch by hand.
      meta.textContent = t(
        'examples.offer.tiles',
        entry.tiles === 1 ? '{count} tile' : '{count} tiles',
        { count: entry.tiles },
      )
      coverWrap.appendChild(meta)
    }

    const text = document.createElement('div')
    text.className = 'text'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = this.#displayName(entry)
    const description = document.createElement('span')
    description.className = 'description'
    description.textContent = this.#description(entry)
    text.append(name, description)

    row.append(coverWrap, text, this.#buildRowAction(entry, status))
    return row
  }

  /** The Angular `@switch (status(e.name))`, arm for arm. */
  #buildRowAction(entry: ExampleEntry, status: RowStatus): HTMLElement {
    if (status === 'added') {
      const added = document.createElement('span')
      added.className = 'added'
      added.textContent = t('examples.offer.added', 'Added')
      return added
    }

    if (status === 'adopting') {
      const adding = document.createElement('span')
      adding.className = 'adding'
      adding.textContent = t('examples.offer.adding', 'Adding… {count}', { count: this.#progress })
      // Registered so the progress stream can write straight into it.
      this.#adding.push(adding)
      return adding
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'add'
    button.dataset['focus'] = `add:${entry.name}`
    button.addEventListener('click', () => this.#onAdopt(entry))

    if (status === 'unavailable') {
      button.textContent = t('examples.offer.retry', 'Retry')
      return button
    }

    // idle: the label, then the "+" the template carried as its own span.
    const plus = document.createElement('span')
    plus.setAttribute('aria-hidden', 'true')
    plus.textContent = '+'
    button.append(t('examples.offer.add', 'Add'), ' ', plus)
    return button
  }

  #buildActions(): HTMLElement {
    const actions = document.createElement('div')
    actions.className = 'actions'

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'dismiss'
    dismiss.dataset['focus'] = 'dismiss'
    // A KEY CHOSEN AT RUNTIME: the label flips once anything has been added,
    // so both spellings ship in the catalog (`examples.offer.done` and
    // `examples.offer.dismiss`) — a harvest that only reads the rendered
    // branch would leave the other behind.
    dismiss.textContent = this.#anyAdded
      ? t('examples.offer.done', 'Done')
      : t('examples.offer.dismiss', 'Start empty')
    dismiss.addEventListener('click', () => this.#onDismiss())

    actions.appendChild(dismiss)
    return actions
  }

  // ── per-entry helpers, straight from the component ────────────────────

  #displayName(entry: ExampleEntry): string {
    return entry.name.replace(/-/g, ' ')
  }

  /** Descriptions are per-locale ROSTER data, not catalog keys (they must
   *  render before any catalog-bearing content exists); pick by the document
   *  locale the i18n service maintains, falling back to English. This is why
   *  `locale:changed` has to re-render even though no `t()` call is involved
   *  in this string. */
  #description(entry: ExampleEntry): string {
    const lang = (document.documentElement.lang || 'en').toLowerCase()
    const map = entry.description ?? {}
    return map[lang] ?? map[lang.split('-')[0]] ?? map['en'] ?? ''
  }

  /** The one keyed node in this panel. See #covers. */
  #coverFor(name: string, url: string, alt: string): HTMLImageElement {
    const cached = this.#covers.get(name)
    if (cached && cached.dataset['url'] === url) {
      cached.alt = alt
      return cached
    }
    const image = document.createElement('img')
    image.className = 'cover'
    image.loading = 'lazy'
    image.alt = alt
    image.dataset['url'] = url
    // A cover that cannot resolve folds to the blank plate rather than the
    // browser's broken-image glyph. Marking is a SET — a second error on the
    // same name changes nothing and the re-render is a no-op.
    image.addEventListener('error', () => {
      if (this.#hiddenCovers.has(name)) return
      this.#hiddenCovers.add(name)
      this.#render()
    })
    image.src = url
    this.#covers.set(name, image)
    return image
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts tags directly
// in its own template) still needs the tag to be a real element rather than
// an inert unknown one — so the define cannot wait on the registry. Only the
// ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ExampleHivesOfferElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ExampleHivesOfferElement',
    element: SURFACE_NAME,
    order: 350,
  })
})
