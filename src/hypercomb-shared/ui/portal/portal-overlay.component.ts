import { ChangeDetectorRef, Component, inject, type OnInit, type OnDestroy } from "@angular/core"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'

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
 *  at runtime via window.ioc (shared must never import from modules). */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

@Component({
  selector: 'hc-portal-overlay',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  readonly #cdr = inject(ChangeDetectorRef)
  readonly #sanitizer = inject(DomSanitizer)

  isOpen = false
  portalSrc: SafeResourceUrl | null = null
  #activeUrl: string | null = null
  #activeTarget: string | null = null

  /** Pending membership changes shown to the LEFT of the back/Done button:
   *  the installer's enabled content branches vs what's actually folded into
   *  the hive (the recoverable `hc:last-folded` receipt). adds = enabled but
   *  not yet folded; removes = folded but now disabled. Recomputed as the
   *  installer pushes snapshots while the portal is open; applied on close
   *  (which folds/un-folds via SwarmAdoptDrone). */
  pendingAdds = 0
  pendingRemoves = 0

  /** Pending PACKAGE / code change. The +adds/−removes above only track
   *  `kind:'content'` adoptions, so a pure functionality opt-in — enabling new
   *  bees/workers/drones inside a `kind:'package'` branch, which is exactly what
   *  the header "New features" upgrade flow routes here to do — produced NO
   *  content diff, so the Done button never appeared and the change could not be
   *  committed (only BACK = discard). We detect it by baselining the installer's
   *  `logicalRootSig` when the portal opens and flagging when a later projection
   *  differs. Same value-space on both sides (logicalRootSig vs logicalRootSig),
   *  so there are no cross-namespace false positives. Drives Done alongside the
   *  content diff; apply() → `actions:available` already resyncs the package. */
  pendingPackageChange = false
  #openLogicalBaseline: string | null = null

  /** Headless (invisible) install: the DCP runs in an off-screen iframe with no
   *  chrome and no gate lock, resolves + installs the branch's staged code
   *  nodes, and we auto-apply once its config projections go quiet. Used by the
   *  inline adopt of a CODE-bearing feature so the install never takes over the
   *  screen. Promotes to the visible installer if the DCP never projects. */
  headless = false
  #headlessFallbackTimer: number | null = null
  #headlessApplyTimer: number | null = null

  /** The request behind the currently-open portal — kept for the per-branch
   *  outcome messages (activity:log) a headless install must say out loud. */
  #activeRequest: PortalOpenRequest | null = null

  /** Deferred portal:open requests (see the in-flight guard in onPortalOpen).
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
  /** Set by apply() around close() so the outcome message can distinguish an
   *  accepted headless install from a discarded one. */
  #applyInProgress = false

  /** Full URL of the currently-loaded iframe content, for the title-attr tooltip. */
  get activeUrl(): string | null { return this.#activeUrl }

  /** Show the explicit Done button when there is ANYTHING to commit — content
   *  adoptions/removals OR a package/code change. Done is the only affordance
   *  that dispatches `actions:available` (fold + resync + reload); BACK always
   *  discards. Gating it on the package change too is what makes a feature
   *  update installable from the embedded installer. */
  get hasPendingCommit(): boolean {
    return !!(this.pendingAdds || this.pendingRemoves || this.pendingPackageChange)
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
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (e: Event): void => {
    const detail = (e as CustomEvent).detail as PortalOpenRequest | null
    let url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    // In-flight guard: a HEADLESS install is running off-screen (no chrome, the
    // user can't see it). A second portal:open — e.g. the next code pick in an
    // Adopt-All batch — must NOT tear it down: rebinding the iframe [src] and
    // clearing its timers would silently drop the in-flight install. And an
    // incoming HEADLESS request must never hijack a VISIBLE session the user is
    // mid-review in. Either way the request is QUEUED, not dropped — close()
    // drains the queue one install at a time (promoting a stalled headless
    // install to visible still works exactly as before).
    if (this.isOpen && (this.headless || detail?.headless === true)) {
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

    // Explicit stage sigs → installer pre-tick. A headless code adopt hands
    // the branch's bee/dep sigs in `detail.stage`; DCP's #processStageHash
    // ticks the matching nodes ON by default. Nothing folds until Done — this
    // only sets checkbox state. Capped so the hash never grows pathological
    // (DCP falls back gracefully).
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
    // made while the portal is up surfaces a Done button (see pendingPackageChange).
    this.#openLogicalBaseline = this.#snapshotLogicalRootSig()
    this.pendingPackageChange = false
    this.portalSrc = this.#sanitizer.bypassSecurityTrustResourceUrl(url)
    this.isOpen = true
    this.headless = detail?.headless === true && (detail?.target ?? '') === 'dcp'
    if (this.headless) {
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
      // passive exit funnels there) and ngOnDestroy. Resolved lazily because
      // the gate's bee may register after this component constructs on web.
      this.#gate()?.lock(PORTAL_LOCK_OWNER)
    }
    this.#recomputeDiff()   // also calls detectChanges()
  }

  /** Recompute the pending +adds/−removes shown next to the back/Done button.
   *  Reads the installer's enabled CONTENT branches (RegistrySnapshot, pushed
   *  over postMessage) and the hive's recoverable folded receipt
   *  (`hc:last-folded`, written by SwarmAdoptDrone). Pure read — never mutates. */
  #recomputeDiff = (): void => {
    let adds = 0, removes = 0
    try {
      const SIG = /^[a-f0-9]{64}$/
      const store = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/RegistrySnapshot') as
        { snapshot?: { branches?: { branchSig?: string; enabled?: boolean; kind?: string }[] } | null } | undefined
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
    this.pendingAdds = adds
    this.pendingRemoves = removes
    // Package/code drift: compare the installer's current logicalRootSig to the
    // baseline captured on open. The first non-null projection after open
    // becomes the baseline (so the initial render is never a false "change"),
    // and only a SUBSEQUENT, different projection — the participant enabling a
    // new bee/worker/drone — flags a pending commit.
    const cur = this.#snapshotLogicalRootSig()
    if (this.#openLogicalBaseline === null && cur !== null) this.#openLogicalBaseline = cur
    this.pendingPackageChange =
      this.#openLogicalBaseline !== null && cur !== null && cur !== this.#openLogicalBaseline
    this.#cdr.detectChanges()
  }

  /** The installer's current logical-config root signature (lowercased), or
   *  null if no snapshot has been projected yet. Resolved lazily via window.ioc
   *  (shared must never import from modules). */
  #snapshotLogicalRootSig(): string | null {
    const store = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/RegistrySnapshot') as
      { snapshot?: { logicalRootSig?: string | null } | null } | undefined
    const sig = store?.snapshot?.logicalRootSig
    return typeof sig === 'string' && sig ? sig.toLowerCase() : null
  }

  // -------------------------------------------------
  // iframe → parent messages
  // -------------------------------------------------
  private readonly onMessage = (e: MessageEvent): void => {
    if (!this.#activeUrl) return
    const expectedOrigin = new URL(this.#activeUrl).origin

    // enforce origin boundary
    if (e.origin !== expectedOrigin) return

    const data = e.data as { type?: string } | null
    if (!data?.type) return

    switch (data.type) {
      case 'portal:confirm':
      case 'dcp:confirm':
        // Iframe-initiated accept — equivalent to clicking Done in the chrome.
        this.apply()
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
        if (this.headless) this.#scheduleHeadlessApply()
        break
    }
  }

  // -------------------------------------------------
  // headless (invisible) install
  // -------------------------------------------------
  /** Apply once the DCP's config projections go quiet — branch resolved, staged
   *  nodes ticked, nothing new arriving. Debounced so a burst of snapshots
   *  settles to ONE apply() (fold + resync), then the off-screen iframe tears
   *  down. Also cancels the "never projected" fallback. */
  #scheduleHeadlessApply(): void {
    // Do NOT clear #headlessFallbackTimer here — it stays armed as a HARD ceiling
    // so an install that never quiesces (a hypothetical sustained snapshot
    // stream) promotes to the visible installer instead of hanging invisibly.
    // On a normal install the settle timer below fires apply() first, and
    // close() clears both timers.
    if (this.#headlessApplyTimer !== null) window.clearTimeout(this.#headlessApplyTimer)
    this.#headlessApplyTimer = window.setTimeout(() => {
      this.#headlessApplyTimer = null
      if (this.headless) this.apply()
    }, HEADLESS_SETTLE_MS)
  }

  /** The DCP never projected a config in time — surface the installer VISIBLY so
   *  the participant can finish the install by hand. Never a silent hung iframe. */
  #promoteHeadlessToVisible = (): void => {
    if (!this.headless) return
    this.#clearHeadlessTimers()
    this.headless = false
    this.#gate()?.lock(PORTAL_LOCK_OWNER)
    this.#recomputeDiff()   // detectChanges → the visible panel now renders
    // Say WHY the installer suddenly appeared — the install was invisible
    // until now, so the promotion needs a visible cause. Emitted AFTER our own
    // detectChanges: the activity-log handler ticks the whole app, and ticking
    // while this component's bindings are mid-flip throws NG0100 in dev.
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
    window.setTimeout(() => this.#drainPendingOpens(), RESUME_DELAY_MS)
  }

  #drainPendingOpens(): void {
    if (this.isOpen || this.#pendingOpens.length === 0) return
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
    if (this.isOpen) return
    // The open bailed (unresolvable target/url) — drop the head, try the next.
    const dropped = this.#pendingOpens.shift()
    this.#persistPendingOpens()
    if (dropped) EffectBus.emit('activity:log', { message: `couldn't start the queued install of ${this.#requestLabel(dropped.detail)}`, icon: '○' })
    this.#drainPendingOpens()
  }

  // -------------------------------------------------
  // escape (via centralized cascade fallback)
  // -------------------------------------------------
  #unsubEscape: (() => void) | null = null
  #unsubTouchDragging: (() => void) | null = null
  #unsubDiff: (() => void) | null = null

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------
  public ngOnInit(): void {
    window.addEventListener('portal:open', this.onPortalOpen)
    window.addEventListener('message', this.onMessage)
    // A HEADLESS portal is invisible — Escape / a touch-drag is aimed at
    // something the user can see, and closing here would silently kill the
    // in-flight install. Once promoted to visible, both dismiss as usual.
    this.#unsubEscape = EffectBus.on('global:escape', () => {
      if (this.isOpen && !this.headless) this.close()
    })
    this.#unsubTouchDragging = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      if (active && this.isOpen && !this.headless) this.close()
    })
    // Installer pushed a new config while the portal is open → refresh the
    // pending +adds/−removes next to the back/Done button.
    this.#unsubDiff = EffectBus.on('registry:snapshot', () => this.#recomputeDiff())
    // Headless installs the last session queued but never ran (the web shell
    // reloads after each accepted install) resume here.
    this.#restorePendingOpens()
  }

  public ngOnDestroy(): void {
    window.removeEventListener('portal:open', this.onPortalOpen)
    window.removeEventListener('message', this.onMessage)
    this.#unsubEscape?.()
    this.#unsubTouchDragging?.()
    this.#unsubDiff?.()
    this.#clearHeadlessTimers()
    // Release on teardown so a portal destroyed while open never leaves the
    // hexes locked.
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
  }

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
  }

  // -------------------------------------------------
  // close portal — DISMISS (never installs)
  // -------------------------------------------------
  // Every passive exit lands here: the ×/back button, the backdrop, Escape
  // (global:escape), and a touch-drag. It tears down the overlay and signals
  // "closed" but DELIBERATELY never dispatches `actions:available` — so any
  // pending installer changes are discarded, not folded into the hive. The
  // diff isn't lost: DCP keeps the config and re-surfaces it next open.
  public close = (): void => {
    const wasDcp = this.#activeTarget === 'dcp'
    const wasHeadless = this.headless
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
    this.headless = false
    this.isOpen = false
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    this.portalSrc = null
    this.#activeUrl = null
    this.#activeTarget = null
    this.#activeRequest = null
    this.pendingPackageChange = false
    this.#openLogicalBaseline = null
    this.#cdr.detectChanges()
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
    // the install trigger — installs ride `actions:available` from apply().
    window.dispatchEvent(new CustomEvent('portal:closed'))
    if (wasDcp) window.dispatchEvent(new CustomEvent('dcp:embed-closed'))
    // Drain the next queued request — deferred a macrotask so apply()'s
    // `actions:available` (dispatched right after this close returns) reaches
    // its listeners before the next install's iframe starts loading.
    if (this.#pendingOpens.length) window.setTimeout(() => this.#drainPendingOpens(), 0)
  }

  // -------------------------------------------------
  // apply portal — ACCEPT (the only path that installs)
  // -------------------------------------------------
  // Fired by the explicit "Done" button (and by an iframe-initiated
  // portal:confirm / dcp:confirm). Tears the overlay down like close(), then
  // dispatches `actions:available` — the SOLE signal that folds the
  // installer's enabled config into the hive (SwarmAdoptDrone) and resyncs /
  // reloads the web shell (main.ts). Nothing installs or runs until the
  // participant authorizes it here.
  public apply = (): void => {
    const wasDcp = this.#activeTarget === 'dcp'
    this.#applyInProgress = true
    try { this.close() } finally { this.#applyInProgress = false }
    if (wasDcp) window.dispatchEvent(new CustomEvent('actions:available'))
  }
}
