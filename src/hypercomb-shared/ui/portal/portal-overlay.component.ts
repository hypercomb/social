import { ChangeDetectorRef, Component, inject, type OnInit, type OnDestroy } from "@angular/core"
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'

const DEFAULT_PORTALS: Record<string, string> = {
  dcp: 'https://diamondcoreprocessor.com',
  meadowverse: 'https://meadowverse.com',
  hypercomb: 'https://hypercomb.com',
}

const DCP_LOCAL_URL = 'http://localhost:2400'

function resolveDcpUrl(): string {
  const host = window.location.hostname
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  return isLocalHost ? DCP_LOCAL_URL : DEFAULT_PORTALS['dcp']
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
  imports: [],
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  readonly #cdr = inject(ChangeDetectorRef)
  readonly #sanitizer = inject(DomSanitizer)

  isOpen = false
  portalSrc: SafeResourceUrl | null = null
  #activeUrl: string | null = null

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { target?: string; url?: string } | null
    const url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    this.#activeUrl = url
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
    this.isOpen = false
    this.portalSrc = null
    this.#activeUrl = null
    this.#cdr.detectChanges()
  }
}
