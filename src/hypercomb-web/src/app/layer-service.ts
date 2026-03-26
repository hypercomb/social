// hypercomb-web/src/app/layer-service.ts

import { Injectable } from '@angular/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { Store } from '@hypercomb/shared/core'

export type LayerFile = { signature: string; name?: string; layers?: string[]; bees?: string[]; dependencies?: string[] }

@Injectable({ providedIn: 'root' })
export class LayerService {

  // local: opfsroot/__layers__/<domain>/<signature>
  // remote: <endpoint>/<rootSig>/__layers__/<signature>.json
  public get = async (parsed: LocationParseResult, signature: string): Promise<LayerFile | null> => {
    const dom = (parsed?.domain ?? '').trim().toLowerCase()
    const rootSig = (parsed?.signature ?? '').trim()
    const requestedSig = (signature ?? '').trim()

    if (!dom || !rootSig || !requestedSig) return null

    const store = get('@hypercomb.social/Store') as Store

    const dir = await store.domainLayersDirectory(dom, true)

    // step 1: local lookup for requested signature
    const local = await this.tryReadLayer(dir, requestedSig)
    if (local) return local

    // step 2: remote fetch -> save -> return
    // Prefer sentinel bridge (DCP) if connected — isolates server contact
    const bridge = (globalThis as any).__sentinelBridge
    if (bridge?.fetchContent) {
      try {
        const buf: ArrayBuffer | null = await bridge.fetchContent(requestedSig, 'layer', rootSig)
        if (buf) {
          const bytes = new Uint8Array(buf)
          const text = new TextDecoder().decode(bytes).trim()
          const layer = this.tryParseLayer(text, requestedSig)
          if (layer) {
            await this.writeBytesFile(dir, requestedSig, bytes)
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

  private tryReadLayer = async (dir: FileSystemDirectoryHandle, name: string): Promise<LayerFile | null> => {
    let handle = await this.tryGetFileHandle(dir, name)
    if (!handle) handle = await this.tryGetFileHandle(dir, `${name}.json`)
    if (!handle) return null

    const file = await handle.getFile().catch(() => null)
    if (!file || file.size <= 0) return null

    const text = ((await file.text().catch(() => '')) ?? '').trim()
    if (!text) return null

    const parsed = this.tryParseLayer(text, name)
    if (parsed) return parsed

    await this.safeRemove(dir, handle.name)
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

  private tryGetFileHandle = async (dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle | null> => {
    try {
      return await dir.getFileHandle(name)
    } catch {
      return null
    }
  }

  private safeRemove = async (dir: FileSystemDirectoryHandle, name: string): Promise<void> => {
    try {
      await dir.removeEntry(name)
    } catch {
      // ignore
    }
  }

  private writeBytesFile = async (dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }


}

register('@hypercomb.social/LayerService', new LayerService())
