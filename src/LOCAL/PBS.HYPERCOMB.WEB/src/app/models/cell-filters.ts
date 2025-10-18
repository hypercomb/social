// src/app/models/cell-filters.ts

// -----------------------------------------------------------
// cache ids / keys
// -----------------------------------------------------------

import { Sprite } from "pixi.js"
import { CellOptions as CellOptions } from 'src/app/cells/models/cell-options'
import { Cell } from "../cells/cell"

export type CacheKeyOptions = {
    size?: number
    scale?: number
    state?: number
    version?: number | string
    styleKey?: string
}
export function cacheKey(cell: Cell, opts: CacheKeyOptions = {}): string {
    const id = cacheId(cell)
    const version = opts.version ?? (cell as any).updatedAt ?? (cell as any).version ?? 0
    const state = opts.state ?? (cell as any).flags ?? 0
    const size = opts.size ?? 0
    const scale = opts.scale ?? 1
    const style = opts.styleKey ?? ''
    return `${id}|v=${version}|s=${size}|x=${scale}|f=${state}|sty=${style}`
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

export function blobUrlForSprite(data: Cell, sprite: Sprite): string | null {
    if (!data.blob) return null
    const url = getOrCreateBlobUrl(data)!
    attachUrlRevoker(sprite, url)
    return url
}


