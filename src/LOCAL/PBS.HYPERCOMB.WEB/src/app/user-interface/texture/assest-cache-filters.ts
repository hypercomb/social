// cache filter helpers
// - provide stable keys for assets cache lookups
// - wraps around cell so you don't repeat the cacheKey logic inline

import { Cell } from "src/app/cells/cell"

export const assetCacheKey = (cell: Cell): string => {
    const cid = (cell as any).cellId ?? (cell as any).id ?? 'unknown'
    const version = cell.hash ?? cell.updatedAt ?? ''
    const state = cell.options() ?? 0
    return `${cid}|v=${version}|f=${state}`
}
