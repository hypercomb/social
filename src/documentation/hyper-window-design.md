# Hyper window design

Hyper windows are the application's management, authoring, inspection, and
selection surfaces. They share one visual language even when each window keeps
its own accent colour.

Website content is outside this contract. A website is a rendered experience
and may define its own design system.

## Shape

- Docked windows meet the viewport edge with square corners.
- Floating windows use a 5px radius.
- Cards and managed-object rows use a 4px radius.
- Inputs, buttons, icon wells, and segmented controls use a 2px radius.
- Fully rounded geometry is reserved for things that are semantically round:
  status pills, toggles, avatars, and circular progress nodes.

The source of truth is `hypercomb-shared/ui/_toolwindow.scss`. New Hyper
windows use its `panel`, `floating-panel`, `header`, `control`, `card`, and
`icon-button` primitives instead of restating material, elevation, and shape.

Text actions use the shared compact button padding, reduced to 80% of the
previous rhythm. Fixed-size icon buttons and minimum touch-target heights keep
their explicit dimensions.

## Behavior identity

Every registered visual behavior declares its own unique Material Symbols
ligature in `VisualBeeDescriptor.toggleIcon`.

The registry rejects a missing or duplicate behavior icon. Behavior and Views
managers render this declared icon; they do not substitute a common extension
glyph. Non-registry capabilities declare an equally specific icon beside their
metadata in `show-features.drone.ts`.

An icon says *which behavior this is*. Status, origin, inheritance, and trust
remain separate badges or text and never replace the behavior's identity.

On hive tiles, clicking the tile body always performs normal navigation.
Behavior views open only from their own on-tile icons. A preferred/default view
accents its icon; it never takes over the tile's primary click.

## Window structure

Hyper windows follow the same hierarchy:

1. Header: identity, title, global actions.
2. Context: the tile, scope, or object being managed.
3. Search/filter when the catalogue can grow.
4. Managed-object rows with identity first and state/action last.
5. Quiet implementation metadata below the human label.

Accent colour identifies a tool family. It does not change the shell material,
corner system, spacing rhythm, or interaction shapes.

Each dock edge is a single-window lane. Opening a Hyper window closes every
other window on that same side. A floating surface is outside the lane; any
future multi-window layout must opt out explicitly and own its arrangement.
