import { Injectable } from '@angular/core'

export interface DiscoveredTextFile {
  path: string
  handle: FileSystemFileHandle
}

export interface WalkTextFilesOptions {
  extensions?: readonly string[]
  maxFiles?: number
}

@Injectable({ providedIn: 'root' })
export class OpfsAgent {

  public getRoot = async (): Promise<FileSystemDirectoryHandle> => {
    return await navigator.storage.getDirectory()
  }

  public tryGetDirectory = async (path: string): Promise<FileSystemDirectoryHandle | null> => {
    try {
      const root = await this.getRoot()
      return await this.walkToDirectory(root, path)
    } catch {
      return null
    }
  }

  public walkTextFiles = async (
    rootDir: FileSystemDirectoryHandle,
    rootPath: string,
    options?: WalkTextFilesOptions
  ): Promise<DiscoveredTextFile[]> => {

    const extensions = options?.extensions ?? []
    const maxFiles = options?.maxFiles ?? 10_000

    const results: DiscoveredTextFile[] = []
    await this.walkDir(rootDir, rootPath, extensions, maxFiles, results)

    return results
  }

  private walkToDirectory = async (
    root: FileSystemDirectoryHandle,
    path: string
  ): Promise<FileSystemDirectoryHandle> => {

    const parts = path.split('/').filter(p => !!p)
    let dir = root

    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }

    return dir
  }

  private walkDir = async (
    dir: FileSystemDirectoryHandle,
    basePath: string,
    extensions: readonly string[],
    maxFiles: number,
    results: DiscoveredTextFile[]
  ): Promise<void> => {

    if (results.length >= maxFiles) return

    for await (const [name, handle] of dir.entries()) {
      if (results.length >= maxFiles) return

      const nextPath = basePath ? `${basePath}/${name}` : name

      if (handle.kind === 'directory') {
        await this.walkDir(handle as FileSystemDirectoryHandle, nextPath, extensions, maxFiles, results)
        continue
      }

      if (handle.kind === 'file') {
        if (extensions.length > 0 && !this.hasExtension(name, extensions)) {
          continue
        }

        results.push({ path: nextPath, handle : handle as FileSystemFileHandle })
      }
    }
  }

  private hasExtension = (name: string, extensions: readonly string[]): boolean => {
    const lower = name.toLowerCase()
    return extensions.some(ext => lower.endsWith(ext))
  }
}
