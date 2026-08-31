import { registerShellSurface } from '../../core/shell-surface-registry'
import { ChangeDetectorRef, Component, inject, type OnInit, type OnDestroy } from "@angular/core"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
import { parkWindows, unparkWindows } from '../window-session'

const DEFAULT_PORTALS: Record<string, string> = {
  meadowverse: 'https://meadowverse.com',
  hypercomb: 'https://hypercomb.com',
}

/** The portal:open request payload. */
interface PortalOpenRequest {
  target?: string; url?: string; label?: string
}

function resolvePortalUrl(target: string): string | undefined {
  const override = localStorage.getItem(`portal:${target}`)
  if (override) return override
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

/** The portal overlay: a framed, dismissible window onto another origin —
 *  the game targets (arkanoid, bubble, roper, solomon) and the sibling hives
 *  (meadowverse, hypercomb). It SHOWS things; it never installs.
 *
 *  Content arrives by replicating a root signature
 *  (documentation/install-by-replication.md), so this overlay has no accept
 *  path, no diff, no staging and no headless mode — the whole installer
 *  machine that used to live here went with the DCP transport it served. */
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

  /** Full URL of the currently-loaded iframe content, for the title-attr tooltip. */
  get activeUrl(): string | null { return this.#activeUrl }

  /** Human-friendly host label for the address breadcrumb, so the participant
   *  always sees "where am I." */
  get addressLabel(): string {
    const url = this.#activeUrl
    if (!url) return ''
    try { return new URL(url).hostname } catch { return url }
  }

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (e: Event): void => {
    const detail = (e as CustomEvent).detail as PortalOpenRequest | null
    const url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    this.#activeUrl = url
    this.portalSrc = this.#sanitizer.bypassSecurityTrustResourceUrl(url)
    this.isOpen = true
    // Freeze tile navigation while the overlay covers the canvas — per the
    // "modals lock tiles while showing" rule no pan/pinch/wheel-zoom/
    // drag-select may bleed through behind it. Released in close() (every
    // exit funnels there) and ngOnDestroy. Resolved lazily because the gate's
    // bee may register after this component constructs on web.
    this.#gate()?.lock(PORTAL_LOCK_OWNER)
    // …and put the tool windows away. They dock ABOVE this overlay (z-index
    // 100002 vs 90000), so an open features panel or notes strip would go on
    // floating over it. PARKED, not closed: unparked in close(), so coming
    // back to the hive finds them exactly as they were left.
    this.#parkWindows()
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
    if (data?.type === 'portal:cancel') this.close()
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
    // Release on teardown so a portal destroyed while open never leaves the
    // hexes locked — or the participant's windows put away with nothing left
    // to bring them back.
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    this.#unparkWindows()
  }

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); undefined until its bee registers. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
  }

  /** Put the tool windows away for as long as this overlay covers the hive.
   *  Idempotent by the session's own rule, so it never re-parks an already-
   *  parked (and therefore empty) screen over the remembered set. */
  #parkWindows(): void {
    const parked = parkWindows()
    if (parked > 0) this.#parkedWindows = true
  }

  /** Did WE park? Only then do we bring them back — a portal that opened over
   *  an empty screen has nothing to restore, and must not restore someone
   *  else's. */
  #parkedWindows = false

  /** Back to the hive: the windows come back exactly as they were left. */
  #unparkWindows(): void {
    if (!this.#parkedWindows) return
    this.#parkedWindows = false
    unparkWindows()
  }

  // -------------------------------------------------
  // close portal — DISMISS
  // -------------------------------------------------
  // Every exit lands here: the ×/back button, the backdrop, Escape
  // (global:escape), a touch-drag, and the Done button.
  public close = (): void => {
    this.isOpen = false
    this.#gate()?.unlock(PORTAL_LOCK_OWNER)
    // Back in the hive — the windows that were up when we left come back up,
    // with their content, scroll, scope and drill level intact.
    this.#unparkWindows()
    this.portalSrc = null
    this.#activeUrl = null
    this.#cdr.detectChanges()
    // Generic close signal for EVERY overlay target. Symmetric counterpart to
    // `portal:open`; lets listeners that suspend while the hive is covered
    // (e.g. the screensaver) reliably resume on close.
    window.dispatchEvent(new CustomEvent('portal:closed'))
  }

  /** The ONE button in the bar, and it does ONE thing: LEAVE. */
  public done = (): void => { this.close() }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-portal-overlay',
  owner: '@hypercomb.shared/PortalOverlayComponent',
  component: PortalOverlayComponent,
  order: 230,
})
