// hypercomb-shared/core/lineage.ts
// fix: synchronize is the single visual update mechanism

import { Injectable, signal } from '@angular/core'
import type { Navigation } from './navigation'
import type { Store } from './store'

const { get, list } = window.ioc
void list

@Injectable({ providedIn: 'root' })
export class Lineage {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get store(): Store { return get('Store') as Store }
  private get navigation(): Navigation { return get('Navigation') as Navigation }

  // -------------------------------------------------
  // domain context (reserved for later)
  // -------------------------------------------------

  private readonly activeDomain = signal('hypercomb.io')
  public readonly domain = (): string => this.activeDomain()

  // -------------------------------------------------
  // explorer path (domain-relative)
  // -------------------------------------------------

  private explorerPath: string[] = []
  public explorerSegments = (): readonly string[] => this.explorerPath

  public explorerEnter = (name: string): void => {
    const seg = (name ?? '').trim()
    if (!seg || seg === '.' || seg === '..') return

    // do not normalize explorer names
    this.explorerPath = [...this.explorerPath, seg]
    this.invalidate('explorer')

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw(this.explorerPath)
    } catch {
      // fallback: still notify followers even if navigation isn't ready
      this.dispatchNavigateFallback()
    }
  }

  public explorerUp = (): void => {
    if (this.explorerPath.length === 0) return
    this.explorerPath = this.explorerPath.slice(0, -1)
    this.invalidate('explorer')

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw(this.explorerPath)
    } catch {
      this.dispatchNavigateFallback()
    }
  }

  // keeps old name so you don't have to refactor callers
  // this now means "show domain root"
  public showDomainRoot = (): void => {
    this.explorerPath = []
    this.invalidate('explorer')

    // explorer drives navigation (best effort)
    try {
      this.navigation.goRaw([])
    } catch {
      this.dispatchNavigateFallback()
    }
  }

  public explorerLabel = (): string => {
    return '/' + this.explorerPath.join('/')
  }

  public explorerDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    try {
      // domain root (hypercomb.io)
      return await this.tryResolveFrom(this.store.hypercombRoot, this.explorerPath)
    } catch {
      return null
    }
  }

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  public readonly ready = signal(false)
  public readonly materialized = signal(true)
  public readonly missing = signal<readonly string[]>([])

  private readonly fsRevision = signal(0)
  public readonly changed = (): number => this.fsRevision()

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    // follow url changes (programmatic + back/forward)
    window.addEventListener('navigate', this.followLocation)
    window.addEventListener('popstate', this.followLocation)

    // best-effort initial sync (safe if nav/store aren't ready yet)
    this.followLocation()

    this.ready.set(true)
  }

  public initialize = async (): Promise<void> => {
    this.activeDomain.set('hypercomb.io')
    this.followLocation()
    this.ready.set(true)
  }

  // -------------------------------------------------
  // domain selection (explicit only, reserved)
  // -------------------------------------------------

  public setDomain = async (name: string, createIfMissing = false): Promise<void> => {
    const raw = (name ?? '').trim()
    if (!raw) return

    await this.store.opfsRoot.getDirectoryHandle(raw, { create: createIfMissing })
    this.activeDomain.set(raw)
    this.followLocation()
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
    this.invalidate('fs')
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

  public addMarker = async (segments: readonly string[], signature: string): Promise<void> => {
    const sig = (signature ?? '').trim()
    if (!sig) return

    const dir = await this.tryResolve(segments, this.store.hypercombRoot)
    if (!dir) return

    try {
      await dir.getFileHandle(sig, { create: true })
      this.invalidate('fs')
    } catch {
      // ignore duplicates
    }
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  private readonly invalidate = (reason: 'explorer' | 'url' | 'fs'): void => {
    this.fsRevision.update(v => v + 1)

    window.dispatchEvent(new CustomEvent('synchronize', {
      detail: {
        source: `lineage:${reason}`,
        rev: this.fsRevision(),
        path: this.explorerLabel(),
        segments: [...this.explorerPath]
      }
    }))
  }

  private readonly followLocation = (): void => {
    try {
      // explorer path must stay lossless; use raw decoded URL segments
      const next = this.navigation.segmentsRaw()

      // do not spam invalidations if nothing changed
      if (this.sameSegments(this.explorerPath, next)) return

      this.explorerPath = next
      this.invalidate('url')
    } catch {
      // ignore until nav is ready
    }
  }

  private readonly sameSegments = (a: readonly string[], b: readonly string[]): boolean => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if ((a[i] ?? '') !== (b[i] ?? '')) return false
    }
    return true
  }

  private readonly dispatchNavigateFallback = (): void => {
    try {
      window.dispatchEvent(new Event('navigate'))
    } catch {
      // ignore
    }
  }
}

window.ioc.register('Lineage', new Lineage())