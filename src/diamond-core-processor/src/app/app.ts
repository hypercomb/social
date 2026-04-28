import { Component, OnDestroy, OnInit } from '@angular/core'
import { RouterOutlet } from '@angular/router'

const LIFECYCLE_CHANNEL = 'dcp-toggle-state'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html'
})
export class App implements OnInit, OnDestroy {

  #channel: BroadcastChannel | null = null
  #onUnload = (): void => {
    try { this.#channel?.postMessage({ type: 'dcp-closing' }) } catch { /* swallow */ }
  }

  ngOnInit(): void {
    // Sentinel iframe is also framed but isn't the user-facing DCP — its
    // lifecycle isn't meaningful to hypercomb's reload-on-close logic.
    if (window.location.pathname.startsWith('/sentinel')) return
    try { this.#channel = new BroadcastChannel(LIFECYCLE_CHANNEL) } catch { return }
    window.addEventListener('beforeunload', this.#onUnload)
    window.addEventListener('pagehide', this.#onUnload)
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.#onUnload)
    window.removeEventListener('pagehide', this.#onUnload)
    this.#channel?.close()
  }
}
