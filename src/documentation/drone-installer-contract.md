# Drone Installer Contract

This is the contract a drone must follow so that DCP's installer can turn it
off and have its UI **and** its behavior actually disappear from the running
shell.

## Why the contract exists

The installer prunes content at the **file** level. When a drone is toggled
off in DCP:

1. The sentinel re-walks the enabled layer tree and excludes the disabled bee
   from the sync manifest.
2. The web shell removes that bee's file from OPFS.
3. The dynamic import for that bee never resolves on next boot — the module
   body never runs.

The drone's enforcement story is therefore: **if the module body never runs,
nothing the drone does should leak into the shell.** The contract below is
just the consequence of that one invariant.

## The four rules

### 1. The only top-level side effect is one IoC registration

The last line of the bee's source file should be a single
`window.ioc.register(key, new DroneClass())` call. Nothing else at module
scope.

```ts
// ✅ tile-editor.drone.ts
window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorDrone',
  new TileEditorDrone(),
)
```

If you put anything else at top level — an event listener, a prototype
decoration, a `globalThis.foo = …`, an `EffectBus.on(...)` — that side effect
will exist as long as **someone else** triggered the import. With the
installer it can't run, but during dev or partial loads it still runs and the
shell's behavior depends on it. That coupling is the bug.

### 2. All UI registration happens in the constructor

If a drone contributes UI — an icon, a panel, a command, a slash behavior —
it registers it from the constructor by calling into the relevant registry
that was already published in IoC by the shell.

```ts
// ✅ tile-editor.drone.ts — constructor
constructor() {
  EffectBus.on<TileActionPayload>('tile:action', this.#onTileAction)

  const registry = window.ioc.get<IconProviderRegistry>(
    '@hypercomb.social/IconProviderRegistry',
  )
  registry?.add({
    name: 'edit',
    owner: '@diamondcoreprocessor.com/TileEditorDrone',
    svgMarkup: EDIT_ICON_SVG,
    profile: 'private',
    hoverTint: 0xc8d8ff,
    labelKey: 'action.edit',
    descriptionKey: 'action.edit.description',
  })
}
```

Toggling the drone off → file evicted → constructor never runs →
`registry.add(...)` never executes → the icon never reaches the shell. No
extra teardown logic is needed.

### 3. No top-level subscriptions

Subscribe to `EffectBus`, `window`, `document`, BroadcastChannels, etc. from
the constructor — never at module scope. The constructor is owned by the
drone instance, so its subscriptions live and die with the drone.

```ts
// ❌ wrong — runs even before/instead of construction
EffectBus.on('tile:action', payload => …)

// ✅ right — bound to the drone instance
constructor() {
  EffectBus.on<TileActionPayload>('tile:action', this.#onTileAction)
}
```

### 4. The shell publishes the registry; the drone consumes it

The pattern is always:

- Shell or supporting service registers a synchronous registry in IoC
  (e.g. `IconProviderRegistry`, slash registry, command palette, panel host).
- Drones look up that registry in their constructor and `add(...)` to it.
- The shell renders only what the registry currently contains.

This keeps the contribution path **pull-only**: when a drone isn't loaded,
its contribution simply isn't in the registry. There is no diff, no removal
event, no "is the editor enabled?" check anywhere in the shell.

## Mental model

> A drone's import is a one-shot registration. If the file is gone, the
> registration never happens, and the shell — which only renders what's been
> registered — is unaffected.

If you find yourself writing shell code that asks "is drone X turned on?",
that is a sign the drone is leaking outside its registration. Move the
contribution behind a registry that the drone populates from its constructor.

## Canonical example

`hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-editor.drone.ts`
is the reference implementation. It contributes the pencil-edit icon to
tiles, listens for `tile:action`, opens the editor service, and writes
properties on save — all from a single constructed instance. Toggling the
"editor" drone off in DCP cleanly removes the icon and disables the action
without any shell-side conditional.

## Enforcement

The installer treats this as a contract, not a suggestion. Drones that
violate any of the four rules will appear to "work" during development
(direct dev-time imports run all top-level code) but will leak UI or behavior
in production after a toggle, because their side effects were never tied to
their construction.

When reviewing or porting a drone, check the file in this order:

1. Is the **last line** a single `window.ioc.register(...)`? If not, fix it.
2. Are all `EffectBus.on` / `addEventListener` / registry `add(...)` calls
   inside the constructor? If not, move them.
3. Does any **shell** code ask "is this drone present?" instead of reading a
   registry? If so, introduce a registry and have the drone contribute to it.
