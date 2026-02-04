// src/app/core/script-preloader.service.ts
//
// production-ready
// - ioc is the single source of truth for drone instances
// - byName is a production projection for ux / grammar / display
// - this service owns discovery + projection only
// - no duplicated instance storage

import { inject, Injectable, signal } from '@angular/core'
import { Drone, type DroneResolver, get as iocGet, has as iocHas, list } from '@hypercomb/core'
import { Lineage } from './lineage'
import { DirectoryWalkerService } from './directory-walker.service'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService implements DroneResolver {

  private readonly lineage = inject(Lineage)  
  private readonly walker = inject(DirectoryWalkerService)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // authoritative projection (no instances here)
  // -------------------------------------------------
  private readonly bySignature = new Map<string, ActionDescriptor>()

  // -------------------------------------------------
  // projected state (ui)
  // -------------------------------------------------

  public readonly actions = signal<readonly ActionDescriptor[]>([])
  public readonly actionNames = signal<readonly string[]>([])
  public readonly resourceCount = signal(0)

  // -------------------------------------------------
  // ioc delegation (execution truth)
  // -------------------------------------------------

  public get = (signature: string): Drone | undefined =>
    iocGet<Drone>(signature)

  public has = (signature: string): boolean =>
    iocHas(signature)

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.bySignature.get(signature)?.name ?? null

  // -------------------------------------------------
  // drone resolution (grammar → signatures)
  // -------------------------------------------------

  public find = async (_name: string): Promise<Drone[]> => {
    // grammar resolution happens in the processor
    // this resolver only exposes available actions
    return []
  }

  // -------------------------------------------------
  // incremental projection mutation
  // -------------------------------------------------

  public add = (signature: string, drone: Drone): void => {
    if (this.bySignature.has(signature)) return

    const name = drone.name
      .toLowerCase()
      .replace(/\s+/g, '-')

    const descriptor: ActionDescriptor = { signature, name }

    this.bySignature.set(signature, descriptor)

    this.resourceCount.update(v => v + 1)
    this.refreshProjection()
  }

  // -------------------------------------------------
  // bulk initialization (discovery only)
  // -------------------------------------------------

  public preload = async (): Promise<void> => {

    this.bySignature.clear()

    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    const depth = 3
    const root = this.store.opfsRoot
    const walked = (await this.walker.walk(root, depth))
      .map(w => w.handle)
      .slice(1)

    for await (const handle of walked) {
      for await (const [fileName, entry] of handle.entries()) {
        if (entry.kind !== 'file') continue
        if (!/^[a-f0-9]{64}$/i.test(fileName)) continue

        const drone = await this.store.getDrone(fileName)
        if (!drone) continue
        
        // expectation: drone constructor already registered into ioc
        this.add(fileName, drone)
      }
    }
  }

  // -------------------------------------------------
  // projection rebuild (ui-only)
  // -------------------------------------------------

  private refreshProjection = (): void => {
    const list = [...this.bySignature.values()]
      .sort((a, b) => a.name.localeCompare(b.name))

    this.actions.set(list)
    this.actionNames.set(list.map(a => a.name.replace(/-/g, ' ')))
  }
}
