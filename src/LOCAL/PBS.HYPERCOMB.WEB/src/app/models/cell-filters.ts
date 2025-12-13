// src/app/models/cell-filters.ts

import { Sprite } from "pixi.js"
import { CellOptions as CellOptions } from 'src/app/cells/models/cell-options'
import { Cell } from "./cell"


export type CacheKeyOptions = {
    size?: number
    scale?: number
    state?: number
    version?: number | string
    styleKey?: string
}
// -----------------------------------------------------------
// flag helpers (bit flags)
// -----------------------------------------------------------

export function setFlag(cell: Cell, flag: CellOptions) {
    ; (cell as any).flags = ((cell as any).flags ?? 0) | flag
}

export function clearFlag(cell: Cell, flag: CellOptions) {
    ; (cell as any).flags = ((cell as any).flags ?? 0) & ~flag
}

export function hasFlag(cell: Cell, flag: CellOptions): boolean {
    return (((cell as any).flags ?? 0) & flag) === flag
}

// -----------------------------------------------------------
// blob url helpers (dedup + safe revoke)
// -----------------------------------------------------------

const _blobUrlCache = new WeakMap<Blob, string>()
const _revokerPatched = Symbol('revokerPatched')

export function getOrCreateBlobUrl(data: Cell): string | null {
    if (!data.blob) return null
    const existing = _blobUrlCache.get(data.blob)
    if (existing) return existing
    const url = URL.createObjectURL(data.blob)
    _blobUrlCache.set(data.blob, url)
    return url
}

export function attachUrlRevoker(sprite: Sprite, url: string) {
    if ((sprite as any)[_revokerPatched]) return
        ; (sprite as any)[_revokerPatched] = true

    const originalDestroy = sprite.destroy.bind(sprite)
    sprite.destroy = (...args: any[]) => {
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
        originalDestroy(...args)
    }
}

