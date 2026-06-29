// hypercomb-web/src/app/layer-service.ts

import { Injectable } from '@angular/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { Store } from '@hypercomb/shared/core'

export type LayerFile = { signature: string; name?: string; layers?: string[]; bees?: string[]; dependencies?: string[] }

@Injectable({ providedIn: 'root' })
export class LayerService {

  // local: hive root `__hive__/<signature>` (flat, sig-keyed) via the Store
  //        resolver, which falls back to the legacy `__layers__` pool.
  // remote: <endpoint>/<rootSig>/<signature> through the sentinel bridge.
  public get = async (parsed: LocationParseResult, signature: string): Promise<LayerFile | null> => {
    const rootSig = (parsed?.signature ?? '').trim()
    const requestedSig = (signature ?? '').trim()

    if (!rootSig || !requestedSig) return null

    const store = get('@hypercomb.social/Store') as Store

    // step 1: local lookup through the central resolver — root-first
    // (`__hive__/<sig>`) with the legacy `__layers__` pool as fallback.
    const localBytes = await store.getLayerBytes(requestedSig)
    if (localBytes) {
      const layer = this.tryParseLayer(new TextDecoder().decode(localBytes).trim(), requestedSig)
      if (layer) return layer
    }

    // step 2: remote fetch -> save -> return
    // Prefer sentinel bridge (DCP) if connected — isolates server contact
    const bridge = (globalThis as any).__sentinelBridge
    if (bridge?.fetchContent) {
      try {
        const buf: ArrayBuffer | null = await bridge.fetchContent(requestedSig, 'layer', rootSig)
        if (buf) {
          const layer = this.tryParseLayer(new TextDecoder().decode(new Uint8Array(buf)).trim(), requestedSig)
          if (layer) {
            await store.writeLayerBytes(requestedSig, buf)  // writes to the hive root
            return layer
          }
        }
      } catch {
        // sentinel failed — no direct fetch fallback, DCP is the sole gateway
        console.warn(`[layer-service] sentinel fetch failed for ${requestedSig.slice(0, 12)}`)
      }
    } else {
      console.warn(`[layer-service] no sentinel bridge — cannot fetch layer ${requestedSig.slice(0, 12)}`)
    }

    return null
  }

  private tryParseLayer = (text: string, name: string): LayerFile | null => {
    try {
      return JSON.parse(text) as LayerFile
    } catch {
      console.log(`[layer-service] invalid json in ${name}`)
      return null
    }
  }


}

register('@hypercomb.social/LayerService', new LayerService())
