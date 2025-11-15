// src/app/database/repository/repository.base.ts
import { inject } from "@angular/core"
import { Table } from "dexie"
import { IdentifierService } from "../utility/identifier-service"
import { CellEntity } from "../model/i-tile-entity"
import DBTables from "src/app/core/constants/db-tables"
import { DatabaseService } from "../database-service"
import { CellOptions } from "src/app/cells/models/cell-options"
import { safeDate } from "src/app/core/mappers/to-cell"
import { IRepostioryBase, QUERY_HELPER } from "src/app/shared/tokens/i-cell-repository.token"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { OpfsImageService } from "src/app/hive/storage/opfs-image.service"

export abstract class RepositoryBase<TEntity extends CellEntity, TDomain = TEntity>
  implements IRepostioryBase<TEntity> {

  protected readonly factory = inject(CELL_FACTORY)
  protected readonly database = inject(DatabaseService)
  protected readonly idService = inject(IdentifierService)
  protected readonly query = inject(QUERY_HELPER)
  protected readonly images = inject(OpfsImageService)

  protected get cell_db(): Table<TEntity, number> {
    const db = this.database.db()
    if (!db) throw new Error("❌ database not initialized")
    return db.table(DBTables.Cells)
  }

  protected isGhost(entity: any) {
    return entity?.kind === "Ghost"
  }

  // fetch
  public fetch = async (cellId: number) => {
    return await this.query.findFirst<TEntity>({
      where: { cellId },
      all: [CellOptions.Active],
      none: [CellOptions.Deleted]
    })
  }

  public async fetchBySourceId(cellId: number) {
    return this.cell_db.where({ sourceId: cellId }).toArray()
  }

  public fetchAll = async () => {
    return await this.query.get<TEntity>({
      all: [CellOptions.Active],
      none: [CellOptions.Deleted]
    })
  }

  // save
  public async save(entity: TEntity, imageBlob?: Blob) {
    if (this.isGhost(entity)) return entity

    if (!entity.cellId) {
      return await this.add(entity, imageBlob)
    } else {
      await this.update(entity, imageBlob)
      return entity
    }
  }

  // insert
  // src/app/database/repository/repository.base.ts
  // only the changed parts are shown — rest of file unchanged

  public async add(entity: TEntity, imageBlob?: Blob) {
    if (this.isGhost(entity)) return entity

    entity.dateCreated = safeDate(new Date()) || ''

    // first-time image save
    if (imageBlob instanceof Blob) {
      const hash = await this.images.hashName(imageBlob)
      await this.images.saveSmall(hash, imageBlob)

      // ✔ modern field
      entity.imageHash = hash

      // ✔ DO NOT assign deprecated numeric field
      // entity.smallImageId = hash   ← REMOVE THIS
    }

    await this.cell_db.add(entity)
    this.idService.markAsUsed(entity.cellId)

    return entity
  }

  // update
  public async update(entity: TEntity, imageBlob?: Blob) {
    if (this.isGhost(entity)) return 0

    entity.updatedAt = new Date().toISOString()

    if (imageBlob instanceof Blob) {
      const hash = await this.images.hashName(imageBlob)
      await this.images.saveSmall(hash, imageBlob)

      // ✔ modern field
      entity.imageHash = hash

      // ✔ do not touch deprecated numeric field
      // entity.smallImageId = hash   ← REMOVE THIS
    }

    return await this.cell_db.put(entity)
  }


  // delete
  public async delete(entity: TEntity, permanent = false) {
    if (this.isGhost(entity)) return
    if (!this.cell_db) return

    if (permanent && entity.cellId) {
      await this.cell_db.delete(entity.cellId)
      this.idService.releaseId(entity.cellId)
    } else {
      entity.options = (entity.options | CellOptions.Deleted)
      entity.dateDeleted = safeDate(new Date())
      await this.update(entity)
    }
  }

  // bulk ops
  public async bulkAdd(entities: TEntity[], markIds = true) {
    const filtered = entities.filter(e => !this.isGhost(e))
    if (!filtered.length) return

    const now = safeDate(new Date())!
    filtered.forEach(e => {
      e.dateCreated ??= now
      e.updatedAt = now
    })

    await this.cell_db.bulkAdd(filtered)

    if (markIds) {
      const persisted = await this.cell_db
        .orderBy("TileId")
        .reverse()
        .limit(filtered.length)
        .toArray()

      const ids = persisted
        .map(r => r.cellId)
        .filter((id): id is number => id != null)

      this.idService.bulkMarkAsUsed(ids)
    }
  }

  public async bulkPut(entities: TEntity[]) {
    const filtered = entities.filter(e => !this.isGhost(e))
    if (!filtered.length) return

    const now = new Date().toISOString()
    filtered.forEach(e => e.updatedAt = now)

    await this.cell_db.bulkPut(filtered)

    const ids = filtered
      .map(e => e.cellId)
      .filter((id): id is number => id != null)

    if (ids.length) this.idService.bulkMarkAsUsed(ids)
  }

  public async bulkDelete(ids: number[]) {
    if (!ids.length) return
    await this.cell_db.bulkDelete(ids)
    this.idService.bulkReleaseIds(ids)
  }

  public async bulkDeletePermanent(entities: TEntity[]) {
    const ids = entities
      .filter(e => !this.isGhost(e))
      .map(e => e.cellId)
      .filter((id): id is number => id != null)

    if (!ids.length) return
    await this.cell_db.bulkDelete(ids)
    this.idService.bulkReleaseIds(ids)
  }
}
