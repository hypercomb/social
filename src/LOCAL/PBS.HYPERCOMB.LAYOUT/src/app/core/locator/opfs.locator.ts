// src/app/core/locator/opfs.locator.ts

import { Locator } from './locator'

export class OpfsLocator implements Locator<FileSystemHandle> {

  public async resolve(path: string): Promise<FileSystemHandle | null> {
    try {
      const root = await navigator.storage.getDirectory()

      // support nested paths: a/b/c.txt
      const parts = path.split('/').filter(Boolean)
      let current: FileSystemDirectoryHandle = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isLast = i === parts.length - 1

        if (isLast) {
          // try file first, then directory
          try {
            return await current.getFileHandle(part)
          } catch {
            return await current.getDirectoryHandle(part)
          }
        }

        current = await current.getDirectoryHandle(part)
      }

      return null
    } catch {
      return null
    }
  }
}
