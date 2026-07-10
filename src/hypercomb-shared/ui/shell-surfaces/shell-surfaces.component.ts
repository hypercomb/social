// hypercomb-shared/ui/shell-surfaces/shell-surfaces.component.ts
//
// The single host for registry-fed shell surfaces. A shell mounts ONE
// <hc-shell-surfaces> tag instead of enumerating every panel/strip/overlay in
// app.html; this component renders whatever is in the ShellSurfaceRegistry and
// reconciles when surfaces register or unregister (hot install, feature
// toggle, installer teardown).
//
// Two surface shapes render here:
//   • component — a standalone Angular component class (shell-side chrome)
//   • element   — a custom-element tag name (framework-free, drone-shippable:
//     the module defines the element and registers only the tag via IoC)
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

import { Component, ElementRef, ViewContainerRef, inject, type ComponentRef, type OnDestroy } from '@angular/core'
import {
  SHELL_SURFACE_REGISTRY_KEY,
  type ShellSurfaceRegistry,
} from '../../core'
// Side-effect barrel: importing it runs each surface's module-scope
// registerShellSurface() so the registry is populated before first render.
import './shell-surfaces.barrel'

type Mounted = { node: HTMLElement; ref?: ComponentRef<unknown> }

@Component({
  selector: 'hc-shell-surfaces',
  standalone: true,
  styles: [':host { display: contents; }'],
  template: '',
})
export class ShellSurfacesComponent implements OnDestroy {
  readonly #registry = get(SHELL_SURFACE_REGISTRY_KEY) as ShellSurfaceRegistry | undefined
  readonly #vcr = inject(ViewContainerRef)
  readonly #host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  readonly #mounted = new Map<string, Mounted>()

  readonly #sync = (): void => {
    const surfaces = this.#registry?.all() ?? []
    const want = new Set(surfaces.map(s => s.name))
    for (const [name, m] of this.#mounted) {
      if (want.has(name)) continue
      m.ref ? m.ref.destroy() : m.node.remove()
      this.#mounted.delete(name)
    }
    let cursor: ChildNode | null = null
    for (const s of surfaces) {
      let m = this.#mounted.get(s.name)
      if (m) {
        // A surface may relocate itself after mount (history-viewer portals
        // to document.body) — never drag it back while enforcing order.
        if (m.node.parentElement !== this.#host) continue
      } else {
        if (s.component) {
          const ref = this.#vcr.createComponent(s.component)
          m = { node: ref.location.nativeElement as HTMLElement, ref }
        } else if (s.element) {
          m = { node: document.createElement(s.element) }
        } else continue
        this.#mounted.set(s.name, m)
      }
      const next: ChildNode | null = cursor ? cursor.nextSibling : this.#host.firstChild
      if (m.node !== next) this.#host.insertBefore(m.node, next)
      cursor = m.node
    }
  }

  constructor() {
    this.#registry?.addEventListener('change', this.#sync)
    // Initial mount OUTSIDE the constructing change-detection pass —
    // createComponent during construction trips NG0100-class errors.
    queueMicrotask(this.#sync)
  }

  ngOnDestroy(): void {
    this.#registry?.removeEventListener('change', this.#sync)
    for (const m of this.#mounted.values()) m.ref ? m.ref.destroy() : m.node.remove()
    this.#mounted.clear()
  }
}
