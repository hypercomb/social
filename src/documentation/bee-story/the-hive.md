# the hive

a honeycomb is not built from a blueprint. bees secrete wax from their bodies, shape it with their mandibles, and build one cell at a time. each cell is a hexagon — not because someone decided hexagons look nice, but because hexagons are the most efficient way to tile a plane. maximum space, minimum material. nature arrived at this answer millions of years before humans named it.

hypercomb builds its world the same way.

---

## the shape

the hive is a hexagonal grid. each cell has six neighbors — no more, no less. this is not a design choice. it is a geometric fact. hexagons tile perfectly. there are no gaps, no wasted space, no orphan cells.

in the architecture, each cell is an `AxialCoordinate` — three numbers (q, r, s) bound by the constraint q + r + s = 0. this is the cube coordinate system. it makes neighbor lookup trivial: add or subtract 1 from any pair of axes, and you have an adjacent cell.

the `AxialService` builds the hive outward from the center in concentric rings, exactly as real bees build comb — center first, then expanding ring by ring. by the time the matrix is complete, every cell knows its six neighbors.

---

## the space

a real hive exists only while bees inhabit it. an abandoned hive is wax and memory — the life is gone. hypercomb works the same way. the hex grid is rendered live via pixi.js. when drones are active, the hive blooms on screen. when they dispose, the rendering clears. there is no saved state of "what the hive looked like." the hive is what is happening now.

this is the first principle: **presence is the hive.**

---

## the structure

real honeycomb has purpose built into its geometry. brood cells, honey cells, pollen cells — all hexagons, but each used differently depending on what the colony needs.

hypercomb's hex cells work the same way. a cell is a coordinate, but what happens at that coordinate depends on which drones are active and what effects they've emitted. one cell might host rendered content. another might be a navigation waypoint. another might carry a pheromone signal. the geometry is fixed. the meaning is live.

---

## what the hive is not

the hive is not a database. it is not a feed. it is not a profile page. there is no server storing what happened at coordinate (3, -1, -2) yesterday. if you want something to persist, you must choose to publish it — and that is a separate act, described in [the memory](./the-memory.md).

the hive is a living room, not a filing cabinet.

---

*a single hexagon has six neighbors. six hexagons make a ring. the rings expand outward, and the hive grows. this is all it takes.*
