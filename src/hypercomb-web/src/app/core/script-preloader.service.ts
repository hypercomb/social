// src/app/core/script-preloader.service.ts

import { Injectable, signal } from '@angular/core'
import { type DronePayloadV1 } from '@hypercomb/core'

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
export class ScriptPreloaderService {

  // -------------------------------------------------
  // authoritative stores
  // -------------------------------------------------

  // signature -> payload bytes (drone payload json)
  private readonly payloadBySignature = new Map<string, ArrayBuffer>()

  // kebab-case example -> descriptor
  private readonly byName = new Map<string, ActionDescriptor>()

  // signature -> descriptor
  private readonly bySignature = new Map<string, ActionDescriptor>()

  // droneSig -> drone meaning
  private readonly droneBySignature = new Map<string, DroneDescriptor>()

  // space example -> droneSig list (new discovery)
  private readonly dronesByExample = new Map<string, string[]>()

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
  public find = (text: string): readonly string[] => {
    const normalized = this.normalizeExample(text)
    if (!normalized) return []

    // exact example match first
    const exact = this.dronesByExample.get(normalized)
    if (exact?.length) return exact

    // fallback: match by kebab-name (legacy autocomplete list)
    // "add pixi" => "add-pixi"
    const kebab = normalized.replace(/\s+/g, '-')
    const desc = this.byName.get(kebab)
    return desc ? [desc.signature] : []
  }

  // convenience: return full drone descriptors instead of signatures
  public findDrones = (text: string): readonly DroneDescriptor[] => {
    const sigs = this.find(text)
    const out: DroneDescriptor[] = []

    for (const sig of sigs) {
      const d = this.droneBySignature.get(sig)
      if (d) out.push(d)
    }

    return out
  }

  // convenience: when you already have an example string ("add pixi")
  public resolveDroneSigsByExample = (example: string): readonly string[] =>
    this.dronesByExample.get(this.normalizeExample(example)) ?? []

  public resolveDrone = (signature: string): DroneDescriptor | undefined =>
    this.droneBySignature.get(signature)

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
    this.indexDroneExamples(signature, drone.grammar)

    this.refreshProjection()
  }

  // -------------------------------------------------
  // bulk initialization
  // -------------------------------------------------

  public initialize = async (
    resources: FileSystemDirectoryHandle
  ): Promise<void> => {

    this.payloadBySignature.clear()
    this.byName.clear()
    this.bySignature.clear()
    this.droneBySignature.clear()
    this.dronesByExample.clear()

    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    let count = 0

    // load all resources
    for await (const [signature, handle] of resources.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()
      const buffer = await file.arrayBuffer()

      this.payloadBySignature.set(signature, buffer)
      count++

      const drone = this.extractDroneDescriptor(signature, buffer)
      if (!drone) continue

      this.droneBySignature.set(signature, drone)
      this.indexDroneExamples(signature, drone.grammar)
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


  // -------------------------------------------------
  // grammar indexing
  // -------------------------------------------------

  private indexDroneExamples = (
    droneSig: string,
    grammar: readonly { example: string }[]
  ): void => {

    for (const item of grammar ?? []) {
      const example = this.normalizeExample(item?.example ?? '')
      if (!example) continue

      const list = this.dronesByExample.get(example) ?? []
      if (!list.includes(droneSig)) list.push(droneSig)
      this.dronesByExample.set(example, list)

      const name = example.replace(/\s+/g, '-')
      const desc: ActionDescriptor = { signature: droneSig, name }

      this.byName.set(name, desc)
      this.bySignature.set(droneSig, desc)
    }
  }

  private normalizeExample = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
}
