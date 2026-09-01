# Wave view — hold Alt to dive into the layers under a tile

Hold **Alt** with the pointer over a tile and the page is replaced by what is
inside it: the tile's children take over the grid, at full size, in the same
slots a real layer would put them in. **Alt + wheel** goes a generation deeper
(grandchildren, then great-grandchildren) or rises back up. **Release Alt** and
everything snaps back exactly as it was — nothing moved, nothing was written;
the dive was only ever a look.

## The tiles are the tiles underneath

A dive is not a picture of the tiles below — it *is* those tiles. The wave view
resolves the generation (a read-only merkle walk, cached by signature) and
hands it to show-cell as `render:dive`; show-cell paints it through the **same
SDF shader, the same label and image atlases and the same geometry packer** it
paints the page with. Identity colours, rims, branch dots, hidden names that
reveal under the pointer, portal shimmer: whatever a tile shows on its own page
it shows in the dive, because it is the same code drawing it.

Each dived tile's face is resolved the way the page resolves it: the effective
properties (`readTilePropertiesAt` — root defaults under the layer's own
overrides), the participant-local props index when the canonical slot is
cold, and the substrate's deterministic pick when the tile has no picture at
all. The picture key is `recoverableTileImageSig`, the renderer's own.

While the dive is up, show-cell holds its own paint: the page's mesh is hidden
(not torn down), the atlases pin the union of the page and the dive, and a
synchronize that lands mid-dive is deferred until the dive ends and re-requested
then. The wave view owns the pointer meanwhile — moves and presses stop at
window capture — so tile-overlay cannot act on the page underneath.

## Clicking a dived tile executes it as if it stood in front of you

A click (Alt still held) does what a click on the real tile would do:

| The dived tile is… | The click… |
|---|---|
| a **reference** (portal) | travels **through** it to the target — never into the portal cell |
| anything else | **enters** it; if the layer opens as a view (a website, a tree — its own `view:default` mark or the nearest ancestor's), that view opens |

The dive is a way to *go and activate something and stay*. So before it
travels, the wave view announces a `view:spawn` record naming the **page the
dive was made from** and the surface that was up. A view that opens on arrival
comes back out **there** — not on the tile's own page, which the participant
never chose to stand on. Websites already do this through their own arrival
rule (`embedded-sites.md` → *Coming back out*); every other view gets the same
answer through the spawn record (`stepping-into-a-view.md`).

The rule is pure — `diveClickPlan` in `presentation/tiles/wave-layout.ts`,
covered by `wave-layout.spec.ts`.

## Effects

| Effect | Direction | Payload |
|---|---|---|
| `render:dive` | wave-view → show-cell | `{ cells: DiveCell[] \| null }` — paint this generation in place, or restore the page |
| `render:dive-hover` | wave-view → show-cell | `{ label }` — the dived tile under the pointer |
| `render:dive-painted` | show-cell → anyone | `{ count }` — what is on screen; `0` when the page is back |
| `view:spawn` | wave-view → views | the page to come back out to (see `view-spawn.ts`) |

`DiveCell` is `{ q, r, label, imageSig?, hasBranch, hideText, borderColor?, portal }`
— only what the packer needs; everything location-scoped (selection, shade,
peer colour, hidden dimming) is deliberately absent, because it belongs to the
page underneath and not to the generation being looked at.

## Verify

`node scripts/drive-wave-dive.cjs --url http://localhost:4253` — seeds a
three-generation branch on a fresh hive, dives, wheels a generation deeper,
clicks a dived tile and checks the explorer landed on it, and releases Alt to
confirm the page came back untouched. Screenshots land in `--out`.
