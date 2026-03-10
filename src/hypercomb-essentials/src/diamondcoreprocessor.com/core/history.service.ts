// hypercomb-essentials/src/diamondcoreprocessor.com/core/history.service.ts
// Layer-based history service: mutations create layer snapshots in __history__/<lineageSig>/.
// Each entry is a complete LayerV2 snapshot. The live cache is the derived current state.

import { computeLineageSig, computeListSig, listResourceContent } from '@hypercomb/core'

type LayerV2 = {
  v: 2
  lineage: string
  bees: string
  deps: string
  resources: string
  children: string
}

type Store = {
  history: FileSystemDirectoryHandle
  resources: FileSystemDirectoryHandle
  liveCache: ReadonlyMap<string, LayerV2>
  getLayer(lineageSig: string): LayerV2 | null
  getListResource(listSig: string): Promise<string[]>
  appendHistory(lineageSig: string, layer: LayerV2): Promise<void>
  replayHistory(lineageSig: string): Promise<LayerV2[]>
  saveSnapshot(): Promise<void>
}

export class HistoryService {

  #store(): Store {
    return (window as any).ioc.get('@hypercomb.social/Store') as Store
  }

  /**
   * Add a child at the given parent lineage.
   * Creates a new child layer and updates the parent's children list.
   */
  readonly addChild = async (parentSegments: string[], childName: string): Promise<void> => {
    const store = this.#store()

    // 1. create child lineage
    const childSegments = [...parentSegments, childName]
    const childLineageSig = await computeLineageSig(childSegments)

    // store lineage array as a resource
    await this.#storeResource(store, childLineageSig, JSON.stringify(childSegments))

    // 2. create initial child layer (empty lists)
    const emptyListSig = await computeListSig([])
    await this.#storeResource(store, emptyListSig, listResourceContent([]))

    const childLayer: LayerV2 = {
      v: 2,
      lineage: childLineageSig,
      bees: emptyListSig,
      deps: emptyListSig,
      resources: emptyListSig,
      children: emptyListSig,
    }

    // 3. append to child's history bag + update live cache
    await store.appendHistory(childLineageSig, childLayer)

    // 4. update parent's children list
    await this.#addToList(store, parentSegments, 'children', childLineageSig)
  }

  /**
   * Remove a child from the given parent lineage.
   */
  readonly removeChild = async (parentSegments: string[], childName: string): Promise<void> => {
    const store = this.#store()
    const childSegments = [...parentSegments, childName]
    const childLineageSig = await computeLineageSig(childSegments)

    await this.#removeFromList(store, parentSegments, 'children', childLineageSig)
  }

  /**
   * Add a bee signature to the layer at the given lineage.
   */
  readonly addBee = async (segments: string[], beeSig: string): Promise<void> => {
    const store = this.#store()
    await this.#addToList(store, segments, 'bees', beeSig)
  }

  /**
   * Remove a bee signature from the layer at the given lineage.
   */
  readonly removeBee = async (segments: string[], beeSig: string): Promise<void> => {
    const store = this.#store()
    await this.#removeFromList(store, segments, 'bees', beeSig)
  }

  /**
   * Add a resource signature to the layer at the given lineage.
   */
  readonly addResource = async (segments: string[], resourceSig: string): Promise<void> => {
    const store = this.#store()
    await this.#addToList(store, segments, 'resources', resourceSig)
  }

  /**
   * Replay history for a lineage, returning all layer snapshots in order.
   */
  readonly replay = async (lineageSig: string): Promise<LayerV2[]> => {
    const store = this.#store()
    return store.replayHistory(lineageSig)
  }

  /**
   * Get the latest layer for a lineage from live cache.
   */
  readonly head = async (lineageSig: string): Promise<LayerV2 | null> => {
    const store = this.#store()
    return store.getLayer(lineageSig)
  }

  /**
   * List all lineage bags in __history__/.
   */
  readonly list = async (): Promise<{ signature: string; count: number }[]> => {
    const store = this.#store()
    const root = store.history
    const result: { signature: string; count: number }[] = []

    for await (const [name, handle] of (root as any).entries()) {
      if (handle.kind !== 'directory') continue

      let count = 0
      for await (const [, child] of (handle as FileSystemDirectoryHandle).entries()) {
        if (child.kind === 'file') count++
      }

      result.push({ signature: name, count })
    }

    return result
  }

  // ── internal helpers ──

  #addToList = async (
    store: Store,
    segments: string[],
    field: 'bees' | 'deps' | 'resources' | 'children',
    sig: string
  ): Promise<void> => {
    const lineageSig = await computeLineageSig(segments)
    const layer = store.getLayer(lineageSig)
    if (!layer) return

    const currentList = await store.getListResource(layer[field])
    if (currentList.includes(sig)) return // already present

    const newList = [...currentList, sig]
    const newListSig = await computeListSig(newList)
    await this.#storeResource(store, newListSig, listResourceContent(newList))

    const updatedLayer: LayerV2 = { ...layer, [field]: newListSig }
    await store.appendHistory(lineageSig, updatedLayer)
  }

  #removeFromList = async (
    store: Store,
    segments: string[],
    field: 'bees' | 'deps' | 'resources' | 'children',
    sig: string
  ): Promise<void> => {
    const lineageSig = await computeLineageSig(segments)
    const layer = store.getLayer(lineageSig)
    if (!layer) return

    const currentList = await store.getListResource(layer[field])
    const newList = currentList.filter(s => s !== sig)
    if (newList.length === currentList.length) return // not present

    const newListSig = await computeListSig(newList)
    await this.#storeResource(store, newListSig, listResourceContent(newList))

    const updatedLayer: LayerV2 = { ...layer, [field]: newListSig }
    await store.appendHistory(lineageSig, updatedLayer)
  }

  #storeResource = async (store: Store, sig: string, content: string): Promise<void> => {
    const handle = await store.resources.getFileHandle(sig, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(content)
    } finally {
      await writable.close()
    }
  }
}

const _historyService = new HistoryService()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryService', _historyService)
