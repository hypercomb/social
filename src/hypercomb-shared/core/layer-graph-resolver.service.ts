// hypercomb-web/src/app/core/layer-graph-resolver.service.ts

import { Store } from './store'
import { SignatureService } from '@hypercomb/core'

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

  // -------------------------------------------------
  // api
  // -------------------------------------------------

  public resolve = async (
    domain: string,
    location: string,
    signature: string
  ): Promise<LayerRecord | null> => {

    if (!this.isSignature(signature)) return null

    // Single flat layer pool at the hive root (Phase-1b) — domain has no
    // effect on storage location. `domain` kept for caller-API back-compat
    // but unused here. A local miss re-fetches exact bytes from `location`
    // and writes them through Store's verified flat-root boundary.
    void domain
    const bytes = await this.getLayerBytes(location, signature)
    if (!bytes) return null
    return this.parseLayerJson(signature, this.decoder.decode(bytes))
  }

  // ------------------------------

  private getLayerBytes = async (
    location: string,
    signature: string
  ): Promise<Uint8Array | null> => {
    const cached = await this.store.getLayerLocalBytes(signature)
    if (cached) return cached
    const fetched = await this.fetchLayerBytes(location, signature)
    if (!fetched) return null
    await this.store.writeLayerBytes(signature, fetched.buffer as ArrayBuffer)
    return fetched
  }

  private fetchLayerBytes = async (
    location: string,
    signature: string
  ): Promise<Uint8Array<ArrayBuffer> | null> => {
    const base = location.replace(/\/+$/, '')
    for (const url of [
      `${base}/${signature}`,
      `${base}/content/${signature}`,
      `${base}/__layers__/${signature}.json`,
      `${base}/content/__layers__/${signature}.json`,
    ]) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const buffer = await res.arrayBuffer()
        if (await SignatureService.sign(buffer) === signature.toLowerCase()) {
          return new Uint8Array(buffer)
        }
      } catch { /* try the next deployment shape */ }
    }
    return null
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

    // Child layer sigs live under `cells`. Universal rule: a 64-hex
    // string in this slot would be a sig pointer to a JSON array
    // resource (forward-compat). Legacy `layers`/`children` accepted.
    const rawChildren =
      Array.isArray(parsed.cells) ? parsed.cells
      : Array.isArray(parsed.layers) ? parsed.layers
      : Array.isArray(parsed.children) ? parsed.children
      : []
    const children = rawChildren
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
