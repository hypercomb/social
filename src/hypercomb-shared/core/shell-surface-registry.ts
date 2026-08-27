// hypercomb-shared/core/shell-surface-registry.ts
//
// Registry for top-level UI SURFACES — framework-free panels, strips and
// overlays mounted by the single <hc-shell-surfaces> custom element.
//
// This is IconProviderRegistry one notch up the stack. Where an icon provider
// contributes SVG markup, a shell surface contributes its custom-element tag.
// A single host reconciles the elements whenever the set changes. Consequences:
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

export type ShellSurface = {
  /** Unique key — by convention the component's selector (e.g. 'hc-notes-strip'). */
  name: string
  /** IoC key / class name of the contributor, for introspection only. */
  owner?: string
  /** Custom-element tag name defined by the contributing bundle. */
  element: string
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
      // A signed package may be inflated more than once. The first surface
      // wins and the repeat is a normal idempotent registration.
      return
    }
    if (!surface.element) {
      console.warn(`[shell-surface-registry] "${surface.name}" must provide an element tag — ignoring`)
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
 * Self-register a shell surface from its defining module. Call at module scope
 * after customElements.define(), so importing the module is the registration.
 */
export function registerShellSurface(surface: ShellSurface): void {
  const registry = get(SHELL_SURFACE_REGISTRY_KEY) as ShellSurfaceRegistry | undefined
  registry?.add(surface)
}
