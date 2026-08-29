// hypercomb-shim/src/surfaces.ts
//
// The framework-free half of <hc-shell-surfaces>. The registry
// (shared/core/shell-surface-registry.ts) holds two shapes per surface:
//
//   component: Type<unknown>  — an Angular class. Only shared/web/dev can
//                               supply one; the shim cannot render it.
//   element:   string         — a custom-element tag the contributor already
//                               defined. Framework-free by construction.
//
// The shim renders the `element` half and COUNTS the `component` half. That
// count is the migration scoreboard: it starts high and every panel converted
// to an element takes it down by one. When it reaches zero the Angular host
// has nothing left to render and can retire (plan doc, Phase 5).
//
// Reconciler contract, matching the Angular host so behaviour does not change
// under a converted panel:
//   • keyed by surface name — a survivor is NEVER recreated on a re-render
//   • order ascending, unset sorts last; that is the only stacking lever
//   • a surface that self-portals to document.body is left where it moved to
//   • remove() from the registry cascades the node out of the DOM

import { SHELL_SURFACE_REGISTRY_KEY } from '@hypercomb/shared/core/shell-surface-registry'
import type { ShellSurface, ShellSurfaceRegistry } from '@hypercomb/shared/core/shell-surface-registry'

/** Surfaces the shim mounted, by name. Survivors are reused, never rebuilt. */
const mounted = new Map<string, HTMLElement>()

/** Names whose registration is Angular-shaped, so the shim skipped them. */
const skipped = new Set<string>()

export interface SurfaceReport {
  /** Custom elements the shim actually mounted. */
  mounted: number
  /** Angular component registrations the shim cannot render. */
  angular: number
  /** Names of the Angular-shaped registrations, for the scoreboard. */
  angularNames: string[]
}

export const surfaceReport = (): SurfaceReport => ({
  mounted: mounted.size,
  angular: skipped.size,
  angularNames: [...skipped].sort(),
})

const hostElement = (): HTMLElement => {
  let host = document.getElementById('hc-surfaces')
  if (!host) {
    host = document.createElement('div')
    host.id = 'hc-surfaces'
    // The host must not become a layout or stacking context of its own —
    // every surface positions itself against the viewport, exactly as it
    // did under the Angular host.
    host.style.display = 'contents'
    document.body.appendChild(host)
  }
  return host
}

const render = (registry: ShellSurfaceRegistry): void => {
  const host = hostElement()
  const surfaces: ShellSurface[] = registry.all()
  const live = new Set<string>()

  for (const surface of surfaces) {
    live.add(surface.name)

    if (!surface.element) {
      // Angular-shaped. Nothing to mount here; count it once so the
      // scoreboard does not double-report across re-renders.
      skipped.add(surface.name)
      continue
    }

    if (mounted.has(surface.name)) continue

    // The contributor is responsible for customElements.define — at MODULE
    // scope, so a host without a registry still gets a defined tag. If the
    // definition has not landed yet the browser upgrades the node when it
    // does, so creating it now is safe either way.
    const node = document.createElement(surface.element)
    node.setAttribute('data-hc-surface', surface.name)
    mounted.set(surface.name, node)
  }

  // Teardown: a surface removed from the registry cascades out of the DOM.
  for (const [name, node] of [...mounted]) {
    if (live.has(name)) continue
    node.remove()
    mounted.delete(name)
  }
  for (const name of [...skipped]) {
    if (!live.has(name)) skipped.delete(name)
  }

  // Order pass. Re-appending a node that is already in the right place is a
  // no-op for the browser, and appendChild MOVES rather than recreates, so
  // listeners and element state survive. A surface that portaled itself to
  // document.body is deliberately left alone.
  for (const surface of surfaces) {
    const node = surface.element ? mounted.get(surface.name) : undefined
    if (!node) continue
    if (node.parentElement && node.parentElement !== host) continue
    host.appendChild(node)
  }
}

/**
 * Mount every element-shaped shell surface and keep mounting them as modules
 * register late. Returns the first report; call surfaceReport() for the live
 * numbers afterwards.
 */
export const mountSurfaces = (): SurfaceReport => {
  const registry = window.ioc?.get<ShellSurfaceRegistry>(SHELL_SURFACE_REGISTRY_KEY)
  if (!registry) {
    console.warn('[shim] no ShellSurfaceRegistry — no surfaces mounted')
    return surfaceReport()
  }

  render(registry)
  // Bees register their surfaces as their modules evaluate, which continues
  // well past first paint. The registry announces every change.
  registry.addEventListener('change', () => render(registry))
  return surfaceReport()
}
