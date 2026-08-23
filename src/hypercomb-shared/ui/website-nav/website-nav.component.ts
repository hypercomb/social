// hypercomb-shared/ui/website-nav/website-nav.component.ts
//
// The keyboard safety net for website mode.
//
// In website mode the whole top bar (command line included) is hidden so a site
// reads like a site, not an app. The visible way out is the raw-DOM exit hexagon
// SiteViewDrone mounts (#hc-site-exit); the way back into a site is its launcher
// tile in the shared group-launcher mix (the websites group). This component owns the one thing
// neither of those can guarantee: a global Escape that ALWAYS leaves website
// mode, even if a page's CSS hid the exit hexagon or it never rendered. Capture
// phase so an embedded page script can't swallow the key first.
//
// Headless by design — no template, no chrome. Shell UI never imports
// essentials; ViewMode is resolved at call time through window.ioc.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, OnDestroy } from '@angular/core'

/** Runtime service locator — shared must never statically import essentials, so
 *  cross-service resolution goes through window.ioc at call time. */
const get = (key: string): unknown => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type ViewModeLike = { mode: string; setMode(next: string): void }

const HIVE = 'hexagons'
const SITE = 'website'
const VIEW_MODE_KEY = '@hypercomb.social/ViewMode'

@Component({
  selector: 'hc-website-nav',
  standalone: true,
  template: '',
})
export class WebsiteNavComponent implements OnDestroy {
  constructor() {
    // Capture phase so a page script can't swallow Escape before we see it.
    window.addEventListener('keydown', this.#onKeyDown, true)
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.#onKeyDown, true)
  }

  /** Escape always leaves website mode — the independent exit that still works
   *  if a page's CSS hid the visible exit hexagon or it didn't render. It
   *  mirrors the on-page exit button exactly: flip ViewMode to the hive, and
   *  SiteViewDrone's mode-change handler lands the reader on the ENTRANCE —
   *  the layer the site was entered from. The websites directory is NOT shown
   *  on the way out; `/websites` is the one way to open that window. Leaving a
   *  site backs you out to where you came in, not into a menu. */
  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    const vm = get(VIEW_MODE_KEY) as ViewModeLike | undefined
    if (!vm || vm.mode !== SITE) return
    e.preventDefault()
    vm.setMode(HIVE)
  }
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-website-nav',
  owner: '@hypercomb.shared/WebsiteNavComponent',
  component: WebsiteNavComponent,
  order: 210,
})
