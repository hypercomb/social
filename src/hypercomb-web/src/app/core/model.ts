// src/app/core/model.ts
export interface Lineage {
  readonly path: string
  readonly segments: readonly string[]
}

export interface FileEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemHandle
}

export type InitState =
  | 'locked'      // nothing allowed yet
  | 'armed'       // '#' pressed, waiting for Enter
  | 'unlocked'    // normal behavior forever
  