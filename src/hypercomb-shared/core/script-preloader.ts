// hypercomb-web/src/app/core/script-preloader.ts

import { Bee, type BeeResolver } from '@hypercomb/core'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}
export class ScriptPreloader extends EventTarget implements BeeResolver {

  private get store(): Store { return <Store>get("@hypercomb.social/Store")}

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0

  public get actions(): readonly ActionDescriptor[] { return this.#actions }
  public get actionNames(): readonly string[] { return this.#actionNames }
  public get resourceCount(): number { return this.#resourceCount }

  private readonly bySignature = new Map<string, ActionDescriptor>()
  readonly #beeBySignature = new Map<string, Bee>()

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.bySignature.get(signature)?.name ?? null

  /**
   * Read marker files from store.current (the active seed directory).
   * Each marker is an empty file named with a 64-hex bee signature.
   * Loads the corresponding bee from __bees__/{sig}.js and returns it.
   */
  public find = async (_name: string): Promise<Bee[]> => {
    const store = this.store
    const dir = store.current
    const bees: Bee[] = []

    for await (const [markerSig, entry] of dir.entries()) {
      if (entry.kind !== 'file') continue
      if (!this.isSignature(markerSig)) continue

      // Already loaded — return cached instance
      const cached = this.#beeBySignature.get(markerSig)
      if (cached) {
        bees.push(cached)
        continue
      }

      // Load bee JS from __bees__/{sig}.js
      try {
        const beeHandle = await store.bees.getFileHandle(`${markerSig}.js`)
        const beeFile = await beeHandle.getFile()
        const buffer = await beeFile.arrayBuffer()
        const bee = await store.getBee(markerSig, buffer)
        if (!bee) continue
        if (!has(bee.iocKey)) register(bee.iocKey, bee)
        this.bySignature.set(markerSig, { signature: markerSig, name: bee.name ?? markerSig })
        this.#beeBySignature.set(markerSig, bee)
        bees.push(bee)
      } catch {
        // bee not in OPFS yet — skip silently
      }
    }

    return bees
  }

  public preload = async (): Promise<void> => {
    this.bySignature.clear()
    this.#actions = []
    this.#actionNames = []
    this.#resourceCount = 0
    this.dispatchEvent(new CustomEvent('change'))

    for await (const [name, entry] of this.store.opfsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (!this.isDomainName(name)) continue

      const domainDir = entry as FileSystemDirectoryHandle

      let resourcesDir: FileSystemDirectoryHandle
      try {
        resourcesDir = await domainDir.getDirectoryHandle(Store.BEES_DIRECTORY)
      } catch {
        continue
      }

      await this.loadAllFromDirectory(resourcesDir)
    }

    try {
      const globalResources = await this.store.opfsRoot.getDirectoryHandle(Store.BEES_DIRECTORY)
      await this.loadAllFromDirectory(globalResources)
    } catch {
      // ignore
    }

    this.refreshProjection()
  }

  private loadAllFromDirectory = async (resourcesDir: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [sig, entry] of resourcesDir.entries()) {
      const signature  = sig.replace('.js', '')

      if (entry.kind !== 'file') continue
      if (!this.isSignature(signature)) continue
      if (this.bySignature.has(signature)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const buffer = await file.arrayBuffer()

        const bee = await this.store.getBee(signature, buffer)
        if (!bee) continue
        if (!has(bee.iocKey)) register(bee.iocKey, bee)

        this.bySignature.set(signature, { signature, name: bee.name ?? signature })
        this.#beeBySignature.set(signature, bee)
        this.#resourceCount = this.#resourceCount + 1
        this.dispatchEvent(new CustomEvent('change'))
      } catch {
        // ignore
        console.log(`[script-preloader] failed to load resource ${signature} from OPFS`)
      }
    }
  }

  private refreshProjection = (): void => {
    const list = [...this.bySignature.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.#actions = list
    this.#actionNames = list.map(a => (a.name ?? '').replace(/-/g, ' '))
    this.dispatchEvent(new CustomEvent('change'))
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)

  private isDomainName = (name: string): boolean => {
    const raw = (name ?? '').trim()
    if (!raw || raw.startsWith('__')) return false
    if (raw === Store.BEES_DIRECTORY) return false
    if (raw === Store.DEPENDENCIES_DIRECTORY) return false
    if (raw === 'hypercomb') return false
    return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
  }
}

register('@hypercomb.social/ScriptPreloader', new ScriptPreloader())
