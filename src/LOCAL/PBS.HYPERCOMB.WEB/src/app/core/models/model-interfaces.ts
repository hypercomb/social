// tile-cell.ts (only the relevant bits)

import { Cell } from "src/app/models/cell-kind"


export interface ITag {
  id?: number
  slug: string
  name: string
  DateCreated?: number
}


export interface ITagManager {
  create(name: string): Promise<number>
  getBySlug(slug: string): Promise<ITag | undefined>
  list(): Promise<ITag[]>
  rename(tagId: number, newName: string)
  changeSlug(tagId: number, newSlug: string)
  delete(tagId: number)

  addTagsToTile(gene: string, names: string[])
  removeTagFromTile(gene: string, name: string)
  setTagsOnTile(gene: string, names: string[])

  findTilesByAny(names: string[]): Promise<Cell[]>
  findTilesByAll(names: string[]): Promise<Cell[]>
  getTileTagNames(gene: string): Promise<string[]>

  countByTag(name: string): Promise<number>
}


