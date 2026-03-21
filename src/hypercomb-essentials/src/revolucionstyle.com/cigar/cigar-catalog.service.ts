// revolucionstyle.com/cigar/cigar-catalog.service.ts
import { SignatureService } from '@hypercomb/core'
import type { Cigar } from '../journal/journal-entry.js'
import { cigarKey } from './cigar.js'

type Store = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

const INDEX_KEY = 'hc:cigar-catalog-index'

export class CigarCatalogService extends EventTarget {

  #cache = new Map<string, { sig: string; cigar: Cigar }>()
  #loaded = false

  // ── getters ────────────────────────────────────────────────────

  get count(): number { return this.#cache.size }
  get loaded(): boolean { return this.#loaded }

  // ── load ───────────────────────────────────────────────────────

  readonly load = async (): Promise<void> => {
    if (this.#loaded) return

    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return

    const index = this.#readIndex()

    for (const [key, sig] of Object.entries(index)) {
      try {
        const blob = await store.getResource(sig)
        if (!blob) continue
        const text = await blob.text()
        const cigar = JSON.parse(text) as Cigar
        this.#cache.set(key, { sig, cigar })
      } catch { /* skip corrupted */ }
    }

    this.#loaded = true
    this.#emit()
  }

  // ── add ────────────────────────────────────────────────────────

  readonly add = async (cigar: Cigar): Promise<string> => {
    const key = cigarKey(cigar)
    const existing = this.#cache.get(key)
    if (existing) return existing.sig

    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return ''

    const json = JSON.stringify(cigar, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const sig = await store.putResource(blob)

    this.#cache.set(key, { sig, cigar })
    this.#persistIndex()
    this.#emit()
    return sig
  }

  // ── search ─────────────────────────────────────────────────────

  readonly search = (query: string): Cigar[] => {
    if (!query) return Array.from(this.#cache.values()).map(v => v.cigar)

    const q = query.toLowerCase()
    return Array.from(this.#cache.values())
      .filter(({ cigar }) =>
        cigar.brand.toLowerCase().includes(q) ||
        cigar.line.toLowerCase().includes(q) ||
        cigar.name.toLowerCase().includes(q),
      )
      .map(v => v.cigar)
  }

  // ── brands ─────────────────────────────────────────────────────

  readonly brands = (): string[] => {
    const set = new Set<string>()
    for (const { cigar } of this.#cache.values()) {
      if (cigar.brand) set.add(cigar.brand)
    }
    return Array.from(set).sort()
  }

  // ── internal ───────────────────────────────────────────────────

  #readIndex(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}')
    } catch {
      return {}
    }
  }

  #persistIndex(): void {
    const index: Record<string, string> = {}
    for (const [key, { sig }] of this.#cache) {
      index[key] = sig
    }
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  }

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@revolucionstyle.com/CigarCatalogService',
  new CigarCatalogService(),
)
