// src/app/core/lineage.ts
// explorer is absolute from opfs root
// domain is separate and must not be driven by explorer clicks

import { inject, Injectable, signal } from '@angular/core'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class Lineage {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get store(): Store { return <Store>window.ioc.get("Store")}

  // -------------------------------------------------
  // domain context (used by navigation/search, not the explorer)
  // -------------------------------------------------

  private readonly activeDomain = signal('hypercomb')
  public readonly domain = (): string => this.activeDomain()

  // -------------------------------------------------
  // explorer path (absolute from opfs root)
  // -------------------------------------------------

  private explorerPath: string[] = []

  public explorerSegments = (): readonly string[] => this.explorerPath

  public explorerEnter = (name: string): void => {
    const seg = (name ?? '').trim()
    if (!seg || seg === '.' || seg === '..') return

    // do not normalize explorer names
    this.explorerPath.push(seg)
    this.invalidate()
  }

  public explorerUp = (): void => {
    if (this.explorerPath.length === 0) return
    this.explorerPath.pop()
    this.invalidate()
  }

  // keeps old name so you don't have to refactor callers
  // this now means "show opfs root"
  public showDomainRoot = (): void => {
    this.explorerPath = []
    this.invalidate()
  }

  public explorerLabel = (): string => {
    return '/' + this.explorerPath.join('/')
  }

  public explorerDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    return await this.tryResolveFrom(this.store.opfsRoot, this.explorerPath)
  }

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  public readonly ready = signal(false)
  public readonly materialized = signal(true)
  public readonly missing = signal<readonly string[]>([])

  private readonly fsRevision = signal(0)
  public readonly changed = (): number => this.fsRevision()
  public readonly invalidate = (): void => this.fsRevision.update(v => v + 1)

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    // domain selection is independent from explorer browsing
    await this.setDomain('hypercomb', true)
    this.showDomainRoot()
    this.ready.set(true)
  }

  // -------------------------------------------------
  // domain selection (explicit only)
  // -------------------------------------------------

  public setDomain = async (name: string, createIfMissing = false): Promise<void> => {
    const raw = (name ?? '').trim()
    if (!raw) return

    await this.store.opfsRoot.getDirectoryHandle(raw, { create: createIfMissing })
    this.activeDomain.set(raw)
    this.invalidate()
  }

  // -------------------------------------------------
  // domain resolution (used by navigation/search)
  // -------------------------------------------------

  public tryResolve = async (
    segments: readonly string[],
    start: FileSystemDirectoryHandle = this.store.current
  ): Promise<FileSystemDirectoryHandle | null> => {
    return await this.tryResolveFrom(start, segments)
  }

  // -------------------------------------------------
  // domain creation (used by search bar enter = create seed)
  // -------------------------------------------------

  public ensure = async (
    segments: readonly string[],
    start: FileSystemDirectoryHandle = this.store.hypercombRoot
  ): Promise<FileSystemDirectoryHandle | null> => {

    let dir = start

    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] ?? '').trim()
      if (!seg) continue

      try {
        dir = await dir.getDirectoryHandle(seg, { create: true })
      } catch {
        this.materialized.set(false)
        this.missing.set(segments.slice(i))
        return null
      }
    }

    this.materialized.set(true)
    this.missing.set([])
    this.invalidate()
    return dir
  }

  private readonly tryResolveFrom = async (
    start: FileSystemDirectoryHandle,
    segments: readonly string[]
  ): Promise<FileSystemDirectoryHandle | null> => {

    let dir = start

    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] ?? '').trim()
      if (!seg) continue

      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        this.materialized.set(false)
        this.missing.set(segments.slice(i))
        return null
      }
    }

    this.materialized.set(true)
    this.missing.set([])
    return dir
  }

  // -------------------------------------------------
  // markers: add to an existing directory only (no creation)
  // -------------------------------------------------

  public addMarker = async (segments: readonly string[], signature: string): Promise<void> => {
    const sig = (signature ?? '').trim()
    if (!sig) return

    const dir = await this.tryResolve(segments, this.store.hypercombRoot)
    if (!dir) return

    try {
      await dir.getFileHandle(sig, { create: true })
      this.invalidate()
    } catch {
      // ignore duplicates
    }
  }
}

window.ioc.register('Lineage', new Lineage())
