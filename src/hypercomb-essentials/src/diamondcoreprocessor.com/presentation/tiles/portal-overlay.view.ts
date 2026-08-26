// portal-overlay.view.ts — THE PORTAL OVERLAY, the full-screen iframe the DCP
// installer lives in, as a framework-free custom element
// (everything-is-a-beehavior Phase 2: Angular panels leave the shell and ship
// as signed modules).
//
// A straight port of shared/ui/portal/portal-overlay.component: same surface
// name (hc-portal-overlay), same order band (230), the same window events in
// and out (`portal:open` / `portal:closed` / `dcp:embed-closed` /
// `actions:available`), the same postMessage protocol with the embedded
// installer, and the same one-button chrome. The participant sees the same
// overlay, delivered as a module instead of compiled into the shell.
//
// WHAT IT IS FOR. A portal is "leave the hive for a moment and come back":
// the DCP installer, meadowverse, hypercomb.com. Overwhelmingly it is the
// INSTALLER — a `portal:open` with `target:'dcp'` hands the installer a
// branch signature, a placement path, this client's identity and (for a code
// adopt) the sigs to pre-tick, all through the handoff URL hash, because
// nothing is shared across the origin boundary. The installer works inside
// its iframe and talks back over postMessage; this surface is the frame, the
// origin guard, the input lock and the way out.
//
// THE TWO SHAPES. A VISIBLE portal covers the canvas: backdrop, panel, gate
// lock, tool windows parked, an address breadcrumb saying which host you are
// looking at and one Done button that only ever LEAVES. A HEADLESS portal is
// the same install with no chrome at all — a 1px off-screen iframe, no lock,
// no parking — used by the inline adopt of a code-bearing feature so the
// install never takes over the screen. It auto-applies when the installer's
// config projections go quiet, and promotes itself to the visible installer
// if the installer never projects at all. Never a silent hung iframe.
//
// DONE MEANS LEAVE. The single button in the bar never saves and never
// installs, so it can never fail and strand the participant inside the
// overlay. Committing rides its own triggers — the installer's own
// `dcp:confirm`, or a headless install settling — and both funnel through
// beginApply(), which is the ONLY path that dispatches `actions:available`.
//
// LIFECYCLE NOTE. The Angular version wrapped both shapes in `@if (isOpen …)`,
// so nothing existed while no portal was up. A registry-fed element is mounted
// ONCE at boot and stays, so the chrome is built DETACHED and only attached
// while a portal is open. That is not cosmetic here: an iframe is discarded
// when it leaves the document and re-navigates when it comes back, which is
// exactly the semantics the `@if` had — and `display:none` would leave a
// full-screen z-index-90001 panel answering querySelector, which the share
// acceptance driver (`scripts/verify-share-flow.cjs`) reads directly.
//
// AND THE IFRAME IS NEVER REBUILT ON A RE-RENDER. `registry:snapshot` arrives
// repeatedly while the installer works — every one of them recomputes the
// pending diff and re-renders. Re-creating (or re-appending) the iframe on any
// of those would reload the installer mid-install and lose the participant's
// ticks. So the frames are KEPT nodes: their `src` is written only when the
// active URL actually changes, and attach/detach is guarded on the current
// parent (`appendChild` on an already-attached node is a remove-then-insert,
// which for an iframe means a reload).
//
// Its strings ship WITH it (portal.i18n.ts, extracted from all 14 shell
// catalogs) and register under the 'app' namespace, so every key resolves
// exactly as before — the Phase 2 catalog split, another slice.

import {
  EffectBus,
  I18N_IOC_KEY,
  attachWidgetZoom,
  getClientIdentity,
  parkWindows,
  unparkWindows,
  type I18nProvider,
} from '@hypercomb/core'
import { PORTAL_OVERLAY_TRANSLATIONS } from './portal-overlay.i18n.js'

const SURFACE_NAME = 'hc-portal-overlay'

const DEFAULT_PORTALS: Record<string, string> = {
  meadowverse: 'https://meadowverse.com',
  hypercomb: 'https://hypercomb.com',
}

const DCP_LOCAL_URL = 'http://localhost:2400'
const DCP_CANONICAL_URL = 'https://diamondcoreprocessor.com'

// Headless (invisible) DCP install timing.
const HEADLESS_FALLBACK_MS = 12000  // no config projected in time → promote to visible
const HEADLESS_SETTLE_MS = 1200     // config projections quiet this long → auto-apply

// Pending portal:open queue — requests that arrive while a headless install is
// in flight are DEFERRED (drained one at a time on close), never dropped.
const PENDING_OPENS_KEY = 'hc:portal-pending-opens'
const PENDING_OPEN_TTL_MS = 15 * 60_000  // a persisted entry older than this is stale — drop, don't surprise-install
const MAX_PENDING_OPENS = 8              // each code adopt needs its own consent click, so a real batch stays small
const RESUME_DELAY_MS = 4000             // post-boot grace before resuming a persisted install (drones registering)

/** The portal:open request payload. Also the pending-queue entry shape, so it
 *  must stay JSON-serializable — headless entries persist across the web
 *  shell's post-accept reload (main.ts reloadIfDrifted). */
interface PortalOpenRequest {
  target?: string; url?: string; branchSig?: string; at?: string; domain?: string; label?: string
  /** Invisible install (code adopt): run the DCP headless, pre-ticking the
   *  `stage` code sigs, and auto-apply once its config settles. */
  headless?: boolean; stage?: string[]
  /** Header upgrade-indicator handoff: WHICH package changed + the
   *  delta the installer marks for review. Notify-and-route only. */
  upgrade?: { packageSig?: string | null; newBees?: string[]; previous?: string | null }
}

/** Resolve the DCP installer URL.
 *
 *  ─── The full-split model ────────────────────────────────────────────
 *  The installer's CODE-SERVING role is decoupled from the mesh / storage
 *  / identity roles a host can play. Code comes from ONE canonical,
 *  project-maintained origin. Operator domains (jwize.com, alice.dev,
 *  etc.) play mesh / storage / identity roles but never serve installer
 *  code to participants. This makes the installer's trust surface a
 *  single auditable codebase regardless of which operator's swarm the
 *  participant came from.
 *
 *  Why: any host that serves the installer code can swap that code
 *  silently between visits. Trusting many operator-installers means
 *  trusting many separate code-update pipelines. Trusting ONE canonical
 *  installer means trusting ONE project — the protocol's home — which
 *  has much narrower change accountability and supports build-sig
 *  pinning + change detection (tasks #49, #50).
 *
 *  ─── Priority chain ──────────────────────────────────────────────────
 *   1. localStorage['portal:dcp']  → explicit pin (power-user override,
 *      also used by contributors who want to point at a specific build)
 *   2. Loopback origin             → DCP_LOCAL_URL so DCP-the-app can be
 *      developed locally with live reload. window.HYPERCOMB_DEV_HOST is
 *      intentionally NOT consulted here: under the full-split model,
 *      simulating an operator (mesh/storage at jwize.com) doesn't mean
 *      simulating jwize.com serving installer code. End-users on a real
 *      jwize.com would hit canonical for code anyway.
 *   3. Any real host              → DCP_CANONICAL_URL. The current page's
 *      origin tells us which OPERATOR's swarm the participant is on; it
 *      tells us nothing about which CODE should run. Code is always
 *      canonical.
 */
function resolveDcpUrl(): string {
  const host = window.location.hostname
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (isLocalHost) return DCP_LOCAL_URL
  return DCP_CANONICAL_URL
}

function resolvePortalUrl(target: string): string | undefined {
  const override = localStorage.getItem(`portal:${target}`)
  if (override) return override
  if (target === 'dcp') return resolveDcpUrl()
  return DEFAULT_PORTALS[target]
}

// Owner token for the InputGate lock held while the portal is open. Owner-
// scoped so it composes with locks held by the editor / other overlays.
const PORTAL_LOCK_OWNER = 'portal'

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc. */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

/** Structural type for the installer's projected config, resolved at runtime. */
type RegistrySnapshotStoreLike = {
  snapshot?: {
    branches?: { branchSig?: string; enabled?: boolean; kind?: string }[]
    logicalRootSig?: string | null
  } | null
}

// Same contract as the shell pipe. Neither of this surface's two keys takes
// parameters (they are whole labels: "done", "Pending changes"), so there is
// no interpolation to do — the fallback is the English catalog text, and a
// bare host with no i18n reads identically.
const t = (key: string, fallback: string): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t(key)
  if (value && value !== key) return value
  return fallback
}

// The portal's strings travel with it — registered as soon as the i18n
// service is up, under 'app' so the keys resolve exactly as they always did.
window.ioc?.whenReady?.(I18N_IOC_KEY, (i18n) => {
  const provider = i18n as I18nProvider
  for (const [locale, catalog] of Object.entries(PORTAL_OVERLAY_TRANSLATIONS)) {
    provider.registerTranslations('app', locale, catalog)
  }
})

// ── the styles the Angular SCSS carried, expanded to plain CSS ────────────
// No shadow DOM (the tutorial-overlay + landing-badge precedent), so Angular's
// `:host` becomes the tag name and every other selector is prefixed with it —
// nothing can leak out of the overlay. The host itself is `display:contents`:
// every child here is position:fixed, so it must never introduce a box.
//
// The SCSS `@use '../breakpoints' as *` mixins are expanded to the media
// queries they emit: `phone-only` → (max-width:599px), `tablet-only` →
// (min-width:600px) and (max-width:1023px).
//
// Angular's build autoprefixed; the two properties that relied on it get their
// -webkit- twins written by hand (`backdrop-filter` on the address crumb, and
// `user-select`, which is what makes the URL selectable). No @keyframes here,
// so nothing needs tag-scoping.
//
// Two z-indexes worth keeping the reasoning for: the backdrop at 90000 and the
// panel at 90001 sit BELOW the tool windows (100002), which is precisely why
// the visible portal parks them — otherwise an open features panel or notes
// strip floats over the installer.
const CSS = `
${SURFACE_NAME}{display:contents}
${SURFACE_NAME} .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:90000}
${SURFACE_NAME} .panel{position:fixed;inset:0;background:rgba(18,18,18,.82);overflow:hidden;z-index:90001}
${SURFACE_NAME} .portal-frame{width:100%;height:100%;min-width:0;min-height:0;border:0;display:block;opacity:.92}
${SURFACE_NAME} .portal-frame-headless{position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none}
${SURFACE_NAME} .portal-address{position:absolute;top:1rem;right:1rem;display:flex;align-items:center;gap:.5rem;padding:.4rem .85rem;background:rgba(14,18,24,.78);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.08);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.4);color:rgba(245,245,245,.85);font-family:var(--hc-mono);font-size:.62rem;font-weight:600;letter-spacing:.08em;text-transform:lowercase;pointer-events:auto;-webkit-user-select:text;user-select:text;max-width:60%;overflow:hidden}
${SURFACE_NAME} .address-dot{width:6px;height:6px;border-radius:50%;background:rgba(200,151,90,.9);flex-shrink:0}
${SURFACE_NAME} .address-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${SURFACE_NAME} .portal-actions{position:absolute;bottom:1.2rem;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:1rem;pointer-events:none}
${SURFACE_NAME} .portal-apply{display:flex;align-items:center;gap:.5rem;padding:.55rem 1.6rem;background:rgba(200,151,90,.92);border:1px solid rgba(200,151,90,.95);border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:var(--hc-mono);cursor:pointer;pointer-events:auto;transition:transform 200ms ease,background 200ms ease,border-color 200ms ease}
${SURFACE_NAME} .portal-apply:hover{background:rgba(212,164,102,1);border-color:rgba(212,164,102,1)}
${SURFACE_NAME} .portal-apply:active{transform:scale(.97)}
${SURFACE_NAME} .apply-label{font-size:.62rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#161616}
${SURFACE_NAME} .portal-diff{display:flex;align-items:center;gap:.5rem;font-family:var(--hc-mono);font-size:.8rem;font-weight:700;font-variant-numeric:tabular-nums;pointer-events:none}
${SURFACE_NAME} .diff-add{color:#6ec96e}
${SURFACE_NAME} .diff-remove{color:#d98a8a}
@media (max-width:599px){${SURFACE_NAME} .portal-actions{bottom:calc(1.2rem + var(--hc-safe-bottom,0px))}${SURFACE_NAME} .portal-apply{padding:.7rem 1.6rem}${SURFACE_NAME} .apply-label{font-size:.7rem}}
@media (min-width:600px) and (max-width:1023px){${SURFACE_NAME} .portal-actions{bottom:calc(1rem + var(--hc-safe-bottom,0px))}${SURFACE_NAME} .portal-apply{padding:.6rem 1.5rem}}
`

let cssInstalled = false
const installCss = (): void => {
  if (cssInstalled) return
  cssInstalled = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-portal-overlay', '')
  style.textContent = CSS
  document.head.appendChild(style)
}

export class PortalOverlayElement extends HTMLElement {

  // ── subscriptions + timers (all drained on disconnect) ────────────────
  #offs: Array<() => void> = []
  #detachZoom: (() => void) | null = null
  #headlessFallbackTimer: number | null = null
  #headlessApplyTimer: number | null = null
  /** The post-boot grace before a persisted headless install resumes. */
  #resumeTimer: number | null = null
  /** The macrotask that drains the next queued open after a close. */
  #drainTimer: number | null = null

  // ── open state ─────────────────────────────────────────────────────────
  #isOpen = false
  #activeUrl: string | null = null
  #activeTarget: string | null = null

  /** Pending membership changes shown to the LEFT of the Done button:
   *  the installer's enabled content branches vs what's actually folded into
   *  the hive (the recoverable `hc:last-folded` receipt). adds = enabled but
   *  not yet folded; removes = folded but now disabled. Recomputed as the
   *  installer pushes snapshots while the portal is open; applied on close
   *  (which folds/un-folds via SwarmAdoptDrone). */
  #pendingAdds = 0
  #pendingRemoves = 0

  /** Pending PACKAGE / code change. The +adds/−removes above only track
   *  `kind:'content'` adoptions, so a pure functionality opt-in — enabling new
   *  bees/workers/drones inside a `kind:'package'` branch, which is exactly what
   *  the header "New features" upgrade flow routes here to do — produced NO
   *  content diff, so nothing read the change as committable and it could only be
   *  discarded. We detect it by baselining the installer's
   *  `logicalRootSig` when the portal opens and flagging when a later projection
   *  differs. Same value-space on both sides (logicalRootSig vs logicalRootSig),
   *  so there are no cross-namespace false positives. Counts as pending alongside
   *  the content diff; the accept → `actions:available` already resyncs the
   *  package.
   *
   *  The baseline is `undefined` until a projection is SEEN and `null` when the
   *  seen projection is an EMPTY install. Those must stay distinct: on a hive
   *  with nothing installed yet the installer projects `logicalRootSig: null`,
   *  so collapsing both onto `null` made the participant's FIRST opt-in look
   *  like the still-missing baseline — it was absorbed instead of flagged, and
   *  a first-run install read as having nothing to commit (only a second change
   *  surfaced it). Presence of a snapshot, not truthiness of the sig, is the
   *  signal. */
  #pendingPackageChange = false
  #openLogicalBaseline: string | null | undefined = undefined

  /** Headless (invisible) install: the DCP runs in an off-screen iframe with no
   *  chrome and no gate lock, resolves + installs the branch's staged code
   *  nodes, and we auto-apply once its config projections go quiet. Used by the
   *  inline adopt of a CODE-bearing feature so the install never takes over the
   *  screen. Promotes to the visible installer if the DCP never projects. */
  #headless = false

  /** The request behind the currently-open portal — kept for the per-branch
   *  outcome messages (activity:log) a headless install must say out loud. */
  #activeRequest: PortalOpenRequest | null = null

  /** Deferred portal:open requests (see the in-flight guard in #onPortalOpen).
   *  Drained one at a time from close(); headless entries also persist to
   *  localStorage so the web shell's post-accept reload can't eat the rest of
   *  an Adopt-All batch. */
  #pendingOpens: { ts: number; detail: PortalOpenRequest }[] = []
  /** True while #drainPendingOpens is re-dispatching the queue head — lets the
   *  open path know the new portal came off the queue (`#openWasQueued`). */
  #dispatchingQueued = false
  /** The open portal came off the queue: its entry stays at the queue head
   *  until close() (terminal), so a mid-install reload resumes it next boot. */
  #openWasQueued = false
  /** Set by #finishApply() around close() so the outcome message can
   *  distinguish an accepted headless install from a discarded one. */
  #applyInProgress = false

  /** The restore point NAME the installer typed, relayed to the fold in the
   *  accept event (`dcp:restore-point` → `actions:available`). One typed name
   *  covers both sides; nothing here takes a snapshot. */
  restorePointName = 'Default'
  #restorePointNamedByDcp = false

  /** Did WE park? Only then do we bring them back — a portal that opened over
   *  an empty screen has nothing to restore, and must not restore someone
   *  else's. */
  #parkedWindows = false

  // ── chrome (built once, attached/detached — never rebuilt) ─────────────
  #headlessFrame: HTMLIFrameElement | null = null
  #backdrop: HTMLDivElement | null = null
  #panel: HTMLDivElement | null = null
  #frame: HTMLIFrameElement | null = null
  #address: HTMLDivElement | null = null
  #addressText: HTMLSpanElement | null = null
  #actions: HTMLDivElement | null = null
  #diff: HTMLDivElement | null = null
  #doneButton: HTMLButtonElement | null = null
  #doneLabel: HTMLSpanElement | null = null

  /** What each kept iframe is currently pointed at. Writing `src` is what
   *  RELOADS an attached iframe, so it is written only on a real change. */
  #frameUrl: string | null = null
  #headlessFrameUrl: string | null = null

  // -------------------------------------------------
  // public surface (the component's shape, preserved)
  // -------------------------------------------------
  /** Full URL of the currently-loaded iframe content, for the title-attr tooltip. */
  get activeUrl(): string | null { return this.#activeUrl }

  /** Is there ANYTHING to commit — content adoptions/removals OR a package /
   *  code change? Read by whatever triggers a commit; the bar's Done button
   *  never consults it, because Done only leaves. Counting the package change
   *  as well is what makes a pure functionality opt-in (new bees enabled
   *  inside a package, no content diff) committable at all. */
  get hasPendingCommit(): boolean {
    return !!(this.#pendingAdds || this.#pendingRemoves || this.#pendingPackageChange)
  }

  /** Human-friendly host label for the address breadcrumb. Shows the host
   *  + first 6 of branchSig + the placement path so the participant always
   *  sees "where am I, what am I about to adopt, and where will it land."
   *  Example: "jwize.com · branch=a1b2c3 · /room/sub" */
  get addressLabel(): string {
    const url = this.#activeUrl
    if (!url) return ''
    try {
      const u = new URL(url)
      let label = u.hostname
      const hashParams = new URLSearchParams(u.hash.replace(/^#/, ''))
      // Prefer the human tile name when the hive threaded one through; fall
      // back to the branch-sig prefix so a domainless/nameless adoption still
      // reads "what am I about to adopt."
      const tileName = (hashParams.get('label') ?? '').trim()
      const branch = hashParams.get('branch')
      if (tileName) {
        label += ` · adopting “${tileName}”`
      } else if (branch && /^[a-f0-9]{64}$/i.test(branch)) {
        label += ` · branch=${branch.slice(0, 6)}`
      }
      const at = hashParams.get('at')
      if (at !== null) {
        const segments = at.split(',').filter(Boolean)
        const path = segments.length > 0 ? '/' + segments.join('/') : '/'
        label += ` · ${path}`
      }
      return label
    } catch { return url }
  }

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------
  connectedCallback(): void {
    installCss()
    this.#build()

    window.addEventListener('portal:open', this.#onPortalOpen)
    window.addEventListener('message', this.#onMessage)

    this.#offs.push(
      // A HEADLESS portal is invisible — Escape / a touch-drag is aimed at
      // something the user can see, and closing here would silently kill the
      // in-flight install. Once promoted to visible, both dismiss as usual.
      //
      // ESCAPE SPELLING (the Phase 2 rule): the original did NOT bind
      // `@HostListener('document:keydown.escape')`, so it never had Angular's
      // KeyEventsPlugin modifier semantics and must NOT grow a
      // ctrl/alt/shift/meta guard. It subscribed to the CENTRALIZED cascade
      // (`global:escape`, emitted by keyboard/escape-cascade.ts only once every
      // higher-priority consumer has declined) — the cascade owns which
      // presses count, and this surface stays its plain fallback consumer.
      //
      // `global:escape` last-value-replays at subscribe time, but the replay
      // is harmless by construction: the guard is `#isOpen`, and nothing is
      // open at connect. A replay can never open a portal here — only
      // `portal:open`, a window event with no replay, can.
      EffectBus.on('global:escape', () => {
        if (this.#isOpen && !this.#headless) this.close()
      }),
      // `touch:dragging` is a STATE TRANSITION, not a per-frame stream: the
      // gesture coordinator de-dupes it (`#emitDragging` returns early when
      // the flag has not changed), so this fires once at drag start and once
      // at drag end. Payload made optional (`p?.active`) purely so a replay of
      // an empty payload cannot throw out of the subscribe call; the
      // truthiness test is the original's, unchanged.
      EffectBus.on<{ active?: boolean }>('touch:dragging', (p) => {
        if (p?.active && this.#isOpen && !this.#headless) this.close()
      }),
      // Installer pushed a new config while the portal is open → refresh the
      // pending +adds/−removes next to the Done button. Idempotent by
      // construction: #recomputeDiff RECOUNTS from the snapshot and the
      // folded receipt rather than accumulating, so the same snapshot
      // delivered twice (the emit, then a post-commit reconcile) lands the
      // same two numbers. Nothing in this panel appends except the pending-open
      // queue, which is fed by a window event, not by an effect.
      EffectBus.on('registry:snapshot', () => this.#recomputeDiff()),
      // THE PIPE WAS IMPURE. The Angular original resolved `portal.done` and
      // `portal.pending-changes` through the `t` pipe, declared `pure:false`,
      // so every change-detection tick re-read them and `/language ja`
      // re-labelled an OPEN portal on the spot. An element renders when it
      // decides to, so the locale switch has to BE a reason to render —
      // otherwise the only button in the overlay keeps its old-locale label
      // for as long as the install lasts.
      EffectBus.on('locale:changed', () => this.#render()),
    )

    // Headless installs the last session queued but never ran (the web shell
    // reloads after each accepted install) resume here.
    this.#restorePendingOpens()
    this.#render()
  }

  disconnectedCallback(): void {
    window.removeEventListener('portal:open', this.#onPortalOpen)
    window.removeEventListener('message', this.#onMessage)
    this.#offs.forEach(off => off())
    this.#offs = []
    this.#detachZoom?.()
    this.#detachZoom = null
    this.#clearHeadlessTimers()
    if (this.#resumeTimer !== null) { window.clearTimeout(this.#resumeTimer); this.#resumeTimer = null }
    if (this.#drainTimer !== null) { window.clearTimeout(this.#drainTimer); this.#drainTimer = null }
    // Release on teardown so a portal destroyed while open never leaves the
    // hexes locked — or the participant's windows put away with nothing left
    // to bring them back.
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    this.#unparkWindows()
    // Take the chrome back out; the nodes are kept so a re-connect reuses them
    // (the #build() guard) and the zoom re-attaches.
    this.#headlessFrame?.remove()
    this.#backdrop?.remove()
    this.#panel?.remove()
    this.#frameUrl = null
    this.#headlessFrameUrl = null
  }

  // -------------------------------------------------
  // chrome — built ONCE, then only attached / detached
  // -------------------------------------------------
  #build(): void {
    if (this.#panel) {
      // Re-connected after a disconnect: the nodes survived, the zoom
      // subscription did not (it was drained with the rest).
      if (!this.#detachZoom) this.#detachZoom = attachWidgetZoom(this.#panel, 'portal', 'center')
      return
    }

    // Headless install iframe — kept in the layout (so it LOADS and its
    // scripts RUN) but off-screen and inert. NOT display:none, which some
    // engines throttle. aria-hidden + tabindex=-1: an invisible install must
    // never be reachable by a screen reader or by Tab.
    const headlessFrame = document.createElement('iframe')
    headlessFrame.className = 'portal-frame-headless'
    headlessFrame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin')
    headlessFrame.setAttribute('referrerpolicy', 'no-referrer')
    headlessFrame.setAttribute('aria-hidden', 'true')
    headlessFrame.setAttribute('tabindex', '-1')
    this.#headlessFrame = headlessFrame

    const backdrop = document.createElement('div')
    backdrop.className = 'backdrop'
    // A passive exit. Same terminal path as Escape, a touch-drag and Done —
    // close() is the one place that answers, and it answers exactly once.
    backdrop.addEventListener('click', () => this.close())
    this.#backdrop = backdrop

    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'dialog')
    // Wheel over the installer must not reach the hive's zoom (the zoom drone
    // walks `.closest('[data-consumes-wheel]')`).
    panel.setAttribute('data-consumes-wheel', '')
    this.#panel = panel
    // `hcWidget="portal" anchor="center"` — the Angular directive is now a
    // thin adapter over this core function, so the converted element and the
    // still-Angular panels zoom through the SAME code and the same persisted
    // scale. Attached to the KEPT panel node and torn down on disconnect: the
    // subscription is what reflects a live scale change, and the node outlives
    // any single open.
    this.#detachZoom = attachWidgetZoom(panel, 'portal', 'center')

    const frame = document.createElement('iframe')
    frame.className = 'portal-frame'
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    this.#frame = frame
    panel.appendChild(frame)

    // Iframe-address breadcrumb. Matches the top-right corner where the
    // install-crumb sits in the underlying shell so the participant has
    // continuous awareness of "which host am I looking at right now."
    const address = document.createElement('div')
    address.className = 'portal-address'
    const dot = document.createElement('span')
    dot.className = 'address-dot'
    const addressText = document.createElement('span')
    addressText.className = 'address-text'
    address.append(dot, addressText)
    this.#address = address
    this.#addressText = addressText

    // Bottom action bar — ONE button: Done, and Done means LEAVE. It never
    // saves and never installs, so it can never fail and strand the
    // participant in the overlay. Same exit as the backdrop, Escape and a
    // touch-drag. The pending diff isn't lost — DCP keeps it and re-surfaces
    // it next open; committing rides its own triggers, outside this bar.
    const actions = document.createElement('div')
    actions.className = 'portal-actions'
    this.#actions = actions

    const diff = document.createElement('div')
    diff.className = 'portal-diff'
    this.#diff = diff

    const doneButton = document.createElement('button')
    doneButton.className = 'portal-apply'
    doneButton.type = 'button'
    doneButton.addEventListener('click', () => this.done())
    const doneLabel = document.createElement('span')
    doneLabel.className = 'apply-label'
    doneButton.appendChild(doneLabel)
    this.#doneButton = doneButton
    this.#doneLabel = doneLabel
    // The ONE focusable thing in the overlay, and it is kept for the life of
    // the element: a re-render on every registry:snapshot must not move the
    // focus ring off the only way out.
    actions.appendChild(doneButton)
    panel.appendChild(actions)
  }

  // -------------------------------------------------
  // rendering — attach / detach, never rebuild
  // -------------------------------------------------
  // Replaces the Angular original's #cdr.detectChanges(). Everything mutable
  // here is a text node or an attribute; the iframes, the panel and the Done
  // button are KEPT nodes whose parentage is checked before any move, because
  // `appendChild` on an already-attached node is a remove-then-insert — which
  // for an iframe discards its browsing context and reloads the installer.
  #render(): void {
    const headlessFrame = this.#headlessFrame
    const backdrop = this.#backdrop
    const panel = this.#panel
    const frame = this.#frame
    if (!headlessFrame || !backdrop || !panel || !frame) return

    const url = this.#activeUrl

    // ── @if (isOpen && headless) ───────────────────────────────────────
    if (this.#isOpen && this.#headless && url) {
      // src BEFORE insertion: inserting an iframe navigates it to whatever
      // `src` currently says.
      if (this.#headlessFrameUrl !== url) { headlessFrame.src = url; this.#headlessFrameUrl = url }
      if (headlessFrame.parentNode !== this) this.insertBefore(headlessFrame, this.firstChild)
    } else if (headlessFrame.parentNode) {
      headlessFrame.remove()
      this.#headlessFrameUrl = null
    }

    // ── @if (isOpen && !headless) ──────────────────────────────────────
    // The original's predicate, copied rather than negated.
    if (!(this.#isOpen && !this.#headless && url)) {
      backdrop.remove()
      panel.remove()
      this.#frameUrl = null
      return
    }

    if (this.#frameUrl !== url) { frame.src = url; this.#frameUrl = url }
    if (backdrop.parentNode !== this) this.appendChild(backdrop)
    if (panel.parentNode !== this) this.appendChild(panel)

    // ── @if (addressLabel) — the breadcrumb genuinely leaves the DOM ────
    // `scripts/verify-share-flow.cjs` reads
    // `hc-portal-overlay .portal-address .address-text` and treats absence as
    // "no breadcrumb", so display:none would be a lie to the acceptance run.
    const address = this.#address
    const addressText = this.#addressText
    const actions = this.#actions
    if (address && addressText && actions) {
      const label = this.addressLabel
      if (label) {
        addressText.textContent = label
        address.setAttribute('title', this.#activeUrl ?? '')
        if (address.parentNode !== panel) panel.insertBefore(address, actions)
      } else {
        address.remove()
      }
    }

    // ── @if (pendingAdds || pendingRemoves) ────────────────────────────
    // Truthiness, exactly as the template had it — including the two inner
    // guards. Re-deriving these as `=== 0` / `<= 0` would fall through for a
    // NaN out of a malformed snapshot and paint a "+NaN" chip.
    const diff = this.#diff
    const doneButton = this.#doneButton
    if (diff && doneButton && actions) {
      if (this.#pendingAdds || this.#pendingRemoves) {
        const parts: HTMLElement[] = []
        if (this.#pendingAdds) {
          const add = document.createElement('span')
          add.className = 'diff-add'
          add.textContent = `+${this.#pendingAdds}`
          parts.push(add)
        }
        if (this.#pendingRemoves) {
          const removed = document.createElement('span')
          removed.className = 'diff-remove'
          // `&minus;` in the original template — U+2212, not a hyphen.
          removed.textContent = `−${this.#pendingRemoves}`
          parts.push(removed)
        }
        // Display-only (pointer-events:none, nothing focusable), so rebuilding
        // its two chips on every snapshot costs nothing.
        diff.replaceChildren(...parts)
        diff.setAttribute('aria-label', t('portal.pending-changes', 'Pending changes'))
        // Left of the Done button, which never moves.
        if (diff.parentNode !== actions) actions.insertBefore(diff, doneButton)
      } else {
        diff.remove()
        diff.replaceChildren()
      }
    }

    // Re-resolved on every render — the impure-pipe rule's whole point.
    if (this.#doneLabel) this.#doneLabel.textContent = t('portal.done', 'done')
  }

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  readonly #onPortalOpen = (e: Event): void => {
    const detail = (e as CustomEvent).detail as PortalOpenRequest | null
    let url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    // In-flight guard: a HEADLESS install is running off-screen (no chrome, the
    // user can't see it). A second portal:open — e.g. the next code pick in an
    // Adopt-All batch — must NOT tear it down: rebinding the iframe src and
    // clearing its timers would silently drop the in-flight install. And an
    // incoming HEADLESS request must never hijack a VISIBLE session the user is
    // mid-review in. Either way the request is QUEUED, not dropped — close()
    // drains the queue one install at a time (promoting a stalled headless
    // install to visible still works exactly as before).
    if (this.#isOpen && (this.#headless || detail?.headless === true)) {
      this.#enqueueOpen(detail)
      return
    }

    // Hand off the branchSig + placement location to the embedded installer
    // via URL hash so the installer's load-time handler can pick them up
    // and render a branch section without any cross-origin messaging.
    //
    // Per the natural-placement model (Option A confirmed): the sig says
    // WHAT, the `at` path says WHERE. The path is the participant's
    // navigation location at the moment of click — where the witness
    // view's union showed the peer's tile, and the host's hierarchy will
    // grow the adopted content at the same coordinate. No installer
    // organization step; the gesture IS the placement.
    if (detail?.branchSig) {
      const sig = String(detail.branchSig).trim().toLowerCase()
      if (/^[a-f0-9]{64}$/.test(sig)) {
        // Preserve any existing hash fragment by appending with `&`.
        url += (url.includes('#') ? '&' : '#') + `branch=${sig}`
        if (detail?.at !== undefined) {
          url += `&at=${encodeURIComponent(String(detail.at))}`
        }
        // The publisher's domain — WHERE the installer HTTP-direct-fetches
        // the adopted content's resources from (the byte path). Empty for a
        // domainless browser-only publisher.
        if (detail?.domain) {
          url += `&domain=${encodeURIComponent(String(detail.domain))}`
        }
        // The human tile name — purely a display label so the installer's
        // breadcrumb + section header read "adopting <name>" instead of a
        // sig prefix. Never used for resolution (the sig is canonical).
        if (detail?.label) {
          url += `&label=${encodeURIComponent(String(detail.label))}`
        }
      }
    }

    // Upgrade handoff — the header upgrade indicator routes the changed
    // package here so the installer lands on it and marks the changed items
    // (off + highlighted) for review/opt-in. `upgrade=<packageSig>` says WHICH
    // package; `new=<sig,sig,…>` is the changed-sig delta the hive computed;
    // `previous=<sig>` is the walkback link the installer diffs against when
    // the explicit list is absent. No bytes, no install — just where to look.
    if (detail?.upgrade && (detail?.target ?? '') === 'dcp') {
      const pkg = String(detail.upgrade.packageSig ?? '').trim().toLowerCase()
      if (/^[a-f0-9]{64}$/.test(pkg)) {
        url += (url.includes('#') ? '&' : '#') + `upgrade=${pkg}`
        const prev = String(detail.upgrade.previous ?? '').trim().toLowerCase()
        if (/^[a-f0-9]{64}$/.test(prev)) url += `&previous=${prev}`
        // Cap the explicit list so the hash never grows pathological; the
        // installer falls back to the previous-version walkback for the rest.
        const sigs = (Array.isArray(detail.upgrade.newBees) ? detail.upgrade.newBees : [])
          .map(s => String(s ?? '').trim().toLowerCase())
          .filter(s => /^[a-f0-9]{64}$/.test(s))
          .slice(0, 80)
        if (sigs.length) url += `&new=${sigs.join(',')}`
      }
    }

    // Client identity — WHICH install is talking. Every isolated storage
    // world (each browser, each native --instance) is a distinct client that
    // may run a different package version; DCP keeps a registry of the
    // clients it has seen so installs can be told apart and managed from one
    // place. Identity travels in the handoff URL because no storage is
    // shared across clients. Display metadata only — never resolution.
    if ((detail?.target ?? '') === 'dcp') {
      const client = getClientIdentity()
      url += (url.includes('#') ? '&' : '#')
        + `client=${client.id}`
        + `&clientName=${encodeURIComponent(client.name)}`
        + `&clientPlatform=${client.platform}`
      // The relay-aggregated roster (ClientPresenceDrone writes it): the
      // participant's OTHER client installs — other browsers, native
      // instances — so DCP can list clients this browser has never opened
      // it from. Compact + capped so the hash stays sane. The data contract
      // is the localStorage record, not an import. Self is already carried
      // above, so it's excluded here.
      try {
        const roster = JSON.parse(localStorage.getItem('hc:clients:roster') ?? '[]')
        const others = (Array.isArray(roster) ? roster : [])
          .filter((r: { id?: string }) => /^[a-f0-9]{64}$/.test(String(r?.id ?? '')) && r.id !== client.id)
          .slice(0, 12)
          // `s` is the install's OWN last-seen (epoch ms, straight off the
          // presence record). Without it DCP has to stamp every roster entry
          // "now" on each handoff, and an install that went quiet months ago
          // stays indistinguishable from the one you are running right now.
          .map((r: { id: string; name?: string; platform?: string; packageSig?: string; lastSeen?: number }) => ({
            i: r.id, n: String(r.name ?? '').slice(0, 60), p: String(r.platform ?? '').slice(0, 20),
            ...(typeof r.packageSig === 'string' && /^[a-f0-9]{64}$/.test(r.packageSig) ? { k: r.packageSig } : {}),
            ...(Number.isFinite(r.lastSeen) && (r.lastSeen as number) > 0 ? { s: r.lastSeen } : {}),
          }))
        if (others.length) url += `&clients=${encodeURIComponent(JSON.stringify(others))}`
      } catch { /* roster unreadable — self still travels */ }
    }

    // Explicit stage sigs → installer pre-tick. A headless code adopt hands
    // the branch's bee/dep sigs in `detail.stage`; DCP's #processStageHash
    // ticks the matching nodes ON by default. Nothing folds until the accept —
    // this only sets checkbox state. Capped so the hash never grows
    // pathological (DCP falls back gracefully).
    if ((detail?.target ?? '') === 'dcp') {
      const sigs = [...new Set(
        (Array.isArray(detail?.stage) ? detail.stage : [])
          .map(s => String(s ?? '').trim().toLowerCase())
          .filter(s => /^[a-f0-9]{64}$/.test(s)),
      )].slice(0, 80)
      if (sigs.length) url += (url.includes('#') ? '&' : '#') + `stage=${sigs.join(',')}`
    }

    this.#activeUrl = url
    this.#activeTarget = detail?.target ?? null
    this.#activeRequest = detail
    this.#openWasQueued = this.#dispatchingQueued
    // Baseline the installer's logical config at open so a package/code opt-in
    // made while the portal is up surfaces a pending commit (see
    // #pendingPackageChange).
    this.#openLogicalBaseline = this.#snapshotLogicalRootSig()
    this.#pendingPackageChange = false
    this.#restorePointNamedByDcp = false
    this.#isOpen = true
    this.#headless = detail?.headless === true && (detail?.target ?? '') === 'dcp'
    if (this.#headless) {
      // Invisible install — NO gate lock (tiles stay interactive behind the
      // off-screen iframe) and NO chrome. If the DCP never projects a config in
      // time (slow / stuck / unresolved) we promote to the visible installer so
      // the participant can finish by hand — never a silent hung iframe.
      this.#clearHeadlessTimers()
      this.#headlessFallbackTimer = window.setTimeout(() => this.#promoteHeadlessToVisible(), HEADLESS_FALLBACK_MS)
    } else {
      // Freeze tile navigation while the visible installer covers the canvas —
      // per the "modals lock tiles while showing" rule no pan/pinch/wheel-zoom/
      // drag-select may bleed through behind it. Released in close() (every
      // passive exit funnels there) and on disconnect. Resolved lazily because
      // the gate's bee may register after this element connects on web.
      this.#gate()?.lock(PORTAL_LOCK_OWNER)
      // …and put the tool windows away. They dock ABOVE this overlay (z-index
      // 100002 vs 90000), so an open features panel or notes strip would go on
      // floating over the installer. PARKED, not closed: unparked in close(),
      // so coming back to the hive finds them exactly as they were left.
      this.#parkWindows()
    }
    this.#recomputeDiff()   // also calls #render()
  }

  /** Recompute the pending +adds/−removes shown next to the Done button.
   *  Reads the installer's enabled CONTENT branches (RegistrySnapshot, pushed
   *  over postMessage) and the hive's recoverable folded receipt
   *  (`hc:last-folded`, written by SwarmAdoptDrone). Pure read — never mutates. */
  readonly #recomputeDiff = (): void => {
    let adds = 0, removes = 0
    try {
      const SIG = /^[a-f0-9]{64}$/
      const store = window.ioc?.get?.('@hypercomb.social/RegistrySnapshot') as RegistrySnapshotStoreLike | undefined
      const branches = store?.snapshot?.branches ?? []
      const desired = new Set(
        branches
          .filter(b => !!b && b.enabled !== false && (b.kind ?? 'content') === 'content'
            && typeof b.branchSig === 'string' && SIG.test(b.branchSig.toLowerCase()))
          .map(b => b.branchSig!.toLowerCase()),
      )
      const folded = new Set<string>()
      try {
        const raw = localStorage.getItem('hc:last-folded')
        const arr = raw ? JSON.parse(raw) : []
        if (Array.isArray(arr)) for (const e of arr) {
          const s = String((e as { sig?: string })?.sig ?? '').toLowerCase()
          if (s) folded.add(s)
        }
      } catch { /* no receipt yet — everything desired counts as an add */ }
      for (const s of desired) if (!folded.has(s)) adds++
      for (const s of folded) if (!desired.has(s)) removes++
    } catch { adds = 0; removes = 0 }
    this.#pendingAdds = adds
    this.#pendingRemoves = removes
    // Package/code drift: compare the installer's current logicalRootSig to the
    // baseline captured on open. The first non-null projection after open
    // becomes the baseline (so the initial render is never a false "change"),
    // and only a SUBSEQUENT, different projection — the participant enabling a
    // new bee/worker/drone — flags a pending commit.
    const cur = this.#snapshotLogicalRootSig()
    if (this.#openLogicalBaseline === undefined && cur !== undefined) this.#openLogicalBaseline = cur
    this.#pendingPackageChange =
      this.#openLogicalBaseline !== undefined && cur !== undefined && cur !== this.#openLogicalBaseline
    this.#render()
  }

  /** The installer's current logical-config root signature (lowercased).
   *
   *  Three-valued on purpose — an EMPTY install and a MISSING projection are
   *  different facts and the baseline comparison depends on telling them apart:
   *    undefined — no snapshot projected yet (nothing known)
   *    null      — a snapshot exists and the logical install is empty
   *    string    — the projected root sig */
  #snapshotLogicalRootSig(): string | null | undefined {
    const store = window.ioc?.get?.('@hypercomb.social/RegistrySnapshot') as RegistrySnapshotStoreLike | undefined
    const snapshot = store?.snapshot
    if (!snapshot) return undefined
    const sig = snapshot.logicalRootSig
    return typeof sig === 'string' && sig ? sig.toLowerCase() : null
  }

  // -------------------------------------------------
  // iframe → parent messages
  // -------------------------------------------------
  readonly #onMessage = (e: MessageEvent): void => {
    if (!this.#activeUrl) return
    const expectedOrigin = new URL(this.#activeUrl).origin

    // enforce origin boundary
    if (e.origin !== expectedOrigin) return

    const data = e.data as { type?: string; name?: string } | null
    if (!data?.type) return

    switch (data.type) {
      case 'dcp:restore-point': {
        const name = String(data.name ?? '').trim()
        if (name) {
          this.restorePointName = name
          this.#restorePointNamedByDcp = true
          this.#render()
        }
        break
      }

      case 'portal:confirm':
      case 'dcp:confirm':
        // Iframe-initiated accept — the installer committing from inside
        // (its ADOPT), which is the ONLY visible path that installs.
        this.beginApply()
        break

      case 'portal:cancel':
      case 'dcp:cancel':
        this.close()
        break

      // #62: registry snapshot from the DCP installer (control plane) →
      // the hive (data plane). Re-emit on EffectBus (last-value replay, so
      // late subscribers get it) so the consumer surface can use `logical`
      // as a render filter — show/activate only effectively-installed
      // content — and direct-fetch the bytes itself. Origin already
      // enforced above (must match the installer iframe's origin).
      case 'hc:registry-snapshot':
        EffectBus.emit('registry:snapshot', data)
        // Headless install: the DCP resolved the branch + ticked its staged
        // nodes and is projecting config — auto-apply once that goes quiet.
        if (this.#headless) this.#scheduleHeadlessApply()
        break
    }
  }

  // -------------------------------------------------
  // headless (invisible) install
  // -------------------------------------------------
  /** Apply once the DCP's config projections go quiet — branch resolved, staged
   *  nodes ticked, nothing new arriving. Debounced so a burst of snapshots
   *  settles to ONE accept (fold + resync), then the off-screen iframe tears
   *  down. Also cancels the "never projected" fallback. */
  #scheduleHeadlessApply(): void {
    // Do NOT clear #headlessFallbackTimer here — it stays armed as a HARD ceiling
    // so an install that never quiesces (a hypothetical sustained snapshot
    // stream) promotes to the visible installer instead of hanging invisibly.
    // On a normal install the settle timer below fires beginApply() first, and
    // close() clears both timers.
    if (this.#headlessApplyTimer !== null) window.clearTimeout(this.#headlessApplyTimer)
    this.#headlessApplyTimer = window.setTimeout(() => {
      this.#headlessApplyTimer = null
      if (this.#headless) this.beginApply()
    }, HEADLESS_SETTLE_MS)
  }

  /** The DCP never projected a config in time — surface the installer VISIBLY so
   *  the participant can finish the install by hand. Never a silent hung iframe. */
  readonly #promoteHeadlessToVisible = (): void => {
    if (!this.#headless) return
    this.#clearHeadlessTimers()
    this.#headless = false
    this.#gate()?.lock(PORTAL_LOCK_OWNER)
    // It is a visible installer from here on, so the tool windows go away —
    // a headless install never touched them, because nothing covered the hive.
    this.#parkWindows()
    // The off-screen frame leaves the DOM and the visible one comes in with
    // the same handoff URL, which reloads the install into the panel — the
    // same thing Angular's two `@if` blocks did by destroying one iframe and
    // creating the other.
    this.#recomputeDiff()   // → #render(): the visible panel now paints
    // Say WHY the installer suddenly appeared — the install was invisible
    // until now, so the promotion needs a visible cause. Emitted AFTER our own
    // render, matching the original's ordering against the activity-log
    // handler (which ticked the whole Angular app).
    EffectBus.emit('activity:log', {
      message: `the install of ${this.#requestLabel(this.#activeRequest)} needs attention — opening the installer`, icon: '◈',
    })
  }

  #clearHeadlessTimers(): void {
    if (this.#headlessFallbackTimer !== null) { window.clearTimeout(this.#headlessFallbackTimer); this.#headlessFallbackTimer = null }
    if (this.#headlessApplyTimer !== null) { window.clearTimeout(this.#headlessApplyTimer); this.#headlessApplyTimer = null }
  }

  // -------------------------------------------------
  // pending-open queue (defer, never drop)
  // -------------------------------------------------
  /** Human handle for a request in activity:log messages: the tile name,
   *  else the branch-sig prefix, else the portal target. */
  #requestLabel(detail: PortalOpenRequest | null): string {
    const label = String(detail?.label ?? '').trim()
    if (label) return `"${label}"`
    const sig = String(detail?.branchSig ?? '').trim().toLowerCase()
    if (/^[a-f0-9]{64}$/.test(sig)) return `branch ${sig.slice(0, 6)}`
    return String(detail?.target ?? '').trim() || 'the install'
  }

  // THE QUEUE IS THE ONE THING HERE THAT ACCUMULATES, so it is worth saying
  // what a repeat does to it. It is fed by the `portal:open` WINDOW event,
  // which has no last-value replay — there is no subscribe-time repeat to
  // absorb. A genuine double-dispatch of the same request WOULD enqueue two
  // entries and run the install twice; that is the original's behaviour and it
  // is deliberate, because an Adopt-All batch legally sends many same-shaped
  // requests and the queue cannot dedupe on payload. MAX_PENDING_OPENS is the
  // ceiling, and each visible install still needs its own consent click.
  #enqueueOpen(detail: PortalOpenRequest | null): void {
    if (!detail || this.#pendingOpens.length >= MAX_PENDING_OPENS) {
      console.warn('[portal] dropping portal:open — pending queue full or detail missing')
      EffectBus.emit('activity:log', {
        message: `couldn't queue ${this.#requestLabel(detail)} — try again when the current install finishes`, icon: '○',
      })
      return
    }
    this.#pendingOpens.push({ ts: Date.now(), detail })
    this.#persistPendingOpens()
    EffectBus.emit('activity:log', { message: `queued ${this.#requestLabel(detail)} — another install is finishing`, icon: '◈' })
  }

  /** Only HEADLESS installs persist: they run unattended, so the web shell's
   *  post-accept reload (main.ts reloadIfDrifted fires on every accepted
   *  install that advances the sync sig) must not eat the rest of an Adopt-All
   *  batch. A queued VISIBLE open is a user gesture — auto-popping the
   *  installer after a reload would be worse than a re-click. */
  #persistPendingOpens(): void {
    try {
      const headless = this.#pendingOpens.filter(p => p.detail.headless === true)
      if (headless.length === 0) localStorage.removeItem(PENDING_OPENS_KEY)
      else localStorage.setItem(PENDING_OPENS_KEY, JSON.stringify(headless))
    } catch { /* no localStorage — the queue degrades to in-memory */ }
  }

  #restorePendingOpens(): void {
    let entries: { ts: number; detail: PortalOpenRequest }[] = []
    try {
      const raw = localStorage.getItem(PENDING_OPENS_KEY)
      const arr = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) {
        entries = arr.filter((e: { ts?: unknown; detail?: PortalOpenRequest } | null) =>
          !!e && typeof e.ts === 'number' && e.detail?.headless === true) as { ts: number; detail: PortalOpenRequest }[]
      }
    } catch { /* corrupt/absent — nothing to resume */ }
    if (entries.length === 0) return
    const now = Date.now()
    const fresh = entries.filter(e => now - e.ts <= PENDING_OPEN_TTL_MS)
    for (const e of entries) {
      if (now - e.ts > PENDING_OPEN_TTL_MS) {
        EffectBus.emit('activity:log', { message: `dropped a stale queued install of ${this.#requestLabel(e.detail)} — adopt it again`, icon: '○' })
      }
    }
    this.#pendingOpens = fresh
    this.#persistPendingOpens()
    if (fresh.length === 0) return
    // Resume after boot settles — the fold path needs the sharing drones
    // registered, and the headless fallback (12s) still guards a stuck DCP.
    // Tracked so a disconnect cancels it (the Angular original left this timer
    // running past ngOnDestroy).
    this.#resumeTimer = window.setTimeout(() => {
      this.#resumeTimer = null
      this.#drainPendingOpens()
    }, RESUME_DELAY_MS)
  }

  #drainPendingOpens(): void {
    if (this.#isOpen || this.#pendingOpens.length === 0) return
    // Re-dispatch the REAL window event (not a private call) so every
    // portal:open listener sees it — the web shell mounts its sentinel, the
    // screensaver suspends, the welcome card yields — exactly as if the
    // request had just fired. All of those listeners are idempotent.
    this.#dispatchingQueued = true
    try {
      window.dispatchEvent(new CustomEvent('portal:open', { detail: this.#pendingOpens[0].detail }))
    } finally {
      this.#dispatchingQueued = false
    }
    // If the open landed, the head is now IN FLIGHT — it leaves the queue in
    // close() (terminal), so a mid-install shell reload resumes it next boot.
    if (this.#isOpen) return
    // The open bailed (unresolvable target/url) — drop the head, try the next.
    const dropped = this.#pendingOpens.shift()
    this.#persistPendingOpens()
    if (dropped) EffectBus.emit('activity:log', { message: `couldn't start the queued install of ${this.#requestLabel(dropped.detail)}`, icon: '○' })
    this.#drainPendingOpens()
  }

  // -------------------------------------------------
  // the input gate + the tool windows
  // -------------------------------------------------
  /** InputGate — the shared tile-input lock. Resolved at runtime; undefined
   *  until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get?.('@diamondcoreprocessor.com/InputGate') as InputGateLike | undefined
  }

  /** Put the tool windows away for as long as this overlay covers the hive.
   *  Idempotent by the session's own rule, so a queued install opening behind
   *  this one — or a headless install promoting to visible — never re-parks an
   *  already-parked (and therefore empty) screen over the remembered set. */
  #parkWindows(): void {
    const parked = parkWindows()
    if (parked > 0) this.#parkedWindows = true
  }

  /** Back to the hive: the windows come back exactly as they were left. */
  #unparkWindows(): void {
    if (!this.#parkedWindows) return
    this.#parkedWindows = false
    unparkWindows()
  }

  // -------------------------------------------------
  // close portal — DISMISS (never installs)
  // -------------------------------------------------
  // Every passive exit lands here: the Done button, the backdrop, Escape
  // (global:escape), a touch-drag, and the installer's own portal:cancel. It
  // tears down the overlay and signals "closed" but DELIBERATELY never
  // dispatches `actions:available` — so any pending installer changes are
  // discarded, not folded into the hive. The diff isn't lost: DCP keeps the
  // config and re-surfaces it next open.
  //
  // EVERY EXIT ANSWERS ONCE, and this is the single place that answers:
  // `portal:closed` always, `dcp:embed-closed` when the target was the
  // installer. #finishApply() reaches the same function (so the accept path
  // fires the same pair exactly once) and only then adds `actions:available`.
  readonly close = (): void => {
    const wasDcp = this.#activeTarget === 'dcp'
    const wasHeadless = this.#headless
    const finished = this.#activeRequest
    // The portal that just terminated came off the queue — remove its entry
    // NOW (not at dispatch): if the shell had reloaded mid-install, the
    // persisted entry would have resumed on the next boot instead of vanishing.
    if (this.#openWasQueued) {
      this.#pendingOpens.shift()
      this.#persistPendingOpens()
      this.#openWasQueued = false
    }
    this.#clearHeadlessTimers()
    this.#headless = false
    this.#isOpen = false
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    // Back in the hive — the windows that were up when we left come back up,
    // with their content, scroll, scope and drill level intact. Before the
    // queue drains below, so a NEXT queued install parks them again from a
    // truthful "what is showing" rather than from an empty screen.
    this.#unparkWindows()
    this.#activeUrl = null
    this.#activeTarget = null
    this.#activeRequest = null
    this.#pendingPackageChange = false
    this.#restorePointNamedByDcp = false
    this.#openLogicalBaseline = undefined
    // Detaches both frames — which is what actually discards the installer's
    // browsing context, the element-side equivalent of `portalSrc = null`.
    this.#render()
    // Per-branch outcome — a headless install is invisible, so its end must be
    // said out loud: accepted (apply) or discarded (any passive close).
    if (wasHeadless) {
      EffectBus.emit('activity:log', this.#applyInProgress
        ? { message: `installed ${this.#requestLabel(finished)}`, icon: '◈' }
        : { message: `the install of ${this.#requestLabel(finished)} was cancelled before it finished`, icon: '○' })
    }
    // Generic close signal for EVERY overlay target (installer, meadowverse,
    // …). Symmetric counterpart to `portal:open`; lets listeners that suspend
    // while the hive is covered (e.g. the screensaver) reliably resume on
    // close. `dcp:embed-closed` is the "panel is gone" signal (UI state), NOT
    // the install trigger — installs ride `actions:available` from #finishApply.
    window.dispatchEvent(new CustomEvent('portal:closed'))
    if (wasDcp) window.dispatchEvent(new CustomEvent('dcp:embed-closed'))
    // Drain the next queued request — deferred a macrotask so #finishApply's
    // `actions:available` (dispatched right after this close returns) reaches
    // its listeners before the next install's iframe starts loading.
    if (this.#pendingOpens.length) {
      if (this.#drainTimer !== null) window.clearTimeout(this.#drainTimer)
      this.#drainTimer = window.setTimeout(() => {
        this.#drainTimer = null
        this.#drainPendingOpens()
      }, 0)
    }
  }

  // -------------------------------------------------
  // apply portal — ACCEPT (the only path that installs)
  // -------------------------------------------------
  /** The ONE button in the bar, and it does ONE thing: LEAVE. It never saves
   *  and never installs — a Done that can fail is a Done that traps you in
   *  the overlay with no way back to the hive (a restore point that wouldn't
   *  save held the panel open and locked the hexagons out). Committing rides
   *  its own triggers, outside this button: the installer's own
   *  `dcp:confirm`, or a headless install settling. */
  readonly done = (): void => { this.close() }

  /** Accept: hand the fold the participant's NAME and get out of its way.
   *
   *  This used to take a hive restore point of its own (SnapshotQueenBee)
   *  and REFUSE the whole accept when it failed — the failure that stranded
   *  the panel. It was always the second of two: SwarmAdoptDrone takes a
   *  pre-fold checkpoint too, best-effort, only when the diff is real, and
   *  it ran precisely when this one didn't. Two snapshots of the same hive,
   *  opposite failure policies, different names. So this one is gone: the
   *  fold owns the checkpoint, and the typed name rides along in the event
   *  so the one that IS taken carries the participant's word. */
  readonly beginApply = (): void => {
    this.#finishApply(this.#restorePointNamedByDcp ? this.restorePointName.trim() : '')
  }

  // Reached by an iframe-initiated portal:confirm / dcp:confirm, or by a
  // headless install settling — never by the chrome's Done button, which only
  // leaves. Tears the overlay down like close(), then dispatches
  // `actions:available` — the SOLE signal that folds the installer's enabled
  // config into the hive (SwarmAdoptDrone) and resyncs / reloads the web shell
  // (main.ts). Nothing installs or runs until it fires.
  #finishApply(restorePointName: string): void {
    const wasDcp = this.#activeTarget === 'dcp'
    const contentChanges = this.#pendingAdds + this.#pendingRemoves
    const transactionId = `adopt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    this.#applyInProgress = true
    try { this.close() } finally { this.#applyInProgress = false }
    if (wasDcp) {
      EffectBus.emit('update:status', { phase: 'applying', message: 'Adopting packages and website…' })
      window.dispatchEvent(new CustomEvent('actions:available', {
        detail: { restorePointName, contentChanges, transactionId },
      }))
    }
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band (230) the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host with no
// ShellSurfaceRegistry (diamond-core-processor mounts tags directly in its own
// template) still needs the tag to be a real element rather than an inert
// unknown one — so the define cannot wait on the registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, PortalOverlayElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/PortalOverlayElement',
    element: SURFACE_NAME,
    order: 230,
  })
})
