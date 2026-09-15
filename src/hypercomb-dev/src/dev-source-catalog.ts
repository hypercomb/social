// Development-shell source catalog.
//
// Installed shells discover executable modules from their signed package
// manifest. The development shell deliberately imports TypeScript directly,
// so it has no installed manifest. Its emitted source map is still a complete,
// public description of those exact sources. This adapter turns each source
// into the same content-addressed primitive: name + SHA-256 signature + bytes.
// Reading is inert; no source is evaluated through this catalog.

import { SignatureService } from '@hypercomb/core'
import type { ReadableArtifact } from '@hypercomb/runtime/script-preloader'

export const DEV_SOURCE_CATALOG_IOC_KEY = '@hypercomb.social/DevSourceCatalog'

export type DevSourceEntry = { readonly name: string; readonly sig: string }

type SourceRecord = DevSourceEntry & { readonly text: string; readonly size: number }
type SourceMapDocument = {
  readonly sources?: readonly unknown[]
  readonly sourcesContent?: readonly unknown[]
}

const normalizeSourceName = (raw: unknown): string => {
  let name = String(raw ?? '').replace(/\\/g, '/').replace(/^webpack:\/\//, '')
  name = name.replace(/^(?:\.\.\/)+/, '')
  if (name.startsWith('src/')) name = `hypercomb-dev/${name}`
  return name
}

/** Only source belonging to this open-source workspace, never dependencies. */
export const sourceDocuments = (map: SourceMapDocument): readonly { name: string; text: string }[] => {
  const sources = Array.isArray(map.sources) ? map.sources : []
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : []
  const documents = new Map<string, string>()
  for (let index = 0; index < Math.min(sources.length, contents.length); index++) {
    const name = normalizeSourceName(sources[index])
    const text = contents[index]
    if (typeof text !== 'string' || !name.endsWith('.ts')) continue
    if (!/^hypercomb-(?:core|dev|essentials|runtime|shared)\//.test(name)) continue
    if (/\.(?:spec|test)\.ts$/.test(name) || name.endsWith('.d.ts')) continue
    if (!documents.has(name)) documents.set(name, text)
  }
  return [...documents].map(([name, text]) => ({ name, text }))
}

export class DevSourceCatalog {
  #records: Promise<readonly SourceRecord[]> | null = null

  async entries(): Promise<readonly DevSourceEntry[]> {
    return (await this.#load()).map(({ name, sig }) => ({ name, sig }))
  }

  async readSource(sig: string): Promise<{ readonly name: string; readonly text: string; readonly size: number } | null> {
    const record = (await this.#load()).find(entry => entry.sig === sig)
    return record ? { name: record.name, text: record.text, size: record.size } : null
  }

  async readArtifact(sig: string): Promise<ReadableArtifact | null> {
    const source = await this.readSource(sig)
    if (!source) return null
    return {
      name: source.name,
      sig,
      of: 'bee',
      type: 'text/typescript',
      bytes: new TextEncoder().encode(source.text),
    }
  }

  async #load(): Promise<readonly SourceRecord[]> {
    if (this.#records) return this.#records
    this.#records = this.#loadLive()
    return this.#records
  }

  async #loadLive(): Promise<readonly SourceRecord[]> {
    const main = [...document.scripts]
      .map(script => script.src)
      .find(src => /\/main(?:-[^/?]+)?\.js(?:[?#]|$)/.test(src))
    if (!main) return []
    try {
      const mapUrl = `${main.split('#')[0]!.split('?')[0]!}.map`
      const response = await fetch(mapUrl, { cache: 'no-store' })
      if (!response.ok) return []
      const documents = sourceDocuments(await response.json() as SourceMapDocument)
      return Promise.all(documents.map(async ({ name, text }) => {
        const bytes = new TextEncoder().encode(text)
        const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
        return { name, text, size: bytes.byteLength, sig }
      }))
    } catch {
      return []
    }
  }
}

export const registerDevSourceCatalog = (): void => {
  const ioc = (globalThis as { ioc?: { get?(key: string): unknown; register?(key: string, value: unknown): void } }).ioc
  if (!ioc?.register) return
  let catalog = ioc.get?.(DEV_SOURCE_CATALOG_IOC_KEY) as DevSourceCatalog | undefined
  if (!catalog) {
    catalog = new DevSourceCatalog()
    ioc.register(DEV_SOURCE_CATALOG_IOC_KEY, catalog)
  }
  const preloader = ioc.get?.('@hypercomb.social/ScriptPreloader') as
    | { registerReadableArtifacts?(provider: DevSourceCatalog): void }
    | undefined
  preloader?.registerReadableArtifacts?.(catalog)
}
