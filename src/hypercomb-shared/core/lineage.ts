// hypercomb-shared/core/lineage.ts
// explorer is relative to the domain root (store.hypercombRoot)
// navigation + explorer are followers and drivers of each other

import { Injectable, signal } from '@angular/core'
import type { Navigation } from './navigation'
import type { Store } from './store'

const { get, register, list } = window.ioc
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
    this.explorerPath.push(seg)
    this.invalidate()

    // explorer drives navigation
    try { this.navigation.goRaw(this.explorerPath) } catch { /* ignore */ }
  }

  public explorerUp = (): void => {
    if (this.explorerPath.length === 0) return
    this.explorerPath.pop()
    this.invalidate()

    // explorer drives navigation
    try { this.navigation.goRaw(this.explorerPath) } catch { /* ignore */ }
  }

  // keeps old name so you don't have to refactor callers
  // this now means "show domain root"
  public showDomainRoot = (): void => {
    this.explorerPath = []
    this.invalidate()

    // explorer drives navigation
    try { this.navigation.goRaw([]) } catch { /* ignore */ }
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
  public readonly invalidate = (): void => this.fsRevision.update(v => v + 1)

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
    // keep api stable; domain is fixed for now
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

    // only ensures existence; store wiring can evolve later
    await this.store.opfsRoot.getDirectoryHandle(raw, { create: createIfMissing })
    this.activeDomain.set(raw)

    // keep explorer aligned to url after domain change
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

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  private readonly followLocation = (): void => {
    try {
      // follower: mirror the url using normalized segments (matches on-disk naming rules)
      this.explorerPath = this.navigation.segments()
      this.invalidate()
    } catch {
      // ignore until nav is ready
    }
  }
}

window.ioc.register('Lineage', new Lineage())