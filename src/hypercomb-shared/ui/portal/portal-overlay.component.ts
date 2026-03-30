import { Component, type OnInit, type OnDestroy } from "@angular/core"
import { EffectBus } from '@hypercomb/core'

const DEFAULT_PORTALS: Record<string, string> = {
  dcp: 'https://diamondcoreprocessor.com',
  meadowverse: 'https://meadowverse.com',
  hypercomb: 'https://hypercomb.com',
}

function resolvePortalUrl(target: string): string | undefined {
  const override = localStorage.getItem(`portal:${target}`)
  return override ?? DEFAULT_PORTALS[target]
}

@Component({
  selector: 'hc-portal-overlay',
  standalone: true,
  imports: [],
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  isOpen = false
  #activeUrl: string | null = null

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { target?: string; url?: string } | null
    const url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    this.#activeUrl = url
    this.isOpen = true
    queueMicrotask(() => {
      const frame = document.querySelector<HTMLIFrameElement>('.portal-frame')
      if (frame) frame.src = url
    })
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
    this.#activeUrl = null
  }
}
