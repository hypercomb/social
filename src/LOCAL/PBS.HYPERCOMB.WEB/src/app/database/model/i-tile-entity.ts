// i-cell-entity.ts

import { CellKind } from "src/app/cells/cell"
import { CellOptions } from "src/app/core/models/enumerations"

export interface CellEntity {

    // ──────────────────────────────────────────────
    // new unified image identity
    // ──────────────────────────────────────────────
    /**
     * the canonical image identifier for this cell.
     * both small and large images in OPFS share this hash.
     * when blob is present (first-load / legacy), we compute a hash,
     * write the small image to OPFS, and assign imageHash.
     */
    imageHash?: string | undefined

    // ──────────────────────────────────────────────
    // existing fields (unchanged)
    // ──────────────────────────────────────────────
    kind: CellKind | undefined
    cellId: number
    isBranch: boolean | undefined
    isLocked: boolean | undefined
    hashedHive?: number
    hive: string
    name: string
    options: CellOptions
    dateCreated: string
    isActive: boolean
    isDeleted: boolean
    isHidden?: boolean
    ignoreBackground?: boolean
    borderColor: string
    backgroundColor: string
    link: string
    index: number
    scale: number
    x: number
    y: number
    sourceId?: number
    sourcePath: string
    uniqueId: string
    etag?: string
    updatedAt: string

    // legacy persistence blob (first-load only)
    /** @deprecated used only during import; removed afterwards */
    blob?: Blob

    dateDeleted?: string
}

// HiveEntity is unchanged — it just inherits CellEntity
export interface HiveEntity extends CellEntity {}
