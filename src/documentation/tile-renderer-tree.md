# The tile renderer — the tree

show-cell (`hypercomb-essentials/src/presentation/tiles/show-cell.drone.ts`)
is the bee that paints a layer's tiles. It was one file holding every
behaviour a tile has; it is being drawn out as a tree, from the top down
([life-primitive.md](life-primitive.md) rule 13), so each behaviour is a
module of its own, named for what it means, and the next development can see
which branch it belongs on.

The root keeps only what it alone can do: run the render pass and compose the
branches. A branch owns its state and says, through a small host interface,
what it needs from the renderer (where the participant stands, how to paint
again). The drone keeps registering the listeners, so every effect it
declares stays true, and hands each one to its branch in one line.

```
show-cell                          the render pass: synchronize → member names → order
│                                  → cells → geometry → paint; the listeners; the lifecycle
│
├── membership      ✓ layer-membership.ts   which tiles a layer holds: child sigs → names,
│   │                                       branches learned on the way; the optimizer's thin-pack upgrade
│   └── packed visuals ✓ packed-visuals.ts  visuals a layer's manifest carries, bounded, by source sig
├── narrowing       ✓ tile-narrowing.ts     the tag lens (OR), a reference's requirement (AND),
│                                           a gathered set; the cross-page walk; flatten paths and refusals
├── order           ✓ tile-order.ts         which slot each tile takes: indexed → peer index → score-fill
│                                           (session only, never persisted) → frame; placing a new tile
├── mesh            ✓ tile-mesh.ts          the kind-29010 path: this page's public tiles out, the peers'
│                                           tiles in (newest snapshot wins), sync requests; gated by room + secret
├── readiness       ✓ tile-readiness.ts     is the inside of a branch ready: the verdict (children local,
│                                           destination prepared, names and images resident), the per-location
│                                           memo, the warm and bake queues, repair after an atlas eviction.
│                                           Painting the shade stays with the renderer.
├── faces           ✓ tile-faces.ts         what each tile shows: its picture and its properties' facts (border,
│                                           tags, link, substrate, hidden name), cached by label per location;
│                                           host fills detached, never awaited; a peer's tile from its projection
├── fill geometry   ✓ tile-fill-geometry.ts the tiles as the GPU draws them: one quad per tile and every
│                                           attribute the hex shader reads, asked of the renderer's look;
│                                           pure — and the key that says when a bake is stale
├── dive            ✓ tile-dive.ts          another layer's tiles painted in place of this page's, through its
│                                           own shader and packer; the page hidden, never torn down, given back
├── previews        ✓ tile-previews.ts      looks not yet true: the marks' carriers (hover ANY, in hand or dragged
│                                           ALL) and the tile editor's edit, painted in place, never persisted
├── hover           ○ inside                the hovered tile's reveal and opacity (single-cell writes)
└── landing         ○ inside                quiet landing: held renders and the pending badge
```

✓ is a module beside the drone, with its own spec; ○ is still inside
show-cell. `doctrine.spec.ts` holds show-cell to a line ceiling that may only
fall, so a new tile behaviour is a branch of its own from the start.

**Adding to it.** Find the branch the behaviour belongs to. If it has a module,
the change goes there; if the branch is still inside, draw it out first. A
behaviour that belongs to no branch is a new one: a module beside the drone
with its host interface, composed in the drone, and a line here.
