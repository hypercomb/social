// src/app/core/store.ts
import { inject, Injectable } from '@angular/core'
import { Action, SignatureService } from '@hypercomb/core'
import { CompletionUtility } from './completion-utility'
import { Lineage } from './lineage'
import { ScriptPreloaderService } from './script-preloader.service'

type ActionCtor = new () => Action

@Injectable({ providedIn: 'root' })
export class Store {

  private static readonly RESOURCES_DIRECTORY = '__resources__'

  private readonly completion = inject(CompletionUtility)
  private readonly lineage = inject(Lineage)

  private root!: FileSystemDirectoryHandle
  private resources!: FileSystemDirectoryHandle

  public constructor(
    private readonly preloader: ScriptPreloaderService
  ) { }

  public initialize = async (): Promise<void> => {
    this.root = await navigator.storage.getDirectory()
    this.resources = await this.root.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })
    await this.preloader.initialize(this.resources)
  }

  public find = async (name: string): Promise<Action[]> => {
    console.log('[store] finding actions for', name)

    const actions: Action[] = []

    const clean = this.completion.normalize(name)
    const descriptor = this.preloader.resolveByName(clean)
    if (!descriptor) return actions

    const bytes = this.preloader.get(descriptor.signature)
    if (!bytes) return actions

    const mod = await this.loadModule(bytes)

    const extracted = this.extractActions(mod)
    if (!extracted.length) {
      console.warn('[store] no action export found for', name)
      return actions
    }

    actions.push(...extracted)
    return actions
  }

  public put = async (bytes: ArrayBuffer): Promise<string> => {
    const signature = await SignatureService.sign(bytes)

    const handle = await this.resources.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    return signature
  }

  public get = (signature: string): ArrayBuffer | null => {
    return this.preloader.get(signature) ?? null
  }

  public has = (signature: string): boolean => {
    return this.preloader.has(signature)
  }

  private loadModule = async (bytes: ArrayBuffer): Promise<unknown> => {
    const blob = new Blob([bytes], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      const result = await import(/* @vite-ignore */ url)
      return result
    } catch (error) {
      console.error('[store] failed to load module', error)
      throw error
    } finally {
      URL.revokeObjectURL(url)
    }
  }

 // src/app/core/store.ts
private extractActions = (module: unknown): Action[] => {
  const out: Action[] =   []

  if (!module || typeof module !== 'object') return out

  for (const [key, value] of Object.entries(module as Record<string, unknown>)) {
    if (typeof value !== 'function') continue

    const proto = (value as any).prototype
    if (!proto) continue

    // must be constructable
    let instance: any
    try {
      instance = new (value as any)()
    } catch {
      continue
    }

    // must look like an action instance
    // (this avoids realm/duplicate-module instanceof problems)
    if (!instance || typeof instance !== 'object') continue
    if (typeof instance.execute !== 'function') continue

    // optional: require id
    // if (typeof instance.id !== 'string' || !instance.id.trim()) continue

    out.push(instance as Action)
  }

  if (!out.length) {
    console.warn('[store] no action-like exports found. exports:', Object.keys(module as any))
  }

  return out
}

}
