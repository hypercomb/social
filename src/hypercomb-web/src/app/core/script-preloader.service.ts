// src/app/core/script-preloader.service.ts

import { inject, Injectable, signal } from '@angular/core'
import { Drone, DroneResolver, type DronePayloadV1 } from '@hypercomb/core'
import { Lineage } from './lineage'
import { DirectoryWalkerService } from './directory-walker.service'
import { Store } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // canonical kebab-case example, e.g. "add-pixi"
}

export interface DroneDescriptor {
  signature: string
  name: string
  description: string
  grammar: readonly { example: string }[]
  links: readonly any[]
  effects: readonly string[]
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService implements DroneResolver {
  private readonly lineage = inject(Lineage)
  private readonly walker = inject(DirectoryWalkerService)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // authoritative stores
  // -------------------------------------------------

  // signature -> payload bytes (drone payload json)
  private readonly payloadBySignature = new Map<string, ArrayBuffer>()

  // kebab-case example -> descriptor
  private readonly byName = new Map<string, ActionDescriptor>()

  private readonly drones = new Map<string, Drone[]>()

  // signature -> descriptor
  private readonly bySignature = new Map<string, ActionDescriptor>()

  // droneSig -> drone meaning
  private readonly droneBySignature = new Map<string, DroneDescriptor>()

  // -------------------------------------------------
  // projected state (UI only)
  // -------------------------------------------------

  public readonly actions = signal<readonly ActionDescriptor[]>([])
  public readonly actionNames = signal<readonly string[]>([])
  public readonly resourceCount = signal(0)

  private readonly decoder = new TextDecoder()

  // -------------------------------------------------
  // payload access
  // -------------------------------------------------

  public get = (signature: string): ArrayBuffer | undefined =>
    this.payloadBySignature.get(signature)

  public has = (signature: string): boolean =>
    this.payloadBySignature.has(signature)

  // -------------------------------------------------
  // descriptor resolution (kebab-case ONLY)
  // -------------------------------------------------

  public resolveByName = (name: string): ActionDescriptor | undefined =>
    this.byName.get(name)

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  // -------------------------------------------------
  // find (new discovery)
  // -------------------------------------------------

  // takes user text and returns matching drone signatures in priority order
  // this is the method the DCP should call
  public find = async (input: string): Promise<Drone[]> => {
    return []
  }


  // -------------------------------------------------
  // incremental mutation
  // -------------------------------------------------

  public add = (signature: string, bytes: ArrayBuffer): void => {
    const isNew = !this.payloadBySignature.has(signature)

    this.payloadBySignature.set(signature, bytes)

    if (isNew) {
      this.resourceCount.update(v => v + 1)
    }

    const drone = this.extractDroneDescriptor(signature, bytes)
    if (!drone) return

    this.droneBySignature.set(signature, drone)
    this.refreshProjection()
  }

  // -------------------------------------------------
  // bulk initialization
  // -------------------------------------------------

  public preload = async (): Promise<void> => {

    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    let count = this.resourceCount()
    const depth = 3
    const root = this.store.opfsRoot
    const walked = (await this.walker.walk(root, depth)).map(w => w.handle).slice(1)
    let drones: Drone[] = []

    for await (const handle of walked) {
      const name = handle.name


      if (name.includes("__layers__")) continue
      if (name.includes("__resources__")) continue

      // get the markers from current directory
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file') continue
        if (entry.name.includes('__location__')) continue

        console.log(entry)
        const resource = await this.store.getDrone(entry.name)
        console.log(resource)
        drones.push(resource!)
        count++
      }
      this.drones.set(name, drones)
    }

    this.resourceCount.set(count)
    this.refreshProjection()
  }

  // -------------------------------------------------
  // projection rebuild (UI-only transforms)
  // -------------------------------------------------

  private refreshProjection = (): void => {
    const list = [...this.byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))

    this.actions.set(list)

    this.actionNames.set(
      list.map(a => a.name.replace(/-/g, ' '))
    )
  }

  // -------------------------------------------------
  // payload parsing
  // -------------------------------------------------

  private extractDroneDescriptor = (
    signature: string,
    buf: ArrayBuffer
  ): DroneDescriptor | null => {

    const text = this.decoder.decode(new Uint8Array(buf))

    // this must always be JSON
    if (!text.startsWith('{')) {
      console.error(
        '[script-preloader] non-json resource encountered:',
        signature
      )
      return null
    }

    try {
      const payload = JSON.parse(text) as DronePayloadV1
      if (!payload.drone) return null

      return {
        signature,
        name: payload.drone.name ?? '',
        description: payload.drone.description ?? '',
        grammar: payload.drone.grammar ?? [],
        links: payload.drone.links ?? [],
        effects: ((payload.drone as any).effects ?? []) as string[],
      }
    } catch (err) {
      console.error(
        '[script-preloader] invalid drone payload:',
        signature,
        err
      )
      return null
    }
  }

  private normalizeExample = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
}
