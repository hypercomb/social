    // src/app/common/portal/portal-overlay.component.ts
import { Component, OnDestroy, OnInit, signal } from '@angular/core'
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser'

@Component({
  selector: 'hc-portal-overlay',
  standalone: true,
  templateUrl: './portal-overlay.component.html',
  styleUrls: ['./portal-overlay.component.scss']
})
export class PortalOverlayComponent implements OnInit, OnDestroy {

  // todo: replace with your real dcp url
  private static readonly DCP_URL = 'http://localhost:2400'

  public readonly open = signal(false)
  public readonly src = signal<SafeResourceUrl | null>(null)

  private readonly onPortalOpen = (): void => {
    this.open.set(true)
    this.src.set(this.sanitizer.bypassSecurityTrustResourceUrl(PortalOverlayComponent.DCP_URL))
  }

  private readonly onMessage = (e: MessageEvent): void => {
    // accept only messages from the iframe window and expected origin
    // note: requires iframe sandbox includes allow-same-origin so origin is not "null"
    const expected = new URL(PortalOverlayComponent.DCP_URL).origin
    if (e.origin !== expected) return

    const data = e.data as { type?: string } | null
    if (!data?.type) return

    if (data.type === 'dcp:confirm') {
      // todo: persist payload / update manifest here
      this.close()

      // tells search-bar (and anyone else) that actions now exist
      window.dispatchEvent(new CustomEvent('actions:available'))
      return
    }

    if (data.type === 'dcp:cancel') {
      this.close()
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open()) return
    if (e.key !== 'Escape') return
    e.preventDefault()
    this.close()
  }

  constructor(private readonly sanitizer: DomSanitizer) {}

  public ngOnInit(): void {
    window.addEventListener('portal:open', this.onPortalOpen)
    window.addEventListener('message', this.onMessage)
    window.addEventListener('keydown', this.onKeyDown)
  }

  public ngOnDestroy(): void {
    window.removeEventListener('portal:open', this.onPortalOpen)
    window.removeEventListener('message', this.onMessage)
    window.removeEventListener('keydown', this.onKeyDown)
  }

  public close = (): void => {
    this.open.set(false)
    this.src.set(null)
  }
}
