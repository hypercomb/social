// src/app/core/directory-walker.service.ts

import { Injectable } from '@angular/core'

export interface WalkedDirectory {
  handle: FileSystemDirectoryHandle
  path: readonly string[]
  depth: number
}

@Injectable({ providedIn: 'root' })
export class DirectoryWalkerService {

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  // walks directories breadth-first up to maxDepth
  // yields directory handles only (no semantics, no mutation)
  public walk = async (
    root: FileSystemDirectoryHandle,
    maxDepth: number
  ): Promise<readonly WalkedDirectory[]> => {

    const out: WalkedDirectory[] = []

    // queue entries are tuples of (handle, path, depth)
    const queue: Array<{
      handle: FileSystemDirectoryHandle
      path: string[]
      depth: number
    }> = [{
      handle: root,
      path: [],
      depth: 0
    }]

    while (queue.length) {
      const current = queue.shift()!
      out.push({
        handle: current.handle,
        path: current.path,
        depth: current.depth
      })

      // stop descending if depth limit reached
      if (current.depth >= maxDepth) continue

      for await (const [name, entry] of current.handle.entries()) {
        if (entry.kind !== 'directory') continue

        queue.push({
          handle: entry as FileSystemDirectoryHandle,
          path: [...current.path, name],
          depth: current.depth + 1
        })
      }
    }

    return out
  }
}
