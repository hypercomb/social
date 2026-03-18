import { Component, type OnInit, type OnDestroy, signal } from "@angular/core"
import type { SafeResourceUrl, DomSanitizer } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'

@Component({
  selector: 'hc-portal-overlay',
  standalone: true,
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  // dcp entry point
  private static readonly DCP_URL = 'http://localhost:2400'

  public readonly open = signal(false)
  public readonly src = signal<SafeResourceUrl | null>(null)

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (): void => {
    this.open.set(true)
    // this.src.set(
    //   this.sanitizer.bypassSecurityTrustResourceUrl(
    //     PortalOverlayComponent.DCP_URL
    //   )
    // )
    throw new Error('PortalOverlayComponent: DCP integration is currently disabled')
  }

  // -------------------------------------------------
  // iframe → parent messages
  // -------------------------------------------------
  private readonly onMessage = (e: MessageEvent): void => {
    const expectedOrigin = new URL(
      PortalOverlayComponent.DCP_URL
    ).origin

    // enforce origin boundary
    if (e.origin !== expectedOrigin) return

    const data = e.data as { type?: string } | null
    if (!data?.type) return

    switch (data.type) {
      case 'dcp:confirm':
        this.close()
        window.dispatchEvent(
          new CustomEvent('actions:available')
        )
        break

      case 'dcp:cancel':
        this.close()
        break
    }
  }

  // -------------------------------------------------
  // escape (via centralized cascade fallback)
  // -------------------------------------------------
  #unsubEscape: (() => void) | null = null

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------
  public ngOnInit(): void {
    window.addEventListener('portal:open', this.onPortalOpen)
    window.addEventListener('message', this.onMessage)
    this.#unsubEscape = EffectBus.on('global:escape', () => {
      if (this.open()) this.close()
    })
  }

  public ngOnDestroy(): void {
    window.removeEventListener('portal:open', this.onPortalOpen)
    window.removeEventListener('message', this.onMessage)
    this.#unsubEscape?.()
  }

  // -------------------------------------------------
  // close portal
  // -------------------------------------------------
  public close = (): void => {
    this.open.set(false)
    this.src.set(null)
  }
}
