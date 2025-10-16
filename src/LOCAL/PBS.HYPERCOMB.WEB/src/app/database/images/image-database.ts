import { Injectable } from '@angular/core'
import Dexie, { Table, IndexableType } from 'dexie'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { Constants } from 'src/app/unsorted/constants'

@Injectable({ providedIn: 'root' })
export class ImageDatabase {
  private db!: Dexie
  private tables!: Record<'small' | 'large', Table<IHiveImage, IndexableType>>

  // ─────────────────────────────────────────────
  // init schema
  // ─────────────────────────────────────────────
  public async initialize(): Promise<void> {
    this.db = new Dexie(Constants.ImageDatabaseIdentifier)
    this.db.version(3).stores({
      small: '++id,&cellId',
      large: '++id,&cellId',
    })
    await this.db.open()

    this.tables = {
      small: this.db.table<IHiveImage>('small'),
      large: this.db.table<IHiveImage>('large'),
    }
  }

  // ─────────────────────────────────────────────
  // add / update image
  // ─────────────────────────────────────────────
  public async put(image: IHiveImage, kind: 'small' | 'large' = 'small'): Promise<IndexableType> {
    return this.tables[kind].put(image)
  }

  // ─────────────────────────────────────────────
  // get by id
  // ─────────────────────────────────────────────
  public async get(id: IndexableType, kind: 'small' | 'large' = 'small'): Promise<IHiveImage | undefined> {
    return this.tables[kind].get(id)
  }

  // ─────────────────────────────────────────────
  // get by cellId
  // ─────────────────────────────────────────────
  public async getByCellId(cellId: number, kind: 'small' | 'large' = 'small'): Promise<IHiveImage | undefined> {
    return this.tables[kind].where({ cellId }).first()
  }

  // ─────────────────────────────────────────────
  // remove by id
  // ─────────────────────────────────────────────
  public async remove(id: IndexableType, kind: 'small' | 'large' = 'small'): Promise<void> {
    await this.tables[kind].delete(id)
  }

  // expose Dexie instance if needed
  public getDb(): Dexie {
    return this.db
  }
}
