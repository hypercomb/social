// src/app/core/script-preloader.service.ts
//
// production-ready
// - ioc is the single source of truth for drone instances
// - byName is a production projection for ux / grammar / display
// - this service owns discovery + projection only
// - no duplicated instance storage

import { inject, Injectable, signal } from '@angular/core'
import { Drone, type DroneResolver, get, has, list } from '@hypercomb/core'
import { Lineage } from './lineage'
import { DirectoryWalkerService } from './directory-walker.service'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloader implements DroneResolver {

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
  // bulk initialization (discovery only)
  // -------------------------------------------------

  public preload = async (): Promise<void> => {

    this.bySignature.clear()

    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    const root = this.store.opfsRoot

    let resourcesDir: FileSystemDirectoryHandle
    try {
      resourcesDir = await root.getDirectoryHandle('__resources__')
    } catch {
      // no resources is a valid empty state
      return
    }

    for await (const [fileName, entry] of resourcesDir.entries()) {

      if (entry.kind !== 'file') continue
      if (!/^[a-f0-9]{64}$/i.test(fileName)) continue

      const drone = await this.store.getDrone(fileName)
      if (!drone) continue

      // expectation: drone constructor already registered into ioc
      const name = drone.name
        .toLowerCase()
        .replace(/\s+/g, '-')

      const descriptor: ActionDescriptor = {
        signature: fileName,
        name
      }

      this.bySignature.set(fileName, descriptor)

      this.resourceCount.update(v => v + 1)
      this.refreshProjection()
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
