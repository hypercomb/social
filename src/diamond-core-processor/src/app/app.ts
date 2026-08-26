import { Component, CUSTOM_ELEMENTS_SCHEMA, OnDestroy, OnInit } from '@angular/core'
import { RouterOutlet } from '@angular/router'
// THE TRUST GATE NOW ARRIVES AS MODULES (everything-is-a-beehavior Phase 2).
// Both halves moved out of hypercomb-shared into essentials, and DCP takes
// them the same way it always did — by importing the module, which
// self-registers:
//
//   trust-service  registers @hypercomb.social/TrustService in window.ioc, so
//                  DCP's home.component and any other DCP-side caller can
//                  invoke trust.check() at activation time;
//   trust-prompt   DEFINES the <hc-trust-prompt> custom element at module
//                  scope, which is what upgrades the tag in app.html.
//
// The prompt is no longer an Angular component, so it is not in `imports:` —
// the browser owns the element now. DCP has no ShellSurfaceRegistry, which is
// exactly why the element defines itself at module scope rather than waiting
// for one.
import '@hypercomb/essentials/diamondcoreprocessor.com/sharing/trust-service'
import '@hypercomb/essentials/diamondcoreprocessor.com/sharing/trust-prompt.view'

const LIFECYCLE_CHANNEL = 'dcp-toggle-state'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  // <hc-trust-prompt> is a custom element now, not an Angular component.
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
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
