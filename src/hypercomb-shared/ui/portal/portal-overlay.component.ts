import { ChangeDetectorRef, Component, type OnInit, type OnDestroy, signal, inject } from "@angular/core"
import type { SafeResourceUrl } from "@angular/platform-browser"
import { DomSanitizer } from "@angular/platform-browser"
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

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
  imports: [TranslatePipe],
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  #sanitizer: DomSanitizer | null = null
  #cdr: ChangeDetectorRef | null = null

  public readonly open = signal(false)
  public readonly src = signal<SafeResourceUrl | null>(null)
  #activeUrl: string | null = null

  constructor() {
    try {
      this.#sanitizer = inject(DomSanitizer)
      this.#cdr = inject(ChangeDetectorRef)
    } catch (error) {
      console.warn('[portal-overlay] DI unavailable — portal disabled', error)
    }
  }

  // -------------------------------------------------
  // open portal
  // -------------------------------------------------
  private readonly onPortalOpen = (e: Event): void => {
    if (!this.#sanitizer) return

    const detail = (e as CustomEvent).detail as { target?: string; url?: string } | null
    const url = detail?.url ?? resolvePortalUrl(detail?.target ?? '')
    if (!url) return

    this.#activeUrl = url
    this.open.set(true)
    this.src.set(this.#sanitizer.bypassSecurityTrustResourceUrl(url))
    this.#cdr?.detectChanges()
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
      if (this.open()) this.close()
    })
    this.#unsubTouchDragging = EffectBus.on<{ active: boolean }>('touch:dragging', ({ active }) => {
      if (active && this.open()) this.close()
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
    this.open.set(false)
    this.src.set(null)
    this.#activeUrl = null
    this.#cdr?.detectChanges()
  }
}
