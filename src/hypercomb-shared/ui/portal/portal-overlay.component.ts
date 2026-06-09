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
      const branch = hashParams.get('branch')
      if (branch && /^[a-f0-9]{64}$/i.test(branch)) {
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
      { target?: string; url?: string; branchSig?: string; at?: string; domain?: string; label?: string } | null
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
      }
    }

    this.#activeUrl = url
    this.#activeTarget = detail?.target ?? null
    this.portalSrc = this.#sanitizer.bypassSecurityTrustResourceUrl(url)
    this.isOpen = true
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
        this.close()
        window.dispatchEvent(new CustomEvent('actions:available'))
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
  }

  public ngOnDestroy(): void {
    window.removeEventListener('portal:open', this.onPortalOpen)
    window.removeEventListener('message', this.onMessage)
    this.#unsubEscape?.()
    this.#unsubTouchDragging?.()
  }

  // -------------------------------------------------
  // close portal
  // -------------------------------------------------
  public close = (): void => {
    const wasDcp = this.#activeTarget === 'dcp'
    this.isOpen = false
    this.portalSrc = null
    this.#activeUrl = null
    this.#activeTarget = null
    this.#cdr.detectChanges()
    if (wasDcp) window.dispatchEvent(new CustomEvent('dcp:embed-closed'))
  }
}
