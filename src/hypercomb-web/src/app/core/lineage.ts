// src/app/core/lineage.ts
import { inject, Injectable, signal } from '@angular/core'
import { CompletionUtility } from './completion-utility'

@Injectable({ providedIn: 'root' })
export class Lineage {
  private readonly completions = inject(CompletionUtility)
  private root!: FileSystemDirectoryHandle

  public readonly ready = signal(false)

  // true only when every url segment exists as a directory
  public readonly materialized = signal(true)

  // remaining segments that do not exist yet (read-only state)
  public readonly missing = signal<readonly string[]>([])

  // new: revision bump for UI reactivity (e.g., explorer, processors)
  private readonly fsRevision = signal(0)
  public readonly changed = (): number => this.fsRevision()
  public readonly invalidate = (): void => this.fsRevision.update(v => v + 1)

  public initialize = async (): Promise<void> => {
    this.root = await navigator.storage.getDirectory()
    this.ready.set(true)
  }

  // -------------------------------------------------
  // marker mutation (explicit intent)
  // -------------------------------------------------
  public addMarker = async (
    segments: readonly string[],
    signature: string
  ): Promise<void> => {
    const dir = await this.resolve(segments, true)
    try {
      await dir.getFileHandle(signature, { create: true })
      this.invalidate() // notify listeners of file creation
    } catch {
      // ignore duplicates
    }
  }

  // -------------------------------------------------
  // directory resolution and observation
  // -------------------------------------------------

  // url is the truth, always
  public segments = (): string[] =>
    window.location.pathname
      .split('/')
      .filter(Boolean)
      .map(s => this.completions.normalize(s))

  // resolves a directory handle from segments (optionally creates missing dirs)
  public resolve = async (
    segments: readonly string[],
    create: boolean = false
  ): Promise<FileSystemDirectoryHandle> => {
    let dir = this.root
    for (const seg of segments) {
      const clean = this.clean(seg)
      if (!clean) continue
      dir = await dir.getDirectoryHandle(clean, { create })
    }

    if (create) this.invalidate() // any created directory bumps revision
    return dir
  }

  // read-only resolution:
  // - never creates
  // - never throws for missing segments
  // - updates materialized/missing state so ui can represent "virtual path"
  public tryResolve = async (
    segments: readonly string[]
  ): Promise<FileSystemDirectoryHandle | null> => {
    let dir = this.root
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

  // always resolves from current url (read-only)
  public currentDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    return await this.tryResolve(this.segments())
  }

  // root -> leaf directory handles for current url (only for materialized paths)
  public ancestors = async (): Promise<FileSystemDirectoryHandle[]> => {
    const out: FileSystemDirectoryHandle[] = []
    let dir = this.root
    out.push(dir)

    const segs = this.segments().map(this.clean).filter(Boolean)
    for (const seg of segs) {
      dir = await dir.getDirectoryHandle(seg, { create: false })
      out.push(dir)
    }

    return out
  }

  // marker files are empty files, name == signature
  public markers = async (
    dir: FileSystemDirectoryHandle
  ): Promise<string[]> => {
    const out: string[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') out.push(name)
    }
    return out
  }

  public markersByDepth = async (): Promise<string[][]> => {
    const dirs = await this.ancestors()
    const out: string[][] = []
    for (const dir of dirs) {
      out.push(await this.markers(dir))
    }
    return out
  }

  // -------------------------------------------------
  // utilities
  // -------------------------------------------------
  private readonly clean = (s: string): string => {
    const noSlashes = (s ?? '').replace(/[\/\\]+/g, ' ')
    return this.completions.normalize(noSlashes)
  }
}
