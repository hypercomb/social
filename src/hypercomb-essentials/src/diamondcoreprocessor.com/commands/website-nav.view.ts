// website-nav.view.ts — the keyboard safety net for website mode, as a
// framework-free custom element (everything-is-a-beehavior Phase 2).
//
// A straight port of shared/ui/website-nav (the Angular component it
// replaces): same surface name, same order band in the shell-surface
// registry, same capture-phase Escape, same ViewMode flip. The participant
// notices nothing — the panel is delivered as a signed module instead of
// compiled into the shell.
//
// In website mode the whole top bar (command line included) is hidden so a
// site reads like a site, not an app. The visible way out is the raw-DOM exit
// hexagon SiteViewDrone mounts (#hc-site-exit); the way back into a site is
// its launcher tile in the shared group-launcher mix (the websites group).
// This surface owns the one thing neither of those can guarantee: a global
// Escape that ALWAYS leaves website mode, even if a page's CSS hid the exit
// hexagon or it never rendered. Capture phase so an embedded page script
// can't swallow the key first.
//
// HEADLESS by design — no template, no chrome, no strings, no stylesheet.
// It never adds a child and pins itself to display:none inline, so there is
// nothing to leak and no sheet to install. ViewMode is resolved at call time
// through window.ioc (VIEW_MODE_KEY from core): the module must never hold a
// reference minted before the service registered.

import { VIEW_MODE_KEY, type ViewModeProvider } from '@hypercomb/core'

const SURFACE_NAME = 'hc-website-nav'

/** The mode Escape lands on — the hive itself. */
const HIVE = 'hexagons'
/** The mode Escape leaves. Any other mode is somebody else's Escape. */
const SITE = 'website'

export class WebsiteNavElement extends HTMLElement {

  /** Everything connectedCallback wired, torn down in one sweep. */
  #offs: Array<() => void> = []

  connectedCallback(): void {
    // Headless: no children, no box. Inline so no stylesheet is needed.
    this.style.display = 'none'
    this.setAttribute('aria-hidden', 'true')

    // Capture phase so a page script can't swallow Escape before we see it.
    window.addEventListener('keydown', this.#onKeyDown, true)
    this.#offs.push(() => window.removeEventListener('keydown', this.#onKeyDown, true))
  }

  disconnectedCallback(): void {
    this.#offs.forEach(off => off())
    this.#offs = []
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
    // Resolved at call time, never at module scope — the service may register
    // after this bundle loads, and the shell may swap the instance.
    const vm = window.ioc?.get?.(VIEW_MODE_KEY) as ViewModeProvider | undefined
    if (!vm || vm.mode !== SITE) return
    e.preventDefault()
    vm.setMode(HIVE)
  }
}

// ── shell surface registration — the externalization path ────────────────
// Same name, same order band the Angular component held; the module-side
// `element:` shape (documentation/shell-surfaces.md).
// DEFINED AT MODULE SCOPE, registered when a registry appears. A host
// with no ShellSurfaceRegistry (diamond-core-processor mounts this tag
// directly in its own template) still needs the tag to be a real element
// rather than an inert unknown one — so the define cannot wait on the
// registry. Only the ADD does.
if (!customElements.get(SURFACE_NAME)) {
  customElements.define(SURFACE_NAME, WebsiteNavElement)
}

window.ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (value) => {
  const registry = value as { add(surface: Record<string, unknown>): void }
  registry.add({
    name: SURFACE_NAME,
    owner: '@diamondcoreprocessor.com/WebsiteNavElement',
    element: SURFACE_NAME,
    order: 210,
  })
})
