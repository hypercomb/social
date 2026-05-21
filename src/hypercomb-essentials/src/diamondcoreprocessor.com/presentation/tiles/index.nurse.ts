// diamondcoreprocessor.com/presentation/tiles/index.nurse.ts
//
// IndexNurse — tends each cell's `index` property. The renderer reads
// from this nurse to place a tile at its permanent grid index in
// pinned mode.
//
// Per-cell only (no inheritance). Position is intrinsic to the cell;
// ancestors don't supply default positions.
//
// Source of truth contract: this nurse is the ONLY reader of the
// `index` property outside of bootstrap helpers. Any code that wants
// a cell's slot index goes through
// `IndexNurse.read(parentSegments, cellName, cellDir?, cacheKey?)`.
// The nurse reads the cell's layer's `properties` slot first
// (canonical), and falls back to the legacy `0000.index` file only
// when the layer slot is empty AND a `cellDir` handle is provided.
// `MoveDrone` and `show-cell.#orderByIndexPinned` write `index` via
// `writeTilePropertiesAt`; the broadcast invalidates this cache.

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

const _indexNurse = new IndexNurse()
;(window as any).ioc?.register?.(_indexNurse.iocKey, _indexNurse)
