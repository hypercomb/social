// hypercomb-web/src/app/core/layer-graph-resolver.service.ts

import { Store } from './store'

export type LayerRecord = {
  name: string
  children: string[]
  bees: string[]
}

export class LayerGraphResolver {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get store(): Store { return <Store>get("@hypercomb.social/Store") }

  // -------------------------------------------------
  // fields
  // -------------------------------------------------

  private readonly decoder = new TextDecoder()
  private readonly encoder = new TextEncoder()

  // -------------------------------------------------
  // api
  // -------------------------------------------------

  public resolve = async (
    domain: string,
    location: string,
    signature: string
  ): Promise<LayerRecord | null> => {

    if (!this.isSignature(signature)) return null

    const layersDir = await this.store.domainLayersDirectory(domain, true)

    const result = await this.getLayerJsonText(layersDir, location, signature)
    if (!result.content) return null

    if (!result.exists) {
      await this.writeCachedLayerJson(layersDir, signature, result.content)
    }

    return this.parseLayerJson(signature, result.content)
  }

  // ------------------------------

  private getLayerJsonText = async (
    layersDir: FileSystemDirectoryHandle,
    location: string,
    signature: string
  ): Promise<{ exists: boolean; content: string }> => {

    const cached = await this.readCachedLayerJson(layersDir, signature)
    if (cached) return { exists: true, content: cached }

    const fetched = await this.fetchLayerJson(location, signature)
    return { exists: false, content: fetched || '' }
  }

  private readCachedLayerJson = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string
  ): Promise<string | null> => {
    try {
      const handle = await layersDir.getFileHandle(signature)
      const file = await handle.getFile()
      return this.decoder.decode(await file.arrayBuffer())
    } catch {
      return null
    }
  }

  private writeCachedLayerJson = async (
    layersDir: FileSystemDirectoryHandle,
    signature: string,
    jsonText: string
  ): Promise<void> => {

    const handle = await layersDir.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(this.encoder.encode(jsonText))
    } finally {
      await writable.close()
    }
  }

  private fetchLayerJson = async (
    location: string,
    signature: string
  ): Promise<string | null> => {

    const res = await fetch(`${location.replace(/\/+$/, '')}/${signature}`)
    if (!res.ok) return null
    return await res.text()
  }

  private parseLayerJson = (
    signature: string,
    jsonText: string
  ): LayerRecord => {

    let parsed: any
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      throw new Error(`invalid layer json ${signature}`)
    }

    const name = String(parsed.name || '').trim()
    if (!name) throw new Error(`layer ${signature} missing name`)

    const children =
      (Array.isArray(parsed.children) ? parsed.children : [])
        .map((c: unknown) => String(c).trim())
        .filter((c: string) => this.isSignature(c))

    const bees =
      (Array.isArray(parsed.bees) ? parsed.bees : [])
        .map((d: unknown) => String(d).trim())
        .filter((d: string) => this.isSignature(d))

    return { name, children, bees }
  }

  private isSignature = (value: string): boolean =>
    /^[a-f0-9]{64}$/i.test(value)
}
