// tag-database
// rules applied:
// - all timestamps normalized to utc iso strings
// - arrow-style methods
// - inline comments explain each step
// - keeps slugify() helper for safe, predictable identifiers

import Dexie from "dexie"
import { ITagManager, ITag } from "src/app/core/models/model-interfaces"
import { slugify } from "src/app/core/models/tag"
import { Cell } from "src/app/cells/cell"
import { Constants } from "src/app/helper/constants"
import DBTables from "src/app/core/constants/db-tables"

export class TagDatabase implements ITagManager {
  constructor(private db: Dexie) { }
  removeTagFromTile(cellId: number, name: string) {
    throw new Error("Method not implemented.")
  }
  setTagsOnTile(cellId: number, names: string[]) {
    throw new Error("Method not implemented.")
  }
  findTilesByAny(names: string[]): Promise<Cell[]> {
    throw new Error("Method not implemented.")
  }
  findTilesByAll(names: string[]): Promise<Cell[]> {
    throw new Error("Method not implemented.")
  }
  getTileTagNames(cellId: number): Promise<string[]> {
    throw new Error("Method not implemented.")
  }
  countByTag(name: string): Promise<number> {
    throw new Error("Method not implemented.")
  }

  // ---------------------------------------------------------------------------
  // tag CRUD
  // ---------------------------------------------------------------------------

  /** create a tag (or return existing id if slug already exists) */
  public create = async (name: string): Promise<number> => {
    const slug = slugify(name)
    const existing = (await this.db.table(DBTables.Cells).get({ slug })) as ITag | undefined
    if (existing?.id) return existing.id

    const nowUtc = Date.now()
    const id = await this.db.table(DBTables.Cells).add({
      slug,
      name,
      DateCreated: nowUtc,
      UpdatedAt: nowUtc,
    } as ITag)

    if (typeof id !== 'number') throw new Error('tag id is not a number')
    return id
  }

  /** fetch one tag by slug */
  public getBySlug = async (slug: string): Promise<ITag | undefined> =>
    (await this.db.table(DBTables.Cells).get({ slug: slugify(slug) })) as ITag | undefined

  /** list all tags sorted by slug */
  public list = async (): Promise<ITag[]> =>
    (await this.db.table(DBTables.Cells).orderBy('slug').toArray()) as ITag[]

  /** rename a tag */
  public rename = async (tagId: number, newName: string) => {
    const nowUtc = new Date().toISOString()
    await this.db.table(DBTables.Cells).update(tagId, {
      name: newName,
      UpdatedAt: nowUtc,
    })
  }

  /** update a tag's slug (checks for conflicts) */
  public changeSlug = async (tagId: number, newSlug: string) => {
    const slug = slugify(newSlug)
    const exists = (await this.db.table(DBTables.Cells).get({ slug })) as ITag | undefined
    if (exists && exists.id !== tagId) throw new Error('slug already exists')
    const nowUtc = new Date().toISOString()
    await this.db.table(DBTables.Cells).update(tagId, { slug, UpdatedAt: nowUtc })
  }

  /** delete a tag and remove it from all tiles */
  public delete = async (tagId: number) => {
    const tileTable = this.db.table(DBTables.Cells)

    // find tiles that reference this tag
    const tiles = (await tileTable.where('TagIds').equals(tagId).primaryKeys()) as number[]
    if (tiles.length) {
      await this.db.transaction('rw', tileTable, async () => {
        for (const pk of tiles) {
          await tileTable.update(pk, (t: any) => ({
            TagIds: (t?.TagIds ?? []).filter((x: number) => x !== tagId),
          }) as any)
        }
      })
    }

    // remove the tag itself
    await this.db.table(Constants.TagsDataTable).delete(tagId)
  }

  // ---------------------------------------------------------------------------
  // assign tags to tiles
  // ---------------------------------------------------------------------------

  /** add one or more tags to a tile (creates tags if missing) */
  public addTagsToTile = async cellId: number, names: string[]) => {
    const ids = Array.from(new Set(await Promise.all(names.map((n) => this.create(n)))))
    await this.db.table(Constants.TileDataTable).updatecellId (t: any) => {
      const next = new Set([...(t?.TagIds ?? []), ...ids])
      return { TagIds: Array.from(next) } as any
    })
  }

  /** remove a tag (by name) from a tile */
  public removeTagFromTile = async cellId: number, name: string) => {
    const tag = await this.getBySlug(name)
    if (!tag?.id) return
    await this.db.table(Constants.TileDataTable).updatecellId (t: any) => ({
      TagIds: (t?.TagIds ?? []).filter((x: number) => x !== tag.id),
    }) as any)
  }

  /** overwrite all tags on a tile */
  public setTagsOnTile = async cellId: number, names: string[]) => {
    const ids = Array.from(new Set(await Promise.all(names.map((n) => this.create(n)))))
    await this.db.table(Constants.TileDataTable).updatecellId { TagIds: ids })
  }

  // ---------------------------------------------------------------------------
  // queries
  // ---------------------------------------------------------------------------

  /** find tiles that have *any* of the given tags */
  public findTilesByAny = async (names: string[]): Promise<Cell[]> => {
    const ids = Array.from(new Set(await Promise.all(names.map((n) => this.create(n)))))
    return (await this.db
      .table(Constants.TileDataTable)
      .where('TagIds')
      .anyOf(ids)
      .distinct()
      .toArray()) as Cell[]
  }

  /** find tiles that have *all* of the given tags */
  public findTilesByAll = async (names: string[]): Promise<Cell[]> => {
    const ids = Array.from(new Set(await Promise.all(names.map((n) => this.create(n)))))
    if (!ids.length) return []

    // get primary keys for each tag
    const keySets = await Promise.all(
      ids.map((id) => this.db.table(Constants.TileDataTable).where('TagIds').equals(id).primaryKeys() as Promise<number[]>)
    )

    // start with smallest set for efficiency
    keySets.sort((a, b) => a.length - b.length)
    let acc = keySets.shift() ?? []

    for (const ks of keySets) {
      acc.sort((x, y) => x - y)
      ks.sort((x, y) => x - y)

      const out: number[] = []
      let i = 0,
        j = 0
      while (i < acc.length && j < ks.length) {
        const a = acc[i], b = ks[j]
        if (a === b) {
          out.push(a)
          i++
          j++
        } else if (a < b) {
          i++
        } else {
          j++
        }
      }
      acc = out
      if (!acc.length) break
    }

    return acc.length ? ((await this.db.table(Constants.TileDataTable).bulkGet(acc)) as Cell[]) : []
  }

  /** get tag names assigned to a tile */
  public getTileTagNames = async cellId: number): Promise<string[]> => {
    const t = (await this.db.table(Constants.TileDataTable).getcellId) as Cell | undefined
    if (!t?.tagIds?.length) return []
    const rows = (await this.db.table(Constants.TagsDataTable).bulkGet(t.tagIds)) as (ITag | undefined)[]
    return rows.filter(Boolean).map((x) => x!.name)
  }

  /** count how many tiles use a tag (by name) */
  public countByTag = async (name: string): Promise<number> => {
    const tag = await this.getBySlug(name)
    if (!tag?.id) return 0
    return this.db.table(Constants.TileDataTable).where('TagIds').equals(tag.id).count()
  }
}
