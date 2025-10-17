import { inject } from "@angular/core"
import { Table } from "dexie"
import { IdentifierService } from "../utility/identifier-service"
import { CellEntity } from "../model/i-tile-entity"
import DBTables from "src/app/core/constants/db-tables"
import { DatabaseService } from "../database-service"
import { CellOptions } from "src/app/cells/models/cell-options"
import { safeDate } from "src/app/core/mappers/to-cell"
import { IRepostioryBase, QUERY_HELPER } from "src/app/shared/tokens/i-cell-repository.token"
import { IHiveImage } from "src/app/core/models/i-hive-image"
import { ImageDatabase } from "../images/image-database"
import { CELL_FACTORY } from "src/app/inversion-of-control/tokens/tile-factory.token"
import { isNew } from "src/app/cells/models/cell-filters"

export abstract class RepositoryBase<TEntity extends CellEntity, TDomain = TEntity>
  implements IRepostioryBase<TEntity> {
  protected readonly factory = inject(CELL_FACTORY)
  protected readonly database = inject(DatabaseService)
  protected readonly idService = inject(IdentifierService)
  protected readonly query = inject(QUERY_HELPER)
  protected readonly imageDb = inject(ImageDatabase)

  protected get cell_db(): Table<TEntity, number> {
    const db = this.database.db()
    if (!db) throw new Error("❌ database not initialized")
    return db.table(DBTables.Cells)
  }

  // ghost guard
  protected isGhost(entity: any): boolean {
    return entity?.kind === "Ghost"
  }

  // default: no image relation (subclasses can override)
  protected async findImage(entity: TEntity): Promise<IHiveImage | null> {
    return null
  }

  // ────────────────────────────────
  // queries
  // ────────────────────────────────    
  public fetch = async (cellId: number): Promise<TEntity | undefined> => {
    const row = await this.query.findFirst<TEntity>({
      where: { cellId },
      all: [CellOptions.Active],
      none: [CellOptions.Deleted],
    })
    return row
  }

  public async fetchBySourceId(cellId: number): Promise<CellEntity[]> {
    return this.cell_db.where({ sourceId: cellId }).toArray();
  }


  public fetchAll = async (): Promise<TEntity[]> => {
    const result = await this.query.get<TEntity>({
      all: [CellOptions.Active],
      none: [CellOptions.Deleted],
    })
    return result
  }

  // ────────────────────────────────
  // save convenience
  // ────────────────────────────────
  public async save(entity: TEntity, image:IHiveImage): Promise<TEntity> {
    if (this.isGhost(entity)) {
      // Ghosts never persisted, just return it
      return entity
    }

    if (!entity.cellId) {
      return this.add(entity,image)
    } else {
      await this.update(entity)
      return entity
    }
  }

  // ────────────────────────────────
  // persistence
  // ────────────────────────────────
  public async add(entity: TEntity, image: IHiveImage): Promise<TEntity> {
    if (this.isGhost(entity)) return entity

    entity.dateCreated = safeDate(new Date()) || ''

    await this.cell_db.add(entity)
    this.idService.markAsUsed(entity.cellId)

    // ensure a small image record exists
    await this.ensureImageRecord(entity, image)

    return entity
  }

  private ensureImageRecord = async (entity: TEntity, image: IHiveImage): Promise<void> => {

    // detect whether update or insert is needed
    let isNewImage =  false
    if (image.id != null) {
      const existing = await this.imageDb.get(image.id)
      isNewImage = !existing || existing.blob.size !== image.blob.size
    } else {
      isNewImage = true
    }

    // save the image if new or changed
    await this.imageDb.put(image)

    // we have an id now
    entity.smallImageId = image.id!
    await this.save(entity,image)
  }

  public async update(entity: TEntity): Promise<number> {
    if (this.isGhost(entity)) return 0
    entity.updatedAt = new Date().toISOString()
    return this.cell_db.put(entity)
  }

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

  public async deleteAll(ids: number[], permanent = false): Promise<void> {
    if (!this.cell_db || !ids.length) return

    if (permanent) {
      await this.cell_db.bulkDelete(ids)
      this.idService.bulkReleaseIds(ids)
    } else {
      const entities = await this.cell_db.bulkGet(ids)
      const nowUtc = new Date().toISOString()
      const updated = entities
        .filter((e): e is TEntity => !!e && !this.isGhost(e))
        .map(e => ({
          ...e,
          options: (e.options ?? 0) | CellOptions.Deleted,
          dateDeleted: nowUtc,
        }))

      if (updated.length) {
        await this.cell_db.bulkPut(updated)
      }
    }
  }

  public async bulkAdd(entities: TEntity[], markIds = true): Promise<void> {
    const filtered = entities.filter(e => !this.isGhost(e))
    if (!filtered.length) return

    const nowUtc = safeDate(new Date())!
    filtered.forEach(e => {
      e.dateCreated ??= nowUtc
      e.updatedAt = nowUtc
    })

    await this.cell_db.bulkAdd(filtered)

    if (markIds) {
      const persisted = await this.cell_db
        .orderBy("TileId")
        .reverse()
        .limit(filtered.length)
        .toArray()

      const ids = persisted.map(r => r.cellId).filter((id): id is number => id != null)
      this.idService.bulkMarkAsUsed(ids)
    }
  }

  public async bulkPut(entities: TEntity[]): Promise<void> {
    const filtered = entities.filter(e => !this.isGhost(e))
    if (!filtered.length) return

    const now = new Date().toISOString()
    filtered.forEach(e => e.updatedAt = now)

    await this.cell_db.bulkPut(filtered)

    const ids = filtered.map(e => e.cellId).filter((id): id is number => id != null)
    if (ids.length) this.idService.bulkMarkAsUsed(ids)
  }

  public async bulkDelete(ids: number[]): Promise<void> {
    if (!ids.length) return
    await this.cell_db.bulkDelete(ids)
    this.idService.bulkReleaseIds(ids)
  }

  public async bulkDeletePermanent(entities: TEntity[]): Promise<void> {
    const ids = entities
      .filter(e => !this.isGhost(e))
      .map(e => e.cellId)
      .filter((id): id is number => id != null)

    if (!ids.length) return
    await this.cell_db.bulkDelete(ids)
    this.idService.bulkReleaseIds(ids)
  }
}
