// src/app/core/model/lineage.ts

export interface Lineage {
  readonly path: string
  readonly segments: readonly string[]
}

export interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
}
    