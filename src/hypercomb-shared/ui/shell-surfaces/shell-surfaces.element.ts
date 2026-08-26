// hypercomb-shared/ui/shell-surfaces/shell-surfaces.element.ts
//
// The single host for registry-fed shell surfaces. A shell mounts ONE
// <hc-shell-surfaces> tag instead of enumerating every panel/strip/overlay in
// app.html; this element renders whatever is in the ShellSurfaceRegistry and
// reconciles when surfaces register or unregister (hot install, feature
// toggle, installer teardown).
//
// Every surface is a custom-element tag. The old Angular `component` shape
// retired once the last shared panel moved into its owning module.
//
// Reconciliation is KEYED by surface name: a change to the registry mounts the
// newcomers and unmounts the departed, but never recreates survivors — an open
// panel keeps its state when an unrelated surface hot-installs. DOM order
// always equals registry order (`order` ascending); nodes are moved, not
// rebuilt, when their position changes.
//
// `:host { display: contents }` keeps the host layout-transparent — the
// surfaces position themselves (fixed/absolute) exactly as they did when they
// were direct children of app-root.

import {
  SHELL_SURFACE_REGISTRY_KEY,
  type ShellSurfaceRegistry,
} from '../../core/shell-surface-registry'
// Side-effect barrel: importing it runs each surface's module-scope
// registerShellSurface() so the registry is populated before first render.
import './shell-surfaces.barrel'

export class ShellSurfacesElement extends HTMLElement {
  readonly #registry = get(SHELL_SURFACE_REGISTRY_KEY) as ShellSurfaceRegistry | undefined
  readonly #mounted = new Map<string, HTMLElement>()
  #connected = false

  readonly #sync = (): void => {
    const surfaces = this.#registry?.all() ?? []
    const want = new Set(surfaces.map(s => s.name))
    for (const [name, node] of this.#mounted) {
      if (want.has(name)) continue
      node.remove()
      this.#mounted.delete(name)
    }
    let cursor: ChildNode | null = null
    for (const s of surfaces) {
      let node = this.#mounted.get(s.name)
      if (node) {
        // A surface may relocate itself after mount (history-viewer portals
        // to document.body) — never drag it back while enforcing order.
        if (node.parentElement !== this) continue
      } else {
        node = document.createElement(s.element)
        this.#mounted.set(s.name, node)
      }
      const next: ChildNode | null = cursor ? cursor.nextSibling : this.firstChild
      if (node !== next) this.insertBefore(node, next)
      cursor = node
    }
  }

  connectedCallback(): void {
    if (this.#connected) return
    this.#connected = true
    this.style.display = 'contents'
    this.#registry?.addEventListener('change', this.#sync)
    queueMicrotask(this.#sync)
  }

  disconnectedCallback(): void {
    if (!this.#connected) return
    this.#connected = false
    this.#registry?.removeEventListener('change', this.#sync)
    for (const node of this.#mounted.values()) node.remove()
    this.#mounted.clear()
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('hc-shell-surfaces')) {
  customElements.define('hc-shell-surfaces', ShellSurfacesElement)
}

declare global {
  interface HTMLElementTagNameMap {
    'hc-shell-surfaces': ShellSurfacesElement
  }
}
