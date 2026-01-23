// src/app/core/lineage.ts

import { inject, Injectable, signal } from '@angular/core'
import { CompletionUtility } from './completion-utility'
import { Store } from './store'

type DomainState = {
  segments: string[]
}

@Injectable({ providedIn: 'root' })
export class Lineage {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly completions = inject(CompletionUtility)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // domain context (in-memory url prefix)
  // -------------------------------------------------

  private domainRoot!: FileSystemDirectoryHandle
  private readonly activeDomain = signal('hypercomb')
  public readonly domain = (): string => this.activeDomain()

  // -------------------------------------------------
  // explorer path (in-memory per domain)
  // -------------------------------------------------

  private readonly perDomain = new Map<string, DomainState>()
  private readonly explorerSegmentsSig = signal(0)

  // -------------------------------------------------
  // status
  // -------------------------------------------------

  public readonly ready = signal(false)
  public readonly materialized = signal(true)
  public readonly missing = signal<readonly string[]>([])

  // revision bump for ui refresh (domain switch, explorer nav, fs writes)
  private readonly fsRevision = signal(0)
  public readonly changed = (): number => this.fsRevision()
  public readonly invalidate = (): void => this.fsRevision.update(v => v + 1)

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    // default domain is hypercomb
    await this.setDomain('hypercomb')
    this.ready.set(true)
  }

  // -------------------------------------------------
  // domain listing (opfs root folders)
  // -------------------------------------------------

  public listDomains = async (): Promise<string[]> => {
    const out: string[] = []
    const root = this.store.opfsDirectory()

    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue
      out.push(name)
    }

    out.sort((a, b) => a.localeCompare(b))
    return out
  }

  // -------------------------------------------------
  // domain selection
  // -------------------------------------------------

  public setDomain = async (name: string): Promise<void> => {
    const clean = this.clean(name)
    if (!clean) return

    // domain folders are real siblings at opfs root
    this.domainRoot = await this.store.domainDirectory(clean, true)
    this.activeDomain.set(clean)

    // domain change does not touch browser url
    // explorer state is preserved per domain
    this.touchExplorer()
    this.invalidate()
  }

  // -------------------------------------------------
  // url segments (browser address only)
  // -------------------------------------------------

  public urlSegments = (): string[] =>
    window.location.pathname
      .split('/')
      .filter(Boolean)
      .map(s => this.completions.normalize(s))

  // -------------------------------------------------
  // explorer segments (in-memory, per domain)
  // -------------------------------------------------

  private readonly state = (): DomainState => {
    const key = this.activeDomain()
    const existing = this.perDomain.get(key)
    if (existing) return existing

    // first time a domain is selected, seed explorer path from current url
    const created: DomainState = { segments: [...this.urlSegments()] }
    this.perDomain.set(key, created)
    return created
  }

  public explorerSegments = (): readonly string[] => {
    // reading state ties this to active domain automatically
    return this.state().segments
  }

  public explorerEnter = (name: string): void => {
    const clean = this.clean(name)
    if (!clean) return

    this.state().segments.push(clean)
    this.touchExplorer()
  }

  public explorerUp = (): void => {
    const s = this.state()

    // when at the top of a domain, "up" means: show opfs root domain folders
    if (s.segments.length === 0) {
      this.touchExplorer(true)
      return
    }

    s.segments.pop()
    this.touchExplorer()
  }

  // clears explorer path to show opfs root domain folders
  // does not change active domain
  public showDomainRoot = (): void => {
    this.touchExplorer(true)
  }

  // visual path shown by explorer
  // - when explorer segments are empty and root mode is requested, explorer shows "/" and lists domains
  // - otherwise shows "/{domain}/{segments...}"
  public explorerLabel = (): string => {
    const segs = this.explorerSegments()
    const rootMode = this.isExplorerAtDomainSelector()

    if (rootMode) return '/'

    return '/' + [this.domain(), ...segs].filter(Boolean).join('/')
  }

  // -------------------------------------------------
  // directory resolution
  // -------------------------------------------------

  // when explorer is at domain selector: resolve to opfs root
  // otherwise: resolve from active domain root + explorer segments
  public explorerDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (this.isExplorerAtDomainSelector()) {
      return this.store.opfsDirectory()
    }

    return await this.tryResolve(this.explorerSegments(), this.domainRoot)
  }

  // creates missing directories for segments under the active domain root
  public ensure = async (segments: readonly string[]): Promise<FileSystemDirectoryHandle> => {
    let dir = this.domainRoot

    for (const seg of segments) {
      const clean = this.clean(seg)
      if (!clean) continue
      dir = await dir.getDirectoryHandle(clean, { create: true })
    }

    this.invalidate()
    return dir
  }

  // read-only resolution:
  // - never creates
  // - never throws for missing segments
  // - updates materialized/missing state
  public tryResolve = async (
    segments: readonly string[],
    start: FileSystemDirectoryHandle = this.domainRoot
  ): Promise<FileSystemDirectoryHandle | null> => {
    let dir = start
    const cleaned = segments.map(this.clean).filter(Boolean)

    for (let i = 0; i < cleaned.length; i++) {
      const seg = cleaned[i]
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        this.materialized.set(false)
        this.missing.set(cleaned.slice(i))
        return null
      }
    }

    this.materialized.set(true)
    this.missing.set([])
    return dir
  }

  // -------------------------------------------------
  // marker mutation (explicit intent)
  // -------------------------------------------------

  public addMarker = async (segments: readonly string[], signature: string): Promise<void> => {
    const dir = await this.ensure(segments)

    try {
      await dir.getFileHandle(signature, { create: true })
      this.invalidate()
    } catch {
      // ignore duplicates
    }
  }

  // -------------------------------------------------
  // internal: explorer root mode
  // -------------------------------------------------

  // domain selector mode is represented by a special flag:
  // - explorer segments are empty
  // - and explorer was explicitly switched into selector mode
  private readonly domainSelectorMode = signal(false)

  private readonly isExplorerAtDomainSelector = (): boolean => {
    return this.domainSelectorMode() === true
  }

  private readonly touchExplorer = (toDomainSelector: boolean = false): void => {
    this.domainSelectorMode.set(toDomainSelector)
    this.explorerSegmentsSig.update(v => v + 1)
    this.invalidate()
  }

  // -------------------------------------------------
  // utilities
  // -------------------------------------------------

  private readonly clean = (s: string): string => {
    const noSlashes = (s ?? '').replace(/[\/\\]+/g, ' ')
    return this.completions.normalize(noSlashes)
  }
}
