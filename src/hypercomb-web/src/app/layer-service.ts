// hypercomb-web/src/app/layer-service.ts

import { Injectable } from '@angular/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { Store } from '@hypercomb/shared/core'

export type LayerFile = { signature: string; name?: string; layers?: string[]; drones?: string[]; dependencies?: string[] }

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
    const baseUrl = (parsed?.baseUrl ?? '').trim().replace(/\/+$/, '')
    const url = `${baseUrl}/${rootSig}/__layers__/${requestedSig}.json`

    const bytes = await this.fetchBytes(url)
    if (!bytes) return null

    const text = new TextDecoder().decode(bytes).trim()
    const layer = this.tryParseLayer(text, requestedSig)
    if (!layer) return null

    await this.writeBytesFile(dir, requestedSig, bytes)
    return layer
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

  private fetchBytes = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      console.log(`[layer-service] fetch ${url} -> ${res.status} ${ct}`)
      if (!res.ok) return null
      if (ct.includes('text/html')) return null
      const buf: ArrayBuffer = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }
}

register('@hypercomb.social/LayerService', new LayerService(), 'LayerService')
