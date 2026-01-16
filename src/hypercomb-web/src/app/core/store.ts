import { inject, Injectable } from '@angular/core'
import { ScriptPreloaderService } from './script-preloader.service'
import { SignatureService, Action } from '@hypercomb/core'
import { Lineage } from './lineage'
import { CompletionUtility } from './completion-utility'

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

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    this.root = await navigator.storage.getDirectory()
    this.resources = await this.root.getDirectoryHandle(Store.RESOURCES_DIRECTORY, { create: true })

    // preload all existing resources into memory + intellisense
    await this.preloader.initialize(this.resources)
  }

  // -------------------------------------------------
  // resolve runnable actions (root → leaf markers)
  // -------------------------------------------------

  public find = async (name: string): Promise<Action[]> => {
    const actions: Action[] = []

    console.log('[store] finding actions for', name)
    const clean = this.completion.normalize(name)
    const descriptor = this.preloader.resolveByName(clean)
    if (!descriptor) return actions

    const bytes = this.preloader.get(descriptor.signature)
    if (!bytes) return actions

    const mod = await this.loadModule(bytes)

    console.log('[store] loaded module for', name, mod)
    
    // find the exported action class
    const ActionCtor =
      (mod as any).default ??
      Object.values(mod as any).find(v => typeof v === 'function')

    if (!ActionCtor) {
      console.warn('[store] no action export found for', name)
      return actions
    }

    actions.push(new ActionCtor())

    return actions
  }


  // -------------------------------------------------
  // store compiled action payload
  // -------------------------------------------------

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

  // -------------------------------------------------
  // esm execution
  // -------------------------------------------------

  private loadModule = async (bytes: ArrayBuffer): Promise<unknown> => {

    console.log(
      '[store] module source:',
      new TextDecoder().decode(bytes)
    )


    const blob = new Blob([bytes], { type: 'application/javascript' })

    const url = URL.createObjectURL(blob)

    try {
      const result = await import(/* @vite-ignore */ url)
      return result
    }
    catch (error) {
      console.error('[store] failed to load module', error)
      throw error
    }
  }

  // -------------------------------------------------
  // extract Action classes safely
  // -------------------------------------------------

  private extractActions = (module: unknown): Action[] => {
    const out: Action[] = []

    if (!module || typeof module !== 'object') return out

    for (const value of Object.values(module as Record<string, unknown>)) {
      if (typeof value !== 'function') continue
      if (!(value.prototype instanceof Action)) continue

      const Ctor = value as ActionCtor
      out.push(new Ctor())
    }

    return out
  }
}
