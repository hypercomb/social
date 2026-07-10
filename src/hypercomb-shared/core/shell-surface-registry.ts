// hypercomb-shared/core/shell-surface-registry.ts
//
// Shell-side registry for top-level UI SURFACES — the panels, strips, and
// overlays that today are hand-mounted, one <hc-*> tag at a time, in each
// shell's app.html.
//
// This is IconProviderRegistry one notch up the stack. Where an icon provider
// contributes SVG markup, a shell surface contributes its standalone Angular
// component CLASS. A single host component (<hc-shell-surfaces>) reads this
// registry and renders every surface via ngComponentOutlet, rebuilding whenever
// the set changes. The shell template stops enumerating panels — it renders the
// registry. Consequences:
//
//   • Two app.html files can no longer drift (there is one list, not two).
//   • A feature whose module never loads never registers — so its surface never
//     mounts. No `@if (featureEnabled)` anywhere in the shell.
//   • remove() is the teardown half: drop the registration and the surface
//     cascades out of the DOM. Nothing is left behind.
//
// This is the `interface` stage of the vertical-pipeline standard: a behaviour
// surfaces its UI ONLY by registering here, never by being wired into a
// template. See documentation and the IconProviderRegistry precedent.
//
// EventTarget so the host rebuilds when surfaces register/unregister
// mid-session (hot install, feature toggle, two-way installer teardown).

import type { Type } from '@angular/core'

export type ShellSurface = {
  /** Unique key — by convention the component's selector (e.g. 'hc-notes-strip'). */
  name: string
  /** IoC key / class name of the contributor, for introspection only. */
  owner?: string
  /**
   * Shell-side shape: a standalone Angular component class. Only code that
   * already lives in shared/web/dev can use this — modules cannot.
   */
  component?: Type<unknown>
  /**
   * Module-side shape: a custom-element tag name. The contributor defines the
   * element (customElements.define) and registers just the tag — no Angular,
   * no shared import. This is how a DRONE ships shell UI: resolve this
   * registry via IoC (SHELL_SURFACE_REGISTRY_KEY) and add({name, element}).
   * Exactly one of component | element per surface.
   */
  element?: string
  /**
   * Mount order (ascending). All surfaces share one host container, so this
   * is the only lever over DOM / stacking order. Unset sorts last.
   */
  order?: number
}

export class ShellSurfaceRegistry extends EventTarget {

  #surfaces = new Map<string, ShellSurface>()

  add(surface: ShellSurface): void {
    if (this.#surfaces.has(surface.name)) {
      console.warn(`[shell-surface-registry] duplicate name "${surface.name}" — ignoring`)
      return
    }
    if (!surface.component === !surface.element) {
      console.warn(`[shell-surface-registry] "${surface.name}" must provide exactly one of component | element — ignoring`)
      return
    }
    this.#surfaces.set(surface.name, surface)
    this.dispatchEvent(new CustomEvent('change'))
  }

  remove(name: string): void {
    if (!this.#surfaces.delete(name)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  all(): ShellSurface[] {
    return [...this.#surfaces.values()].sort(
      (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity),
    )
  }
}

export const SHELL_SURFACE_REGISTRY_KEY = '@hypercomb.social/ShellSurfaceRegistry'

register(SHELL_SURFACE_REGISTRY_KEY, new ShellSurfaceRegistry())

/**
 * Self-register a shell surface from the component's own module. Call at module
 * scope, directly after the @Component class, so the surface contributes itself
 * just by being imported — exactly the way drones contribute icons in their
 * constructor. The registry singleton is created by this module's own top-level
 * register() above, so it always exists by the time a consumer imports this fn.
 */
export function registerShellSurface(surface: ShellSurface): void {
  const registry = get(SHELL_SURFACE_REGISTRY_KEY) as ShellSurfaceRegistry | undefined
  registry?.add(surface)
}
