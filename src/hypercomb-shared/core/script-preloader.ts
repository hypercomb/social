// hypercomb-web/src/app/core/script-preloader.ts

import { signal } from '@angular/core'
import { Drone, type DroneResolver } from '@hypercomb/core'
import { Store, type DevManifest } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}
export class ScriptPreloader implements DroneResolver {

  private get store(): Store { return <Store>get("Store")}
  
  private readonly bySignature = new Map<string, ActionDescriptor>()

  public readonly actions = signal<readonly ActionDescriptor[]>([])
  public readonly actionNames = signal<readonly string[]>([])
  public readonly resourceCount = signal(0)

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.bySignature.get(signature)?.name ?? null

  public find = async (_name: string): Promise<Drone[]> => {
    return []
  }

  public preload = async (): Promise<void> => {
    this.bySignature.clear()
    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    for await (const [name, entry] of this.store.opfsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (!this.isDomainName(name)) continue

      const domainDir = entry as FileSystemDirectoryHandle

      let resourcesDir: FileSystemDirectoryHandle
      try {
        resourcesDir = await domainDir.getDirectoryHandle(Store.DRONES_DIRECTORY)
      } catch {
        continue
      }

      await this.loadAllFromDirectory(resourcesDir)
    }

    try {
      const globalResources = await this.store.opfsRoot.getDirectoryHandle(Store.DRONES_DIRECTORY)
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

        const drone = await this.store.getDrone(signature, buffer)
        if (!drone) continue
        register(drone.name, drone)

        this.bySignature.set(signature, { signature, name: drone.name })
        this.resourceCount.update(v => v + 1)
      } catch {
        // ignore
        console.log(`[script-preloader] failed to load resource ${signature} from OPFS`)
      }
    }
  }

  private refreshProjection = (): void => {
    const list = [...this.bySignature.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.actions.set(list)
    this.actionNames.set(list.map(a => a.name.replace(/-/g, ' ')))
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)

  private isDomainName = (name: string): boolean => {
    const raw = (name ?? '').trim()
    if (!raw || raw.startsWith('__')) return false
    if (raw === Store.DRONES_DIRECTORY) return false
    if (raw === Store.DEPENDENCIES_DIRECTORY) return false
    if (raw === 'hypercomb') return false
    return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
  }
}

register('ScriptPreloader', new ScriptPreloader())