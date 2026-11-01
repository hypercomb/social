// comfy-desk/assets/assets.ts
//
// THE ASSETS ARE THE POOL. Every picture a run makes is already a resource and
// already has a member in `comfy:generations`, named by the picture's own
// signature (comfy/comfy.service.ts). So there is no second list to keep and
// nothing to copy: the shelf reads the pool, and the bytes stay at their
// signature until something names them.

import { isSignature } from '@hypercomb/core'
import { COMFY_GENERATIONS_POOL, type ComfyGenerationRecord } from '../../comfy/comfy.service.js'
import type { Asset, AssetsPart } from '../parts.js'

const WORDS_SHOWN = 8

type PoolFile = { size: number; text(): Promise<string> }
type PoolDir = { entries(): AsyncIterable<[string, { kind: string; getFile?: () => Promise<PoolFile> }]> }
type AssetStore = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<PoolDir | null>
  getResource?: (sig: string) => Promise<Blob | null>
}

const liveStore = (): AssetStore | undefined =>
  window.ioc?.get?.('@hypercomb.social/Store') as AssetStore | undefined

/** A member read back. Anything that is not a generation stays out of the list. */
export const recordOf = (body: string): ComfyGenerationRecord | null => {
  try {
    const parsed = JSON.parse(body) as ComfyGenerationRecord
    return parsed?.kind === 'comfy-generation@1' ? parsed : null
  } catch { return null }
}

export const listAssets = async (store: AssetStore | undefined = liveStore()): Promise<readonly Asset[]> => {
  if (!store?.getPool) return []
  try { await store.initialize?.() } catch { /* boot handles its own failure */ }
  const pool = await store.getPool(COMFY_GENERATIONS_POOL)
  if (!pool) return []
  const found: Asset[] = []
  try {
    for await (const [sig, handle] of pool.entries()) {
      if (handle.kind !== 'file' || !isSignature(sig) || !handle.getFile) continue
      try {
        const file = await handle.getFile()
        const record = file.size ? recordOf(await file.text()) : null
        if (record) found.push({ sig, record })
      } catch { /* one unreadable member stays out of the list */ }
    }
  } catch { return [] }
  return found.sort((a, b) => (b.record.at - a.record.at) || (a.sig < b.sig ? -1 : 1))
}

/** The name it was given, else the first words that made it. */
export const nameOfAsset = (asset: Asset): string => {
  const { name, positive } = asset.record
  if (name) return name
  const words = (positive ?? '').trim().split(/\s+/).filter(Boolean)
  return words.slice(0, WORDS_SHOWN).join(' ') || asset.sig.slice(0, 8)
}

export const assetsPart: AssetsPart = {
  list: () => listAssets(),
  nameOf: nameOfAsset,
  url: async sig => {
    try {
      const blob = await liveStore()?.getResource?.(sig)
      return blob ? URL.createObjectURL(blob) : null
    } catch { return null }
  },
}
