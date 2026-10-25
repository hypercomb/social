// presentation/tiles/index.nurse.ts
//
// IndexNurse — reads the `index` an OLDER build wrote inside a tile.
//
// Where a tile sits is now its PAGE's claim: the page's `order` slot
// (history/tile-order.ts), read by show-cell `#orderByIndexPinned` before
// anything here. This nurse answers only for a tile its page does not
// seat yet — the read-only fallback for hives arranged before the move,
// never rewritten (data moves forward, it does not heal). Nothing writes
// `index` into a tile any more.
//
// The read: the cell's layer's `properties` slot first, then the legacy
// `0000.index` file only when the layer slot is empty AND a `cellDir`
// handle is provided.

import { NurseBee } from '../../history/nurse.bee.js'

export class IndexNurse extends NurseBee<number> {

  readonly namespace = 'diamondcoreprocessor.com'
  readonly attribute = 'index'

  protected parse(raw: unknown): number | undefined {
    if (typeof raw !== 'number') return undefined
    if (!Number.isFinite(raw)) return undefined
    if (raw < 0) return undefined
    return raw
  }
}

// presentation/tiles/show-cell.drone.ts — the first paint reads it registers this (atomic-modules-plan.md): a dependency registers nothing.
