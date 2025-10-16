// tile-cell.ts (only the relevant bits)

import { Cell } from "src/app/cells/cell"


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

  addTagsToTile(cellId: number, names: string[])
  removeTagFromTile(cellId: number, name: string)
  setTagsOnTile(cellId: number, names: string[])

  findTilesByAny(names: string[]): Promise<Cell[]>
  findTilesByAll(names: string[]): Promise<Cell[]>
  getTileTagNames(cellId: number): Promise<string[]>

  countByTag(name: string): Promise<number>
}


