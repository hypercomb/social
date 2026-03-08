// revolucionstyle.com/cigar/cigar-catalog.service.ts
// Local cigar catalog — stores unique cigar identities in OPFS for autocomplete.

import { SignatureService } from '@hypercomb/core'
import type { Cigar } from '../journal/journal-entry.js'
import { cigarKey } from './cigar.js'

type Store = {
  current: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

const PROPERTIES_FILE = '0000'

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

    try {
      const domainDir = await store.current.getDirectoryHandle('revolucionstyle.com')
      const catalogDir = await domainDir.getDirectoryHandle('catalog')

      for await (const [name, handle] of catalogDir.entries()) {
        if (handle.kind !== 'directory') continue
        try {
          const fileHandle = await (handle as FileSystemDirectoryHandle).getFileHandle(PROPERTIES_FILE)
          const file = await fileHandle.getFile()
          const text = await file.text()
          const cigar = JSON.parse(text) as Cigar
          this.#cache.set(cigarKey(cigar), { sig: name, cigar })
        } catch { /* skip corrupted */ }
      }
    } catch { /* no catalog dir yet */ }

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
    const bytes = new TextEncoder().encode(json)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    const domainDir = await store.current.getDirectoryHandle('revolucionstyle.com', { create: true })
    const catalogDir = await domainDir.getDirectoryHandle('catalog', { create: true })
    const entryDir = await catalogDir.getDirectoryHandle(sig, { create: true })
    const fileHandle = await entryDir.getFileHandle(PROPERTIES_FILE, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(json)
    } finally {
      await writable.close()
    }

    this.#cache.set(key, { sig, cigar })
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

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@revolucionstyle.com/CigarCatalogService',
  new CigarCatalogService(),
)
