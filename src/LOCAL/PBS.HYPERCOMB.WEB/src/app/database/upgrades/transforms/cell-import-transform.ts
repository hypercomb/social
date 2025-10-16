// cell-import-transform.ts
import { inject, Injectable } from '@angular/core'
import { IPropertyMapper, TilePropertyMapper } from '../tile-property-mapper'
import { Cell } from 'src/app/cells/cell'
import DBTables from 'src/app/core/constants/db-tables'
import { IImportTransform } from './i-import-transform'
import { CellOptions } from 'src/app/core/models/enumerations'
import { simplify } from 'src/app/shared/services/name-simplifier'
import { uuidv4 } from 'src/app/core/models/uuid'

@Injectable({ providedIn: 'root' })
export class CellImportTransform implements IImportTransform {

  private uniqueIds = new Set<string>()

  constructor(private tilePropertyMapper: TilePropertyMapper) { }

  supports(table: string): boolean {
    return table === DBTables.Cells
  }

  private readonly propertyResolvers: IPropertyMapper<Cell>[] = [
    { sourceProperty: 'TileId', targetProperty: 'cellId' },
    { sourceProperty: 'Hive', targetProperty: 'hive' },
    { sourceProperty: 'SourceId', targetProperty: 'sourceId' },
    { sourceProperty: 'UniqueId', targetProperty: 'uniqueId' },
    { sourceProperty: 'DateCreated', targetProperty: 'dateCreated' },
    { sourceProperty: 'DateDeleted', targetProperty: 'dateDeleted' },
    { sourceProperty: 'BackgroundColor', targetProperty: 'backgroundColor' },
    { sourceProperty: 'BorderColor', targetProperty: 'borderColor' },
    { sourceProperty: 'Link', targetProperty: 'link' },
    { sourceProperty: 'Caption', targetProperty: 'name' },
    { sourceProperty: 'OffsetX', targetProperty: 'x' },
    { sourceProperty: 'OffsetY', targetProperty: 'y' },
    { sourceProperty: 'Scale', targetProperty: 'scale' },
    { sourceProperty: 'SourcePath', targetProperty: 'sourcePath' },
    { sourceProperty: 'Index', targetProperty: 'index' },
    { sourceProperty: 'Blob', targetProperty: 'blob' },

  ]

  transform(table: string, value: any, key?: any) {

    if (table === DBTables.Cells) {
      const normalized: any = { ...value }
      try {

        // apply property mapping
        for (const resolver of this.propertyResolvers) {
          if (resolver.sourceProperty in value) {
            normalized[resolver.targetProperty] = value[resolver.sourceProperty]
            delete normalized[resolver.sourceProperty]
          }
        }

        // 🟢 revive blob if present
        if (normalized.blob) {
          normalized.blob = this.reviveBlob(normalized.blob)
        }
        // ensure defaults
        normalized.options = normalized.options ?? 0

        // normalize booleans → options
        normalized.options |= CellOptions.Active
        if (value.IsDeleted) normalized.options |= CellOptions.Deleted
        if (value.IsHidden) normalized.options |= CellOptions.Hidden
        if (value.IsBranch) normalized.options |= CellOptions.Branch
        if (value.IsInitialized) normalized.options |= CellOptions.InitialTile
        if (value.Recenter) normalized.options |= CellOptions.Recenter

        // also make isDeleted explicit
        normalized.isDeleted = !!value.IsDeleted
        normalized.isActive = true
        normalized.isHidden = !!value.IsHidden
        normalized.isBranch = !!value.IsBranch
        normalized.isInitialized = !!value.IsInitialized
        normalized.recenter = !!value.Recenter

        normalized.name = simplify(normalized.name)

        // normalize dates
        if (normalized.dateCreated) {
          normalized.dateCreated = new Date(normalized.dateCreated).toISOString()
        }
        if (normalized.dateDeleted) {
          normalized.dateDeleted = new Date(normalized.dateDeleted).toISOString()
        }
        if (normalized.updatedAt) {
          normalized.updatedAt = new Date(normalized.updatedAt).toISOString()
        }

        // handle root → Hive
        normalized.kind = !!value.kind ? value.kind : value.IsRoot === true ? 'Hive' : 'Cell'

        if (!!value.uniqueId) {
          normalized.uniqueId = uuidv4()
        }
        if (this.uniqueIds.has(normalized.uniqueId)) {
          normalized.uniqueId = uuidv4()
        }

        this.uniqueIds.add(normalized.uniqueId)

        // drop legacy fields
        delete normalized.IsRoot
        delete normalized.IsStub
        delete normalized.SpriteX
        delete normalized.SpriteY
        delete normalized.Caption
        delete normalized.PreviousIndex
        delete normalized.ImageWidth
        delete normalized.ImageHeight
        delete normalized.BlobHash
        delete normalized.$types
        delete normalized.WindowWidth
        delete normalized.WindowHeight
        delete normalized.X
        delete normalized.Y
        delete normalized.IsDeleted
        delete normalized.IsHidden
        delete normalized.IsBranch
        delete normalized.IsInitialized
        delete normalized.Recenter
        delete normalized.IsActive
        delete normalized.Flag
        delete (<any>normalized).ignoreBackground
        delete (<any>normalized).isIgnoreBackground
        delete (<any>normalized).isInitialTile
        delete (<any>normalized).isInitialized
        delete (<any>normalized).isIgnoreBackground
        delete (<any>normalized).hasNoImage
        delete (<any>normalized).isNoImage
        delete (<any>normalized).type
        delete (<any>normalized).tagIds

      } catch (e) {
        console.error("Failed to ensure uniqueId on cell during upgrade")
      }
      return { value: normalized, key }
    }
    return { value, key }
  }

  private reviveBlob(blobLike: any): Blob | null {
    if (!blobLike) return null

    // already a real Blob
    if (blobLike instanceof Blob) return blobLike

    // encoded form: { type: string, data: base64 }
    if (typeof blobLike?.data === "string" && typeof blobLike?.type === "string") {
      try {
        const binary = atob(blobLike.data)
        const array = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          array[i] = binary.charCodeAt(i)
        }
        return new Blob([array], { type: blobLike.type })
      } catch {
        return null
      }
    }

    return null
  }

}
