// diamond-core-processor/src/app/core/patch-store.ts

import { inject, Injectable } from '@angular/core'
import { DcpStore } from './dcp-store'

export type PatchRecord = {
  id: number
  originalFileSig: string
  newFileSig: string
  originalRootSig: string
  newRootSig: string
  kind: 'bee' | 'dependency'
  lineage: string
  timestamp: number
  cascadedLayers: { oldSig: string; newSig: string }[]
}

type ActiveState = {
  rootSig: string
}

@Injectable({ providedIn: 'root' })
export class PatchStore {

  #store = inject(DcpStore)

  /**
   * Record a new patch. Appends a sequential file to the patch bookkeeping
   * bag: sign('patches')/{domainKey}/ (was the legacy __patches__/{domain}/).
   */
  async record(domain: string, patch: Omit<PatchRecord, 'id'>): Promise<PatchRecord> {
    await this.#store.initialize()
    const dir = await this.#store.domainPatchesDir(domain)

    // Next id must clear BOTH the pool bag and the legacy bag: while the
    // legacy `__patches__` drain is mid-flight the max record may still
    // live only in the legacy source, and reusing its id would clobber it.
    const nextId = Math.max(
      await this.#nextId(dir),
      await this.#nextId(await this.#store.legacyDomainPatchesDir(domain)),
    )
    const record: PatchRecord = { id: nextId, ...patch }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    const name = String(nextId).padStart(8, '0')
    await this.#store.writeFile(dir, name, bytes)

    // update active root
    await this.setActiveRoot(domain, patch.newRootSig)

    return record
  }

  /**
   * List all patches for a domain, sorted by id ascending.
   */
  async list(domain: string): Promise<PatchRecord[]> {
    await this.#store.initialize()
    const dir = await this.#store.domainPatchesDir(domain)
    const legacyDir = await this.#store.legacyDomainPatchesDir(domain)
    // Union the pool bag with the legacy bag, keyed by record id so a
    // record present in both (mid-drain) is counted once, pool winning.
    const byId = new Map<number, PatchRecord>()
    for (const source of [legacyDir, dir]) {   // legacy first, pool overwrites
      if (!source) continue
      try {
        for await (const name of (source as any).keys()) {
          if (name === 'active.json') continue
          const bytes = await this.#store.readFile(source, name)
          if (!bytes) continue
          try {
            const rec = JSON.parse(new TextDecoder().decode(bytes)) as PatchRecord
            byId.set(rec.id, rec)
          } catch { /* skip corrupt entries */ }
        }
      } catch { /* bag vanished mid-scan (drained) — the other source covers it */ }
    }

    return [...byId.values()].sort((a, b) => a.id - b.id)
  }

  /**
   * Get the active (hot-swapped) root for a domain.
   * Returns null if no patches have been applied.
   */
  async activeRoot(domain: string): Promise<string | null> {
    await this.#store.initialize()
    // Pool bag first, then the legacy bag while its drain is mid-flight.
    const dir = await this.#store.domainPatchesDir(domain)
    const bytes = await this.#store.readFile(dir, 'active.json')
      ?? await this.#readLegacyActive(domain)
    if (!bytes) return null
    try {
      const state = JSON.parse(new TextDecoder().decode(bytes)) as ActiveState
      return state.rootSig || null
    } catch {
      return null
    }
  }

  async #readLegacyActive(domain: string): Promise<ArrayBuffer | null> {
    const legacyDir = await this.#store.legacyDomainPatchesDir(domain)
    if (!legacyDir) return null
    return this.#store.readFile(legacyDir, 'active.json')
  }

  /**
   * Set the active root — hot-swap to a different patch or back to original.
   */
  async setActiveRoot(domain: string, rootSig: string): Promise<void> {
    await this.#store.initialize()
    const dir = await this.#store.domainPatchesDir(domain)
    const state: ActiveState = { rootSig }
    const bytes = new TextEncoder().encode(JSON.stringify(state)).buffer as ArrayBuffer
    await this.#store.writeFile(dir, 'active.json', bytes)
  }

  /**
   * Find the next sequential ID by scanning existing entries. `dir`
   * undefined (a drained/absent legacy bag) contributes nothing.
   */
  async #nextId(dir: FileSystemDirectoryHandle | undefined): Promise<number> {
    if (!dir) return 1
    let max = 0
    try {
      for await (const name of (dir as any).keys()) {
        if (name === 'active.json') continue
        const num = parseInt(name, 10)
        if (!isNaN(num) && num > max) max = num
      }
    } catch { /* bag vanished mid-scan (drained) — contributes nothing */ }
    return max + 1
  }
}
