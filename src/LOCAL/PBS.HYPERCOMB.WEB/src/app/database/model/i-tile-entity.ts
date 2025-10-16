// i-cell-entity.ts

import { CellKind } from "src/app/cells/cell"
import { CellOptions } from "src/app/core/models/enumerations"

export interface CellEntity {
    largeImageId: number | undefined
    smallImageId: number
    kind: CellKind | undefined
    cellId: number
    isBranch: boolean | undefined
    isLocked: boolean | undefined
    hasNoImage: boolean | undefined
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
    // blobs are optional persistence fields
    blob?: Blob
    dateDeleted?: string
}


export interface HiveEntity extends CellEntity {

}