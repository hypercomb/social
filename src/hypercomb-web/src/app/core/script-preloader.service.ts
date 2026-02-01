// src/app/core/script-preloader.service.ts

import { inject, Injectable, signal } from '@angular/core'
import { Drone, type DroneResolver } from '@hypercomb/core'
import { Lineage } from './lineage'
import { DirectoryWalkerService } from './directory-walker.service'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService implements DroneResolver {

  private readonly lineage = inject(Lineage)
  private readonly walker = inject(DirectoryWalkerService)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // authoritative stores
  // -------------------------------------------------

  private readonly byName = new Map<string, ActionDescriptor>()
  private readonly bySignature = new Map<string, ActionDescriptor>()
  private readonly droneBySignature = new Map<string, Drone>()

  // -------------------------------------------------
  // projected state (UI)
  // -------------------------------------------------

  public readonly actions = signal<readonly ActionDescriptor[]>([])
  public readonly actionNames = signal<readonly string[]>([])
  public readonly resourceCount = signal(0)

  // -------------------------------------------------
  // lookup api
  // -------------------------------------------------

  public get = (signature: string): Drone | undefined =>
    this.droneBySignature.get(signature)

  public has = (signature: string): boolean =>
    this.droneBySignature.has(signature)

  public resolveByName = (name: string): ActionDescriptor | undefined =>
    this.byName.get(name)

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  // **new – UI helper**
  public getActionName = (signature: string): string | null =>
    this.bySignature.get(signature)?.name ?? null

  // -------------------------------------------------
  // discovery (placeholder – unchanged)
  // -------------------------------------------------

  public find = async (_input: string): Promise<Drone[]> => {
    return []
  }

  // -------------------------------------------------
  // incremental mutation
  // -------------------------------------------------

  public add = (signature: string, drone: Drone): void => {
    if (this.droneBySignature.has(signature)) return

    this.droneBySignature.set(signature, drone)

    const name = drone.name
      .toLowerCase()
      .replace(/\s+/g, '-')

    const descriptor: ActionDescriptor = { signature, name }

    this.bySignature.set(signature, descriptor)
    this.byName.set(name, descriptor)

    this.resourceCount.update(v => v + 1)
    this.refreshProjection()
  }

  // -------------------------------------------------
  // bulk initialization
  // -------------------------------------------------

  public preload = async (): Promise<void> => {

    this.byName.clear()
    this.bySignature.clear()
    this.droneBySignature.clear()

    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    const depth = 3
    const root = this.store.opfsRoot
    const walked = (await this.walker.walk(root, depth)).map(w => w.handle).slice(1)

    for await (const handle of walked) {
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file') continue
        if (!/^[a-f0-9]{64}$/i.test(name)) continue

        const drone = await this.store.getDrone(name)
        if (drone) {
          this.add(name, drone)
        }
      }
    }
  }

  // -------------------------------------------------
  // projection rebuild (UI-only)
  // -------------------------------------------------

  private refreshProjection = (): void => {
    const list = [...this.byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))

    this.actions.set(list)
    this.actionNames.set(list.map(a => a.name.replace(/-/g, ' ')))
  }
}
