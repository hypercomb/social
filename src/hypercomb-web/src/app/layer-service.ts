// hypercomb-web/src/app/layer-service.ts

import { Injectable } from '@angular/core'
import { type LocationParseResult } from '@hypercomb/shared/core/initializers/location-parser'
import { Store } from '@hypercomb/shared/core'

export type LayerFile = {
  signature: string
  name?: string
  layers?: string[]
  drones?: string[]
  dependencies?: string[]
}

@Injectable({ providedIn: 'root' })
export class LayerService {

  // local: __layers__/<domain>/<signature>
  // remote: https://<domain>/<path>/__install__/<signature> (fallbacks supported)
  public get = async (parsed: LocationParseResult, signature: string): Promise<LayerFile | null> => {
    const dom = this.normalizeDomain(parsed?.domain ?? '')
    const path = this.normalizePath(parsed?.path ?? '')
    const sig = (parsed?.signature ?? '').trim()

    if (!dom || !sig) return null

    const { get } = window.ioc
    const store = get('Store') as Store

    // local is flat inside the domain folder (path is not part of local storage)
    const dir = await store.domainLayersDirectory(dom, true)

    // step 1: local lookup
    const local = await this.tryReadLayer(dir, sig)
    if (local) return local

    // step 2: remote fetch -> save -> return
    const baseUrl = this.normalizeBaseUrl(parsed?.baseUrl ?? '', dom, path)

    // preferred published shape
    const url = `${baseUrl}/${parsed.signature}/__layers__/${sig}.json`
    let bytes = await this.fetchBytes(url)

    if (!bytes) return null

    const text = new TextDecoder().decode(bytes).trim()
    const layer = this.tryParseLayer(text, sig)
    if (!layer) return null

    // optional: refuse to save if payload claims a different signature
    if ((layer.signature ?? '').trim() && (layer.signature ?? '').trim() !== sig) {
      console.log(`[layer-service] signature mismatch requested=${sig} payload=${layer.signature}`)
      return null
    }

    await this.writeBytesFile(dir, sig, bytes)
    return layer
  }

  private normalizeDomain = (domain: string): string => {
    const raw = (domain ?? '').trim().toLowerCase()
    if (!raw) return ''
    return raw.replace(/^\s*https?:\/\//i, '').replace(/\/+$/, '')
  }

  private normalizePath = (path: string): string => {
    return (path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  }

  private normalizeBaseUrl = (baseUrl: string, domain: string, path: string): string => {
    const explicit = (baseUrl ?? '').trim().replace(/\/+$/, '')
    if (explicit) return explicit

    const host = (domain ?? '').trim()
    const protoHost = /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : `https://${host}`

    if (!path) return protoHost
    return `${protoHost}/${path}`.replace(/\/+$/, '')
  }

  private tryReadLayer = async (dir: FileSystemDirectoryHandle, name: string): Promise<LayerFile | null> => {
    // primary local name is the signature (no extension)
    let handle = await this.tryGetFileHandle(dir, name)

    // allow older saved shape with .json
    if (!handle) handle = await this.tryGetFileHandle(dir, `${name}.json`)
    if (!handle) return null

    const file = await handle.getFile().catch(() => null)
    if (!file || file.size <= 0) return null

    const text = ((await file.text().catch(() => '')) ?? '').trim()
    if (!text) return null

    const parsed = this.tryParseLayer(text, name)
    if (parsed) return parsed

    // corrupted local json -> remove so a future call can heal
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

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-service] fetch failed body (first 200): ${body.slice(0, 200)}`)
        return null
      }

      if (ct.includes('text/html')) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-service] unexpected html (first 200): ${body.slice(0, 200)}`)
        return null
      }

      const buf: ArrayBuffer = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch (err) {
      console.log('[layer-service] fetch error', err)
      return null
    }
  }
}

const { get, register, list } = window.ioc
register('LayerService', new LayerService())
