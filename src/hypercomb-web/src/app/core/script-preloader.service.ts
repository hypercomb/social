// src/app/core/script-preloader.service.ts

import { Injectable, signal } from '@angular/core'

export interface ActionDescriptor {
  signature: string
  name: string // canonical kebab-case name, e.g. "add-tile"
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloaderService {

  // -------------------------------------------------
  // authoritative stores
  // -------------------------------------------------

  // signature -> payload bytes
  private readonly payloadBySignature = new Map<string, ArrayBuffer>()

  // kebab-case name -> descriptor
  private readonly byName = new Map<string, ActionDescriptor>()

  // signature -> descriptor
  private readonly bySignature = new Map<string, ActionDescriptor>()

  // -------------------------------------------------
  // projected state (UI only)
  // -------------------------------------------------

  // descriptors with display names derived
  public readonly actions = signal<readonly ActionDescriptor[]>([])

  // legacy UI list (space-separated, derived)
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
  // incremental mutation
  // -------------------------------------------------

  public add = (signature: string, bytes: ArrayBuffer): void => {
    const isNew = !this.payloadBySignature.has(signature)

    this.payloadBySignature.set(signature, bytes)

    if (isNew) {
      this.resourceCount.update(v => v + 1)
    }

    const name = this.extractActionName(bytes)
    if (!name) return

    const desc: ActionDescriptor = { signature, name }

    this.byName.set(name, desc)
    this.bySignature.set(signature, desc)

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
    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    let count = 0

    for await (const [signature, handle] of resources.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()
      const buffer = await file.arrayBuffer()

      this.payloadBySignature.set(signature, buffer)
      count++

      const name = this.extractActionName(buffer)
      if (!name) continue

      const desc: ActionDescriptor = { signature, name }
      this.byName.set(name, desc)
      this.bySignature.set(signature, desc)
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

    // derive spaced names for typing / autocomplete
    this.actionNames.set(
      list.map(a => a.name.replace(/-/g, ' '))
    )
  }

  // -------------------------------------------------
  // extraction (canonical kebab-case)
  // -------------------------------------------------

  private extractActionName = (buf: ArrayBuffer): string | null => {
    const src = this.decoder.decode(new Uint8Array(buf))

    if (!src.includes('class') || !src.includes('Action')) return null

    const m = src.match(
      /class\s+([A-Za-z0-9_]+)\s+extends\s+(?:[\w.]*\.)?([A-Za-z0-9_]*Action)\b/
    )

    if (!m) return null

    // FooBarAction → foo-bar
    return m[1]
      .replace(/Action$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
  }
}
