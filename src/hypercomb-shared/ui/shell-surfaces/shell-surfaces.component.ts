// hypercomb-shared/ui/shell-surfaces/shell-surfaces.component.ts
//
// The single host for registry-fed shell surfaces. A shell mounts ONE
// <hc-shell-surfaces> tag instead of enumerating every panel/strip/overlay in
// app.html; this component renders whatever is in the ShellSurfaceRegistry and
// rebuilds when surfaces register or unregister (hot install, feature toggle,
// installer teardown).
//
// `:host { display: contents }` keeps the host layout-transparent — the
// surfaces position themselves (fixed/absolute) exactly as they did when they
// were direct children of app-root.

import { Component } from '@angular/core'
import { NgComponentOutlet } from '@angular/common'
import {
  fromRuntime,
  SHELL_SURFACE_REGISTRY_KEY,
  type ShellSurface,
  type ShellSurfaceRegistry,
} from '../../core'
// Side-effect barrel: importing it runs each surface's module-scope
// registerShellSurface() so the registry is populated before first render.
import './shell-surfaces.barrel'

@Component({
  selector: 'hc-shell-surfaces',
  standalone: true,
  imports: [NgComponentOutlet],
  styles: [':host { display: contents; }'],
  template: `
    @for (surface of surfaces(); track surface.name) {
      <ng-container *ngComponentOutlet="surface.component"></ng-container>
    }
  `,
})
export class ShellSurfacesComponent {
  readonly #registry = get(SHELL_SURFACE_REGISTRY_KEY) as ShellSurfaceRegistry | undefined

  protected readonly surfaces = fromRuntime<ShellSurface[]>(
    this.#registry,
    () => this.#registry?.all() ?? [],
  )
}
