// substrate.types.ts
//
// Shared types for the substrate system. A substrate is a collection of
// images used as default backgrounds for blank cells. Sources are the
// unified abstraction — layer packages, hives, linked local folders, and
// remote URL bundles all resolve to the same pool of image signatures.

/** A layer package in OPFS `__layers__/`, addressed by its layer signature. */
export interface SubstrateLayerSource {
  readonly type: 'layer'
  readonly id: string          // sha256 of discriminated content; stable registry key
  readonly signature: string   // layer signature
  readonly label: string
  readonly builtin?: boolean
}

/** A hive (directory path) within the `hypercomb.io/` user content tree. */
export interface SubstrateHiveSource {
  readonly type: 'hive'
  readonly id: string
  readonly path: string        // slash-joined path under hypercomb.io/
  readonly label: string
  readonly builtin?: boolean
}

/**
 * A live link to a local filesystem directory via the File System Access API.
 * The handle itself is persisted in IndexedDB under `handleId`; this record
 * holds only the pointer + display metadata.
 */
export interface SubstrateFolderSource {
  readonly type: 'folder'
  readonly id: string
  readonly handleId: string    // IDB key into the substrate-handles store
  readonly label: string
  readonly builtin?: boolean
}

/**
 * A remote bundle served from a baseUrl. The baseUrl must host a
 * `manifest.json` of shape `{ "images": string[] }`. Bundled app defaults
 * use this type with `builtin: true`.
 */
export interface SubstrateUrlSource {
  readonly type: 'url'
  readonly id: string
  readonly baseUrl: string     // trailing slash, e.g. "substrate/"
  readonly label: string
  readonly builtin?: boolean
}

export type SubstrateSource =
  | SubstrateLayerSource
  | SubstrateHiveSource
  | SubstrateFolderSource
  | SubstrateUrlSource

/** Registry persisted in root OPFS `0000` under `substrate-registry`. */
export interface SubstrateRegistry {
  readonly sources: readonly SubstrateSource[]
  readonly activeId: string | null
}

export const EMPTY_SUBSTRATE_REGISTRY: SubstrateRegistry = { sources: [], activeId: null }
