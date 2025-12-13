// src/app/hive/storage/resolve-cell.ts
import { Cell } from "src/app/models/cell"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { HashService } from "src/app/hive/storage/hashing-service"
import { Injectable } from "@angular/core"

@Injectable({ providedIn: "root" })
export class CellResolver {

  constructor(private opfs: OpfsManager) {}

  // resolve a cell from OPFS (canonical source of truth)
  public async resolve(gene: string, hive: string): Promise<Cell> {

    const dir = await this.opfs.ensureDirs(["hives", hive, gene])

    const get = async (key: string): Promise<string> => {
      const hash = await HashService.hash(key)
      const fh = await this.opfs.getFile(dir, hash)
      if (!fh) return ""
      return (await fh.getFile()).text()
    }

    const cell = new Cell({
      gene,
      name:        await get("name"),
      link:        await get("link"),
      parentGene:  await get("parent"),
      index:       Number(await get("index")) || 0,
      childCount:  Number(await get("childCount")) || undefined,
      backgroundColor: await get("backgroundColor"),
      borderColor:     await get("borderColor"),
      imageHash:       await get("imageHash"),

      x: Number(await get("x")) || 0,
      y: Number(await get("y")) || 0,
      scale: Number(await get("scale")) || 1
    })

    return cell
  }
}
