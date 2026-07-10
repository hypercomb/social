# Shell Surfaces — the registry-fed shell

A **shell surface** is a top-level UI panel, strip, overlay, or viewer that
mounts at the shell root (what used to be a hand-written `<hc-*>` tag in
`app.html`). Since 2026-07-09 the shells do not enumerate surfaces: each shell
template mounts **one** `<hc-shell-surfaces>` host, and every surface
contributes itself through the `ShellSurfaceRegistry`.

```
hypercomb-shared/core/shell-surface-registry.ts    ← registry + registerShellSurface()
hypercomb-shared/ui/shell-surfaces/
  shell-surfaces.component.ts                      ← the ONE host (keyed reconciler)
  shell-surfaces.barrel.ts                         ← the ONE list (side-effect imports)
```

## Why

Two shells (web, dev) each maintaining a parallel tag list was a standing bug
class: a feature's data layer works everywhere, but its panel silently never
renders in production because web's template is missing the selector (the
2026-04-28 notes incident). With the registry there is one list, not two —
drift is structurally impossible, and the doctrine ratchet
(`doctrine.spec.ts`, "shell templates mount only structural chrome") fails the
suite if anyone reintroduces a template tag.

## The two surface shapes

```typescript
export type ShellSurface = {
  name: string             // unique key — by convention the tag/selector
  owner?: string           // IoC key of the contributor, introspection only
  component?: Type<unknown> // SHELL shape: standalone Angular component class
  element?: string          // MODULE shape: custom-element tag name
  order?: number            // mount order (ascending) — the only DOM/stacking lever
}
```

Exactly one of `component | element` per surface (`add()` warns and ignores
otherwise; duplicate names are ignored the same way).

**`component`** is for code that already lives in shared/web/dev — Angular
chrome. **`element`** is the module-side shape and the externalization path:
a drone defines a framework-free custom element (`customElements.define`) in
its own bundle and registers only the tag. No Angular import, no shared
import — the dependency direction (modules → core only) holds.

## Registering

**Shell-side (shared/ui component)** — module scope, directly after the
`@Component` class, so importing the module IS the registration:

```typescript
import { registerShellSurface } from '../../core/shell-surface-registry'

@Component({ selector: 'hc-notes-strip', ... })
export class NotesStripComponent { ... }

registerShellSurface({
  name: 'hc-notes-strip',
  owner: '@hypercomb.shared/NotesStripComponent',
  component: NotesStripComponent,
  order: 10,
})
```

Then add the side-effect import to `shell-surfaces.barrel.ts` — never a tag to
an `app.html`.

**Module-side (drone)** — resolve the registry via IoC and register a tag:

```typescript
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry) => {
  customElements.define('my-panel', class extends HTMLElement { ... })
  registry.add({ name: 'my-panel', owner: '@my-domain.com/MyDrone', element: 'my-panel', order: 500 })
})
```

`registry.remove(name)` is the teardown half — the vertical-pipeline
`interface` stage: drop the registration and the surface cascades out of the
DOM. A feature whose module never loads never registers, so its surface never
mounts — no `@if (featureEnabled)` anywhere in the shell.

## Order bands

`order` ascending; unset sorts last. Current bands (see the barrel for the
authoritative list):

| Band | Meaning |
|---|---|
| 1–2 | pre-anchor chrome (selection context menu, history viewer) |
| 10 / 60 / 61 | the original three registry surfaces (notes-strip, website-landing, collections-landing) |
| 100–400 | the 2026-07-09 drain, in web's historical DOM order (steps of 10) |
| 500+ | module-contributed surfaces (suggested) |

## Host semantics

`<hc-shell-surfaces>` (`display: contents`, layout-transparent) reconciles
**keyed by name** on every registry `change`:

- newcomers mount, departed surfaces unmount — **survivors are never
  recreated**, so an open panel keeps its state when an unrelated surface
  hot-installs or tears down;
- DOM order always equals registry order — nodes are *moved*, not rebuilt,
  when position changes;
- `component` surfaces render via `ViewContainerRef.createComponent`;
  `element` surfaces via `document.createElement`. Both end up as ordinary
  children of the host and position themselves (fixed/absolute) exactly as
  when they were direct children of `app-root`.

Note: a surface may relocate itself after mount (history-viewer portals to
`document.body`) — counting host children finds it absent by design.

## What stays in the templates

Only bound or structural chrome: the header bar (command line / app-header,
upgrade + sync indicators, mesh header), `router-outlet`, the Pixi host div,
`hc-controls-bar` + `hc-edit-actions` (live `meshPublic`/`viewActive()`
bindings), and web's install prompt. The doctrine ratchet's allowlist is the
exact inventory; it may only shrink.
