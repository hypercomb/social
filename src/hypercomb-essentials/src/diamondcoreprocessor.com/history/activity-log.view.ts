// activity-log.view.ts — the running feed of what just happened in the hive,
// as a framework-free custom element (everything-is-a-beehavior Phase 2:
// Angular panels leave the shell and ship as signed modules).
//
// A straight port of shared/ui/activity-log: same surface name
// (hc-activity-log), same order band (360), the same SIX effects in
// (`cell:added`, `cell:removed`, `clipboard:paste-done`, `move:committed`,
// `mesh:public-changed`, `activity:log`) and the same two effects out — the
// two REVERT emissions (`cell:removed` for an undone add, `cell:added` with
// `revive: true` for an undone remove), each followed by a processor pulse.
// The participant sees the identical strip of grey lines bottom-left.
//
// It lands in `history/` because that is the domain that owns what happened:
// history-recorder.drone.ts is the ledger, this is the human-visible tail of
// the same story — the last few operations, said out loud for ten seconds,
// with an undo arrow on the two that can be taken back.
//
// WHAT IT IS FOR. Most hive operations are silent: a cell appears, a move
// commits, a paste lands. This is the receipt. Each line says what happened
// and offers two gestures — × to dismiss it now, ↩ to undo it (adds and
// removes only; a move or a paste has no one-click inverse here). Everything
// expires on its own after ten seconds, so the feed never becomes something
// to manage.
//
// MANY DRONES EMIT `activity:log` AND NOBODY OWNS IT. The tutorial queens,
// the substrate service, the lounge queen, portal-overlay, swarm-adopt —
// each sends `{ icon?, message }` and expects it to appear verbatim. The
// original destructured exactly those two fields and rendered the message as
// TEXT (icons arrive as anything from '◈' to a Material Symbol name like
// 'chair'; both were, and still are, printed literally). Nothing more is
// assumed about the payload here either.
//
// THE #ready GATE IS LOAD-BEARING, NOT A RACE PATCH. EffectBus.on() replays
// the last value synchronously at subscribe time, so without the gate a mount
// would immediately re-announce the last cell that was added, the last paste,
// the last mesh flip — a feed of stale news on every boot, with LIVE revert
// buttons attached to operations that happened minutes ago. The Angular
// component subscribed with `#ready = false` and flipped it in a
// queueMicrotask; this does exactly the same, and re-arms the gate on every
// connect so a re-mount cannot leak the replay either.
//
// WHY THIS ONE KEEPS A KEYED MAP OF ROWS. Rebuild-on-change is the house
// pattern and it is safe wherever the DOM holds no state. Here the DOM holds
// ANIMATION state: dismissing an entry sets `.fading` on the row and the
// sheet TRANSITIONS its opacity to 0 over 200ms before the entry leaves the
// list. A transition only runs when a value changes on a node that is already
// in the document — a freshly built row that arrives already carrying
// `.fading` would blink out instead of fading. Angular's `@for … track
// entry.id` kept the nodes; so does this, via the sanctioned per-panel
// `Map<id, row>` (the plan's one exception), and rows are placed with
// `insertBefore`, which MOVES a live node rather than re-creating it.
//
// LIFECYCLE NOTE. The Angular version wrapped its markup in
// `@if (hasEntries())`, so the panel only existed while something was in the
// feed. A registry-fed element is mounted ONCE at boot and stays, so the
// panel is built once and kept, and `#render` attaches / detaches it — it
// genuinely leaves the DOM when the feed empties, and the host starts hidden.
//
// Its strings ship WITH it (activity-log.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import { EffectBus, I18N_IOC_KEY, hypercomb, type I18nProvider } from '@hypercomb/core'
import { ACTIVITY_LOG_TRANSLATIONS } from './activity-log.i18n.js'

const SURFACE_NAME = 'hc-activity-log'

const LINEAGE_KEY = '@hypercomb.social/Lineage'

/** Seconds an entry survives before it dismisses itself. Verbatim from the
 *  component — the participant-visible timing must not drift. */
const TIMEOUT_S = 10

/** How long the fade-out runs before the entry actually leaves the list.
 *  Must stay in step with `transition: opacity 200ms` in the sheet below. */
const FADE_MS = 200

/** The feed keeps at most this many entries, newest first — the tail is
 *  dropped (`[entry, ...list].slice(0, MAX_ENTRIES)`). Trimming from the END
 *  means the OLDEST line falls off, which is the whole point of a feed. */
const MAX_ENTRIES = 10

// Effects hidden from the activity log. Add effect names here to suppress
// them. Copied verbatim, including its one member: the mesh subscription
// below is written out in full and then suppressed by this set, so deleting
// the line here restores the announcement exactly as it was authored.
const HIDDEN: Set<string> = new Set([
  'mesh:public-changed',
])

/** Just enough of Lineage to ask where we are standing. Structural, so the
 *  view never depends on the class — the house pattern for IoC lookups. */
interface LineageLike {
  explorerSegments?: () => readonly unknown[]
}

/** One line in the feed. `revert` is null for anything with no one-click
 *  inverse (moves, pastes, mesh flips, foreign `activity:log` messages). */
interface ActivityEntry {
  id: number
  icon: string
  message: string
  timer: ReturnType<typeof setTimeout> | null
  fading: boolean
  revert: (() => Promise<void>) | null
}

/** One live row. Held across renders — see `#rows` for why. */
type Row = {
  /** The `.activity-entry` element. */
  el: HTMLElement
  /** The ↩ button, present only when the entry can be reverted. Kept so
   *  `#relabel()` can re-resolve its title on a locale switch. */
  revert: HTMLButtonElement | null
  /** The × button. Same reason. */
  dismiss: HTMLButtonElement
}

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

// The feed's strings travel with it — registered as soon as the i18n service
// is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(ACTIVITY_LOG_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + sequence-viewer precedent), so
// Angular's `:host` becomes the tag name and every other selector is prefixed
// with it — nothing can leak out of the log. The host rule stays a plain
// `display:contents` (no `!important`), so both shells' suppressions still
// win over it and still hide the whole subtree, fixed-position panel
// included: `body.hc-view-website hc-activity-log` in web/dev styles.scss and
// `:host.intro-active hc-activity-log` in dev's app.scss.
//
// Two positions worth keeping the reasoning for, both verbatim from the SCSS:
//   - LEFT is anchored to `--hc-controls-left`, the occupied edge the control
//     bar publishes (0px when it is not docked left), so the log indents
//     beside the rail instead of running underneath it. Same var the docked
//     toolwindows lay out against — never a second hardcoded rail width to
//     drift out of step with.
//   - Z-INDEX 59990: the panel itself is pointer-events:none, but each ENTRY
//     re-enables them for its revert and dismiss buttons — and #pixi-host
//     reparents to <body> at z 59989 with a pointer-events:auto <canvas>
//     inside, so at the original z 9 those two buttons were unclickable.
//     Raising costs nothing visually (the canvas is transparent — the strip
//     was never painted over, only hit-tested away) and keeps the log under
//     every piece of shell chrome.
//
// The item cap is enforced upstream (MAX_ENTRIES); the overflow + scroll still
// works for the rare full-list case, but the scrollbar itself is hidden so the
// panel reads as a quiet text strip — no chrome competing with the canvas.
//
// `@include phone-only` / `@include tablet-only` become their literal queries
// from _breakpoints.scss (max-width 599px, and 600px–1023px: the mixin is
// `$bp-tablet-land - 1`). There are no keyframes to namespace here — the fade
// is a transition, not an animation.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .activity-panel{position:fixed;bottom:1.6rem;left:calc(var(--hc-controls-left,0px) + 0.5rem);z-index:59990;max-width:min(22rem,calc(100vw - var(--hc-controls-left,0px) - var(--hc-controls-right,0px) - 1rem));max-height:50vh;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;display:flex;flex-direction:column-reverse;gap:.1rem;padding:.25rem 0;background:transparent;pointer-events:none;font-family:var(--hc-mono);font-size:.7rem;color:rgba(245,245,245,.4)}
${SURFACE_NAME} .activity-panel::-webkit-scrollbar{display:none}
${SURFACE_NAME} .activity-entry{display:flex;align-items:center;gap:.35rem;padding:.15rem .3rem;pointer-events:auto;transition:opacity 200ms ease}
${SURFACE_NAME} .activity-entry:hover{color:rgba(245,245,245,.8)}
${SURFACE_NAME} .activity-entry.fading{opacity:0}
${SURFACE_NAME} .entry-revert{flex-shrink:0;width:.9rem;background:none;border:none;color:rgba(77,166,255,.25);font-size:.6rem;cursor:pointer;padding:0;line-height:1;text-align:center;transition:color 150ms ease}
${SURFACE_NAME} .entry-revert:hover{color:rgba(77,166,255,.7)}
${SURFACE_NAME} .entry-revert:focus-visible{outline:1px solid rgba(77,166,255,.3);outline-offset:-1px}
${SURFACE_NAME} .entry-icon{flex-shrink:0;width:.9rem;text-align:center;color:rgba(77,166,255,.5);font-size:.6rem}
${SURFACE_NAME} .entry-message{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .entry-dismiss{flex-shrink:0;width:1rem;background:none;border:none;color:rgba(245,245,245,.15);font-size:.65rem;cursor:pointer;padding:0;line-height:1;text-align:center;transition:color 150ms ease}
${SURFACE_NAME} .entry-dismiss:hover{color:rgba(245,245,245,.5)}
${SURFACE_NAME} .entry-dismiss:focus-visible{outline:1px solid rgba(245,245,245,.3);outline-offset:-1px}
@media (max-width:599px){
${SURFACE_NAME} .activity-panel{bottom:calc(4rem + var(--hc-safe-bottom,0px));left:calc(var(--hc-controls-left,0px) + 0.5rem);max-width:calc(100vw - var(--hc-controls-left,0px) - var(--hc-controls-right,0px) - 1rem);font-size:.72rem}
${SURFACE_NAME} .entry-revert{width:2rem;min-height:2rem;display:flex;align-items:center;justify-content:center;font-size:.75rem}
${SURFACE_NAME} .entry-dismiss{width:2rem;min-height:2rem;display:flex;align-items:center;justify-content:center;font-size:.75rem}
}
@media (min-width:600px) and (max-width:1023px){
${SURFACE_NAME} .activity-panel{bottom:calc(3.5rem + var(--hc-safe-bottom,0px));left:calc(var(--hc-controls-left,0px) + 0.4rem);max-width:calc(100vw - var(--hc-controls-left,0px) - var(--hc-controls-right,0px) - 0.8rem)}
}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-activity-log', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class ActivityLogElement extends HTMLElement {

  #offs: Array<() => void> = []

  /** The feed, NEWEST FIRST — the order the component's signal held, and the
   *  order the panel's `column-reverse` turns into "newest at the bottom". */
  #entries: ActivityEntry[] = []
  #nextId = 0

  /** Replay guard. See the header: EffectBus replays synchronously on
   *  subscribe, so every handler must be deaf until the microtask after
   *  wiring or the feed opens full of old news. */
  #ready = false

  /** True only for the synchronous window inside a revert emission, so the
   *  entry the revert itself produces carries NO revert button — one undo,
   *  never a ping-pong. Copied from the component. */
  #reverting = false

  /** Every timer this element has armed — auto-dismiss and fade-removal
   *  alike — so disconnect can drain all of them. (The component cleared
   *  only the timers of LIVE entries, which left a cap-trimmed entry's
   *  auto-dismiss pending; its sole effect is a `dismiss()` that finds no
   *  entry and returns, so tracking them here changes nothing observable
   *  and honours the tear-down rule.) */
  #timers = new Set<ReturnType<typeof setTimeout>>()

  /** The `@if (hasEntries())` wrapper. Built once and kept; ATTACHED only
   *  while the feed has something in it (see `#render`). */
  #panel: HTMLElement | null = null

  /** id → the live row showing it.
   *
   *  NOT A RECONCILER — the sanctioned per-panel `Map<key, element>` the plan
   *  names for genuinely live rows. See the header for why this feed is one:
   *  the fade-out is a CSS TRANSITION on the row, and a transition only runs
   *  on a node that was already in the document with the old value. Nothing
   *  else about an entry ever changes after it is added (icon and message are
   *  frozen at add time), so a row's children are built once and never
   *  diffed. */
  #rows = new Map<number, Row>()

  connectedCallback(): void {
    installCss()
    this.#build()

    // Re-armed on every connect: a re-mount must not leak the replay either.
    this.#ready = false

    this.#offs.push(
      // ── cell added ───────────────────────────────────────────────────
      EffectBus.on<{ cell: string }>('cell:added', p => {
        if (!this.#ready || !p?.cell || HIDDEN.has('cell:added')) return
        const msg = t('activity.added', 'added "{cell}"', { cell: p.cell })
        // Inside a revert, the echo gets no undo arrow of its own.
        if (this.#reverting) { this.#addEntry('+', msg); return }
        this.#addEntry('+', msg, () => this.#revertAdd(p.cell))
      }),

      // ── cell removed ─────────────────────────────────────────────────
      EffectBus.on<{ cell: string }>('cell:removed', p => {
        if (!this.#ready || !p?.cell || HIDDEN.has('cell:removed')) return
        const msg = t('activity.removed', 'removed "{cell}"', { cell: p.cell })
        if (this.#reverting) { this.#addEntry('−', msg); return }
        this.#addEntry('−', msg, () => this.#revertRemove(p.cell))
      }),

      // ── paste finished ───────────────────────────────────────────────
      // Two lines, not one: the count that landed, and — only when the
      // clipboard reported failures — a second '!' line naming how many
      // could not be pasted. Both plural-aware through the count param.
      EffectBus.on<{ count: number; failed?: string[] }>('clipboard:paste-done', p => {
        if (!this.#ready || !p || HIDDEN.has('clipboard:paste-done')) return
        const count = p.count
        const msg = count === 1
          ? t('activity.pasted', 'pasted {count} tile', { count })
          : t('activity.pasted', 'pasted {count} tiles', { count })
        this.#addEntry('⎘', msg)
        // `p.failed.length > 0`, copied not re-derived — the polarity is the
        // original's, so a malformed `failed` never falls through into a
        // "NaN tiles could not be pasted" line.
        if (p.failed && p.failed.length > 0) {
          const failedCount = p.failed.length
          this.#addEntry('!', t('activity.paste-failed',
            '{count} tile(s) could not be pasted (source missing)', { count: failedCount }))
        }
      }),

      // ── move committed ───────────────────────────────────────────────
      EffectBus.on('move:committed', () => {
        if (!this.#ready || HIDDEN.has('move:committed')) return
        this.#addEntry('↔', t('activity.moved', 'tile moved'))
      }),

      // ── mesh visibility flipped ──────────────────────────────────────
      // Written out in full and then suppressed by HIDDEN (which ships with
      // 'mesh:public-changed' in it). Deleting that one line in HIDDEN is all
      // it takes to bring the announcement back exactly as authored.
      EffectBus.on<{ public: boolean }>('mesh:public-changed', p => {
        if (!this.#ready || !p || HIDDEN.has('mesh:public-changed')) return
        this.#addEntry('◆', p.public
          ? t('activity.mesh-public', 'mesh → public')
          : t('activity.mesh-private', 'mesh → private'))
      }),

      // ── anything anybody wants to say ────────────────────────────────
      // The open door: many drones emit this and none owns it. Note it does
      // NOT consult HIDDEN — that was true of the original too, and it is
      // right: HIDDEN suppresses named EFFECTS, and this one is the generic
      // channel. The icon defaults to ℹ exactly as before.
      EffectBus.on<{ icon?: string; message: string }>('activity:log', p => {
        if (!this.#ready || !p?.message) return
        this.#addEntry(p.icon ?? 'ℹ', p.message)
      }),

      // THE PIPE WAS IMPURE. The Angular original resolved the two button
      // titles through the `t` pipe, declared `pure: false`, so every
      // change-detection tick re-read them and `/language ja` re-labelled an
      // OPEN feed on the spot. An element renders when it decides to, and
      // this one deliberately does NOT rebuild live rows — so the locale
      // switch gets a #relabel() that re-resolves those two strings in place,
      // leaving every row's fade state and identity untouched.
      //
      // Entry MESSAGES are deliberately NOT re-resolved: the component
      // computed them in TypeScript at add time and stored the finished
      // string on the entry, so they never followed a locale change there
      // either. A line in a feed is a record of a past moment — re-writing
      // yesterday's sentence in a new language is not what the pipe did.
      EffectBus.on('locale:changed', () => this.#relabel()),
    )

    // Deaf until the microtask after wiring — every replay above has already
    // been swallowed by the time this runs.
    queueMicrotask(() => { this.#ready = true })

    this.#render()
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#ready = false
    this.#reverting = false
    for (const timer of this.#timers) clearTimeout(timer)
    this.#timers.clear()
    for (const entry of this.#entries) entry.timer = null
    this.#entries = []
    this.#rows.clear()
    this.#panel?.remove()
    this.#panel = null
    this.replaceChildren()
  }

  // ── chrome (built once) ──────────────────────────────────────────────
  #build(): void {
    if (this.#panel) return
    const panel = document.createElement('div')
    panel.className = 'activity-panel'
    // Built DETACHED. `#render` attaches it when the feed has something in it
    // and takes it back out when it empties — so the panel is absent from the
    // DOM at rest, exactly as the Angular `@if` left it, with no transient
    // attach on the way through mount.
    this.#panel = panel
  }

  // ── state ────────────────────────────────────────────────────────────
  #addEntry(icon: string, message: string, revert?: () => Promise<void>): void {
    const id = this.#nextId++
    const timer = this.#arm(() => this.dismiss(id), TIMEOUT_S * 1000)
    const entry: ActivityEntry = { id, icon, message, timer, fading: false, revert: revert ?? null }
    // Newest first, oldest off the tail — `[entry, ...list].slice(0, 10)`
    // verbatim. The cap trims the END, so the line that falls off is the one
    // that has been sitting there longest.
    this.#entries = [entry, ...this.#entries].slice(0, MAX_ENTRIES)
    this.#render()
  }

  /** Revert an add — emit `cell:removed` so the children-slot
   *  subscriber rewrites the parent layer without this cell. Layer is
   *  the only source of truth for hierarchy; the legacy `removeEntry`
   *  on a phantom OPFS dir is retired. */
  async #revertAdd(cell: string): Promise<void> {
    const segments = this.#segments()
    this.#reverting = true
    EffectBus.emit('cell:removed', { cell, segments })
    this.#reverting = false
    await new hypercomb().act()
  }

  /** Revert a remove — emit `cell:added` so the children-slot
   *  subscriber re-includes the cell in the parent layer's children.
   *  No folder mint: the layer is authoritative. `revive: true` links
   *  the cell's existing bag head — bringing its subtree back is the
   *  point of this gesture, unlike a plain create (which resets the
   *  location to a fresh, childless tile). */
  async #revertRemove(cell: string): Promise<void> {
    const segments = this.#segments()
    this.#reverting = true
    EffectBus.emit('cell:added', { cell, segments, revive: true })
    this.#reverting = false
    await new hypercomb().act()
  }

  /** Where we are standing, as the revert emissions address it.
   *
   *  The component read `get('@hypercomb.social/Lineage')` and dereferenced
   *  it unguarded, so a missing Lineage threw and the revert never happened.
   *  Same outcome here, said out loud: an empty path is a LEGITIMATE value
   *  (you are at the root), so falling back to `[]` when the service is
   *  absent would silently revert at the wrong location — the one thing this
   *  gesture must never do. Throwing keeps `revertEntry`'s control flow
   *  identical too: the promise rejects, so the entry is NOT dismissed. */
  #segments(): string[] {
    const lineage = window.ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
    if (!lineage) throw new Error('activity-log: no Lineage — refusing to revert at an unknown location')
    return (lineage.explorerSegments?.() ?? []).map(s => String(s ?? ''))
  }

  // ── the two gestures ─────────────────────────────────────────────────

  /** ↩ — run the entry's inverse, then take the line away. Public because
   *  the original's was: an element is reachable through the DOM in a way an
   *  Angular component never was, and this is the feed's only real verb. */
  async revertEntry(id: number): Promise<void> {
    const entry = this.#entries.find(e => e.id === id)
    if (!entry?.revert) return
    await entry.revert()
    this.dismiss(id)
  }

  /** × — fade the line out, then drop it. Idempotent while fading, exactly
   *  as the original was (a second click during the 200ms does nothing). */
  dismiss(id: number): void {
    const entry = this.#entries.find(e => e.id === id)
    if (!entry || entry.fading) return

    if (entry.timer != null) { clearTimeout(entry.timer); this.#timers.delete(entry.timer) }
    entry.timer = null
    entry.fading = true
    // Toggles `.fading` on the LIVE row, which is what makes the opacity
    // transition run — see `#rows`.
    this.#render()

    this.#arm(() => {
      this.#entries = this.#entries.filter(e => e.id !== id)
      this.#render()
    }, FADE_MS)
  }

  /** Empty the feed at once. No caller in the shell today (the component's
   *  was unreferenced too), kept because it is one line and it is the only
   *  way to answer "make it stop". */
  clearAll(): void {
    for (const entry of this.#entries) {
      if (entry.timer != null) { clearTimeout(entry.timer); this.#timers.delete(entry.timer) }
      entry.timer = null
    }
    this.#entries = []
    this.#render()
  }

  /** setTimeout that remembers itself, so disconnect can drain everything. */
  #arm(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => { this.#timers.delete(timer); fn() }, ms)
    this.#timers.add(timer)
    return timer
  }

  // ── rendering ────────────────────────────────────────────────────────
  #render(): void {
    const panel = this.#panel
    if (!panel) return

    const list = this.#entries

    // `!(list.length > 0)`, NOT `list.length <= 0` — the polarity is
    // load-bearing. The Angular original showed the panel on
    // `hasEntries() === (entries().length > 0)`; both forms are false for a
    // non-numeric length, so the NEGATED comparison falls THROUGH and paints
    // an empty panel. Keep the original direction.
    if (!(list.length > 0)) {
      // Empty feed: @if MEANS DETACH. Angular removed the wrapper from the
      // DOM entirely, and a panel that is merely display:none still answers
      // querySelector — a contract an acceptance driver may assert on. Drop
      // the rows too: ids never repeat (the counter only goes up), so nothing
      // here is worth keeping alive.
      this.#rows.clear()
      panel.replaceChildren()
      panel.remove()
      return
    }

    // Departed rows leave FIRST, so the placement walk below never has to
    // step over a corpse — and therefore never moves a survivor.
    const alive = new Set(list.map(entry => entry.id))
    for (const [id, row] of this.#rows) {
      if (alive.has(id)) continue
      row.el.remove()
      this.#rows.delete(id)
    }

    // Back in, if it was out. Moving a live node, never re-creating it —
    // appendChild MOVES an existing child.
    if (panel.parentNode !== this) this.appendChild(panel)

    // Place every entry in data order (newest first — `#addEntry` prepends;
    // the panel's `column-reverse` puts that newest line at the BOTTOM). The
    // anchor walk SKIPS a row already sitting where it belongs, so a live
    // row is never re-inserted and its fade transition is never disturbed.
    let anchor: ChildNode | null = panel.firstChild
    for (const entry of list) {
      const row = this.#rows.get(entry.id) ?? this.#buildRow(entry)
      this.#rows.set(entry.id, row)
      // The only field that ever changes after an entry is added.
      row.el.classList.toggle('fading', entry.fading)
      if (anchor === row.el) { anchor = row.el.nextSibling; continue }
      panel.insertBefore(row.el, anchor)
    }
  }

  /** One line, built once. Detached — `#render` places it. */
  #buildRow(entry: ActivityEntry): Row {
    const el = document.createElement('div')
    el.className = 'activity-entry'

    // `@if (entry.revert)` — the arrow exists only where there is an inverse.
    let revert: HTMLButtonElement | null = null
    if (entry.revert) {
      revert = document.createElement('button')
      revert.type = 'button'
      revert.className = 'entry-revert'
      revert.textContent = '↩'  // &#x21A9;
      revert.title = t('activity.undo', 'Undo')
      revert.addEventListener('click', () => { void this.revertEntry(entry.id) })
      el.appendChild(revert)
    }

    const icon = document.createElement('span')
    icon.className = 'entry-icon'
    // Printed literally, as the template's `{{ entry.icon }}` did — emitters
    // send everything from '◈' to a Material Symbol name.
    icon.textContent = entry.icon
    el.appendChild(icon)

    const message = document.createElement('span')
    message.className = 'entry-message'
    message.textContent = entry.message
    el.appendChild(message)

    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.className = 'entry-dismiss'
    dismiss.textContent = '×'  // &times;
    dismiss.title = t('activity.dismiss', 'Dismiss')
    dismiss.addEventListener('click', () => { this.dismiss(entry.id) })
    el.appendChild(dismiss)

    return { el, revert, dismiss }
  }

  /** Re-resolve the two strings written at build time. Rows are deliberately
   *  not rebuilt (see `#rows`), so without this a feed that is already up
   *  keeps its previous-locale button titles until every line has expired. */
  #relabel(): void {
    const undo = t('activity.undo', 'Undo')
    const dismiss = t('activity.dismiss', 'Dismiss')
    for (const row of this.#rows.values()) {
      if (row.revert) row.revert.title = undo
      row.dismiss.title = dismiss
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts tags
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, ActivityLogElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/ActivityLogElement',
    element: SURFACE_NAME,
    order: 360,
  })
})
