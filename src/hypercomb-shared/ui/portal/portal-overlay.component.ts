import { ChangeDetectorRef, Component, inject, type OnInit, type OnDestroy } from "@angular/core"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

const DEFAULT_PORTALS: Record<string, string> = {
  meadowverse: 'https://meadowverse.com',
  hypercomb: 'https://hypercomb.com',
}

const DCP_LOCAL_URL = 'http://localhost:2400'
const DCP_CANONICAL_URL = 'https://diamondcoreprocessor.com'

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
  imports: [TranslatePipe],
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

  /** Full URL of the currently-loaded iframe content, for the title-attr tooltip. */
  get activeUrl(): string | null { return this.#activeUrl }

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
    const detail = (e as CustomEvent).detail as
      {
        target?: string; url?: string; branchSig?: string; at?: string; domain?: string; label?: string
        /** Header upgrade-indicator handoff: WHICH package changed + the
         *  delta the installer marks for review. Notify-and-route only. */
        upgrade?: { packageSig?: string | null; newBees?: string[]; previous?: string | null }
      } | null
    let url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

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

    this.#activeUrl = url
    this.#activeTarget = detail?.target ?? null
    this.portalSrc = this.#sanitizer.bypassSecurityTrustResourceUrl(url)
    this.isOpen = true
    // Freeze tile navigation while the portal/installer covers the canvas —
    // per the "modals lock tiles while showing" rule no pan/pinch/wheel-zoom/
    // drag-select may bleed through behind it. Released in close() (every
    // passive exit funnels there) and ngOnDestroy. Resolved lazily because
    // the gate's bee may register after this component constructs on web.
    this.#gate()?.lock(PORTAL_LOCK_OWNER)
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
    this.#cdr.detectChanges()
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
        break
    }
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
    this.#unsubEscape = EffectBus.on('global:escape', () => {
      if (this.isOpen) this.close()
    })
    this.#unsubTouchDragging = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      if (active && this.isOpen) this.close()
    })
    // Installer pushed a new config while the portal is open → refresh the
    // pending +adds/−removes next to the back/Done button.
    this.#unsubDiff = EffectBus.on('registry:snapshot', () => this.#recomputeDiff())
  }

  public ngOnDestroy(): void {
    window.removeEventListener('portal:open', this.onPortalOpen)
    window.removeEventListener('message', this.onMessage)
    this.#unsubEscape?.()
    this.#unsubTouchDragging?.()
    this.#unsubDiff?.()
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
    this.isOpen = false
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    this.portalSrc = null
    this.#activeUrl = null
    this.#activeTarget = null
    this.#cdr.detectChanges()
    // Generic close signal for EVERY overlay target (installer, meadowverse,
    // …). Symmetric counterpart to `portal:open`; lets listeners that suspend
    // while the hive is covered (e.g. the screensaver) reliably resume on
    // close. `dcp:embed-closed` is the "panel is gone" signal (UI state), NOT
    // the install trigger — installs ride `actions:available` from apply().
    window.dispatchEvent(new CustomEvent('portal:closed'))
    if (wasDcp) window.dispatchEvent(new CustomEvent('dcp:embed-closed'))
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
    this.close()
    if (wasDcp) window.dispatchEvent(new CustomEvent('actions:available'))
  }
}
