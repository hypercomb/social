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
   * Record a new patch. Appends a sequential file to __patches__/{domain}/.
   */
  async record(domain: string, patch: Omit<PatchRecord, 'id'>): Promise<PatchRecord> {
    await this.#store.initialize()
    const dir = await this.#store.domainPatchesDir(domain)

    const nextId = await this.#nextId(dir)
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
    const records: PatchRecord[] = []

    for await (const name of (dir as any).keys()) {
      if (name === 'active.json') continue
      const bytes = await this.#store.readFile(dir, name)
      if (!bytes) continue
      try {
        records.push(JSON.parse(new TextDecoder().decode(bytes)) as PatchRecord)
      } catch { /* skip corrupt entries */ }
    }

    return records.sort((a, b) => a.id - b.id)
  }

  /**
   * Get the active (hot-swapped) root for a domain.
   * Returns null if no patches have been applied.
   */
  async activeRoot(domain: string): Promise<string | null> {
    await this.#store.initialize()
    const dir = await this.#store.domainPatchesDir(domain)
    const bytes = await this.#store.readFile(dir, 'active.json')
    if (!bytes) return null
    try {
      const state = JSON.parse(new TextDecoder().decode(bytes)) as ActiveState
      return state.rootSig || null
    } catch {
      return null
    }
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
   * Find the next sequential ID by scanning existing entries.
   */
  async #nextId(dir: FileSystemDirectoryHandle): Promise<number> {
    let max = 0
    for await (const name of (dir as any).keys()) {
      if (name === 'active.json') continue
      const num = parseInt(name, 10)
      if (!isNaN(num) && num > max) max = num
    }
    return max + 1
  }
}
