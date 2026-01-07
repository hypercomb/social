// src/app/core/opfs.store.ts

import { inject, Injectable, signal } from '@angular/core'

import { ScriptPreloaderService } from './script-preloader.service'
import { SignatureService } from '@hypercomb/core'

@Injectable({ providedIn: 'root' })
export class OpfsStore {

  public static readonly RESOURCES_DIR = 'resources'

  private readonly preloader = inject(ScriptPreloaderService)

  // ----------------------------------
  // reactive state
  // ----------------------------------

  public readonly ready = signal(false)
  public readonly actionsReady = signal(false)

  public readonly root = signal<FileSystemDirectoryHandle | null>(null)
  public readonly current = signal<FileSystemDirectoryHandle | null>(null)

  private resources!: FileSystemDirectoryHandle

  // ----------------------------------
  // navigation hooks
  // ----------------------------------

  private readonly onSynchronize = async (e: Event): Promise<void> => {
    const grammar = (e as CustomEvent<string>).detail
    const dir = await this.sync(true, grammar)
    this.current.set(dir)
  }

  private readonly onPopstate = async (): Promise<void> => {
    const dir = await this.sync(false)
    this.current.set(dir)
  }

  constructor() {
    window.addEventListener('synchronize', this.onSynchronize)
  }

  // ----------------------------------
  // init
  // ----------------------------------

  public initialize = async (): Promise<void> => {
    if (this.ready()) return

    const root = await navigator.storage.getDirectory()
    this.root.set(root)

    // resources dir
    this.resources = await root.getDirectoryHandle(
      OpfsStore.RESOURCES_DIR,
      { create: true }
    )

    // single authoritative discovery
    await this.preloader.initialize(this.resources)

    this.actionsReady.set(this.preloader.actionNames().length > 0)
    this.ready.set(true)

    window.addEventListener('popstate', this.onPopstate)

    const dir = await this.sync(false)
    this.current.set(dir)
  }

  // ----------------------------------
  // execution lookup
  // ----------------------------------

  public find = async (): Promise<ArrayBuffer[]> => {
    const out: ArrayBuffer[] = []

    for await (const [signature, handle] of this.current()!.entries()) {
      if (handle.kind !== 'file') continue

      const bytes = this.preloader.get(signature)
      if (bytes) out.push(bytes)
    }

    return out
  }

  // ----------------------------------
  // directory sync
  // ----------------------------------

  public sync = async (
    create: boolean,
    grammar?: string
  ): Promise<FileSystemDirectoryHandle> => {

    const root = this.root()
    if (!root) throw new Error('root not initialized')

    const segments = grammar?.trim()
      ? grammar.trim().split(/\s+/)
      : this.getLineageFromUrl()

    let dir = root

    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create })
    }

    return dir
  }

  // ----------------------------------
  // resources
  // ----------------------------------

  public store = async (bytes: ArrayBuffer): Promise<string> => {
    const signature = await SignatureService.sign(bytes)

    const handle = await this.resources.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    this.actionsReady.set(true)
    return signature
  }

  // ----------------------------------
  // markers
  // ----------------------------------

  public attach = async (actionName: string): Promise<void> => {
    const signature = this.preloader.actionIndex.get(actionName)
    if (!signature) return

    const current = this.current() ?? (await this.sync(false))
    const marker = await current.getFileHandle(signature, { create: true })
    const writable = await marker.createWritable()

    try {
      await writable.write('')
    } finally {
      await writable.close()
    }
  }

  public detach = async (signature: string): Promise<void> => {
    const current = this.current() ?? (await this.sync(false))
    try {
      await current.removeEntry(signature)
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') throw err
    }
  }

  // ----------------------------------
  // utils
  // ----------------------------------

  private getLineageFromUrl = (): string[] => {
    return window.location.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent)
  }
}
