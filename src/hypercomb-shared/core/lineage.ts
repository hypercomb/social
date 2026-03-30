// hypercomb-shared/core/lineage.ts
// synchronize is dispatched only by the processor — lineage fires 'change' on itself

import type { Navigation } from './navigation'

// global get/register/list available via ioc.web.ts

export class Lineage extends EventTarget {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }

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
    this.invalidate()

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
    this.invalidate()

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
    this.invalidate()

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
    return null
  }

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  #ready = false
  #materialized = true
  #missing: readonly string[] = []
  #fsRevision = 0

  public get ready(): boolean { return this.#ready }
  public get materialized(): boolean { return this.#materialized }
  public get missing(): readonly string[] { return this.#missing }

  public changed = (): number => this.#fsRevision

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public constructor() {
    super()
    // follow url changes (programmatic + back/forward)
    window.addEventListener('navigate', this.followLocation)
    window.addEventListener('popstate', this.followLocation)

    // best-effort initial sync (safe if nav/store aren't ready yet)
    this.followLocation()

    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  public initialize = async (): Promise<void> => {
    this.followLocation()
    this.#ready = true
    this.dispatchEvent(new CustomEvent('change'))
  }

  // -------------------------------------------------
  // domain resolution (used by navigation/search)
  // -------------------------------------------------

  public tryResolve = async (
    segments: readonly string[],
    start?: FileSystemDirectoryHandle
  ): Promise<FileSystemDirectoryHandle | null> => {
    if (!start) return null
    return await this.tryResolveFrom(start, segments)
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
        const wasMaterialized = this.#materialized
        const hadMissing = this.#missing.length > 0
        this.#materialized = false
        this.#missing = segments.slice(i)
        if (wasMaterialized || !hadMissing) this.dispatchEvent(new CustomEvent('change'))
        return null
      }
    }

    if (!this.#materialized || this.#missing.length > 0) {
      this.#materialized = true
      this.#missing = []
      this.dispatchEvent(new CustomEvent('change'))
    }
    return dir
  }

  public addMarker = async (_segments: readonly string[], _signature: string): Promise<void> => {
    // no-op: directory-based markers removed
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  private readonly invalidate = (): void => {
    this.#fsRevision = this.#fsRevision + 1
    this.dispatchEvent(new CustomEvent('change'))
  }

  private readonly followLocation = (): void => {
    try {
      // explorer path must stay lossless; use raw decoded URL segments
      const next = this.navigation.segmentsRaw()

      // do not spam invalidations if nothing changed
      if (this.sameSegments(this.explorerPath, next)) return

      this.explorerPath = next
      this.invalidate()
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

register('@hypercomb.social/Lineage', new Lineage())
