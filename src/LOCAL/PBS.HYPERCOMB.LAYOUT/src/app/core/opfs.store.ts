// src/app/core/opfs.store.ts

import { Injectable, signal } from '@angular/core'
import { SignatureService } from '@hypercomb/core'

@Injectable({ providedIn: 'root' })
export class OpfsStore {

  public static readonly RESOURCES_DIR = 'resources'

  // -------------------------------------------------
  // reactive state
  // -------------------------------------------------

  public readonly ready = signal(false)

  // true once at least one action is discoverable
  public readonly actionsReady = signal(false)

  public readonly root = signal<FileSystemDirectoryHandle | null>(null)
  public readonly current = signal<FileSystemDirectoryHandle | null>(null)

  private resourcesHandle?: FileSystemDirectoryHandle

  // -------------------------------------------------
  // navigation hooks
  // -------------------------------------------------

  private readonly onSynchronize = async (): Promise<void> => {
    const dir = await this.syncToUrl(true)
    this.current.set(dir)
  }

  private readonly onPopstate = async (): Promise<void> => {
    const dir = await this.syncToUrl(false)
    this.current.set(dir)
  }

  constructor() {
    window.addEventListener('synchronize', this.onSynchronize)
  }

  // -------------------------------------------------
  // init
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.ready()) return

    const root = await navigator.storage.getDirectory()
    this.root.set(root)

    // resources dir
    this.resourcesHandle =
      await root.getDirectoryHandle(OpfsStore.RESOURCES_DIR, { create: true })

    // discover actions once, at init
    const hasAnyActions = await this.discoverActions()
    this.actionsReady.set(hasAnyActions)

    this.ready.set(true)

    window.addEventListener('popstate', this.onPopstate)

    const dir = await this.syncToUrl(false)
    this.current.set(dir)
  }

  // -------------------------------------------------
  // discovery
  // -------------------------------------------------

  private discoverActions = async (): Promise<boolean> => {
    // intentionally conservative:
    // existence of at least one executable action is enough

    const resources = this.resourcesHandle
    if (!resources) return false

    try {
      for await (const _ of (resources as any).values()) {
        return true
      }
    } catch {
      // ignore enumeration errors
    }

    return false
  }

  // -------------------------------------------------
  // directory sync
  // -------------------------------------------------

  public syncToUrl = async (create: boolean): Promise<FileSystemDirectoryHandle> => {
    const root = this.root()
    if (!root) throw new Error('root not initialized')

    const segments = this.getLineageFromUrl()
    let dir = root

    for (const seg of segments) {
      dir = await dir.getDirectoryHandle(seg, { create })
    }

    return dir
  }

  public add = async (name: string): Promise<FileSystemDirectoryHandle> => {
    const base = this.current() ?? this.root()
    if (!base) throw new Error('no active directory')
    return await base.getDirectoryHandle(name, { create: true })
  }

  // -------------------------------------------------
  // resources
  // -------------------------------------------------

  public store = async (bytes: ArrayBuffer): Promise<string> => {
    if (!(bytes instanceof ArrayBuffer)) throw new Error('invalid bytes')
    const dir = this.resourcesHandle
    if (!dir) throw new Error('resources not initialized')

    const signature = await SignatureService.sign(bytes)
    const handle = await dir.getFileHandle(signature, { create: true })
    const writable = await handle.createWritable()

    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }

    // first successful store implies actions exist
    if (!this.actionsReady()) {
      this.actionsReady.set(true)
    }

    return signature
  }

  public attach = async (signature: string): Promise<void> => {
    const resources = this.resourcesHandle
    if (!resources) throw new Error('resources not initialized')

    await resources.getFileHandle(signature, { create: false })

    const current = this.current() ?? (await this.syncToUrl(false))
    const marker = await current.getFileHandle(signature, { create: true })
    const writable = await marker.createWritable()

    try {
      await writable.write('')
    } finally {
      await writable.close()
    }
  }

  public detach = async (signature: string): Promise<void> => {
    const current = this.current() ?? (await this.syncToUrl(false))
    try {
      await current.removeEntry(signature)
    } catch (err) {
      if ((err as DOMException | undefined)?.name !== 'NotFoundError') throw err
    }
  }

  // -------------------------------------------------
  // utils
  // -------------------------------------------------

  private getLineageFromUrl = (): string[] => {
    return window.location.pathname.split('/').filter(Boolean)
  }
}
