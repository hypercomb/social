// hypercomb-shared/core/script-preloader.ts

import { Bee, type BeeResolver } from '@hypercomb/core'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}
export class ScriptPreloader extends EventTarget implements BeeResolver {

  #store(): Store { return <Store>get("@hypercomb.social/Store") }

  #actions: readonly ActionDescriptor[] = []
  #actionNames: readonly string[] = []
  #resourceCount = 0

  public get actions(): readonly ActionDescriptor[] { return this.#actions }
  public get actionNames(): readonly string[] { return this.#actionNames }
  public get resourceCount(): number { return this.#resourceCount }

  readonly #bySignature = new Map<string, ActionDescriptor>()

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.#bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.#bySignature.get(signature)?.name ?? null

  public find = async (_name: string): Promise<Bee[]> => {
    return []
  }

  /**
   * Load all bee modules from the global __bees__/ directory.
   */
  public preload = async (): Promise<void> => {
    this.#bySignature.clear()
    this.#actions = []
    this.#actionNames = []
    this.#resourceCount = 0
    this.dispatchEvent(new CustomEvent('change'))

    try {
      await this.#loadAllFromDirectory(this.#store().bees)
    } catch {
      // ignore
    }

    this.#refreshProjection()
  }

  #loadAllFromDirectory = async (dir: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [sig, entry] of dir.entries()) {
      const signature = sig.replace('.js', '')

      if (entry.kind !== 'file') continue
      if (!this.#isSignature(signature)) continue
      if (this.#bySignature.has(signature)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const buffer = await file.arrayBuffer()

        const bee = await this.#store().getBee(signature, buffer)
        if (!bee) continue
        if (!has(bee.iocKey)) register(bee.iocKey, bee)

        this.#bySignature.set(signature, { signature, name: bee.name ?? signature })
        this.#resourceCount = this.#resourceCount + 1
        this.dispatchEvent(new CustomEvent('change'))
      } catch {
        console.log(`[script-preloader] failed to load resource ${signature} from OPFS`)
      }
    }
  }

  #refreshProjection = (): void => {
    const list = [...this.#bySignature.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.#actions = list
    this.#actionNames = list.map(a => (a.name ?? '').replace(/-/g, ' '))
    this.dispatchEvent(new CustomEvent('change'))
  }

  #isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)
}

register('@hypercomb.social/ScriptPreloader', new ScriptPreloader())
