// src/app/inversion-of-control/factory/cell-factory.ts

import { inject, Injectable } from "@angular/core"
import { CellEntity } from "src/app/database/model/i-tile-entity"
import { ICreateCells } from "../tokens/tile-factory.token"
import { ParentContext } from "src/app/core/controller/context-stack"
import { Cell } from "src/app/models/cell"
import { toCellEntity } from "src/app/core/mappers/to-cell-entity"
import { HashService } from "src/app/hive/storage/hashing-service"
import { HivePortal } from "src/app/models/hive-portal"
import { CellResolver } from "src/app/core/mappers/to-cell"

@Injectable({ providedIn: "root" })
export class CellFactory implements ICreateCells {
  private readonly resolver = inject(CellResolver)
  private readonly stack = inject(ParentContext)

  // ───────────────────────────────────────────────
  // create: now uses `gene` instead of `gene`
  // ───────────────────────────────────────────────
  public async create(name: string,
    params: Partial<Cell>,
  ): Promise<Cell> {
    const gene = await HashService.hash(name)
    const parent = this.stack.gene()!
    this.resolver.resolve(gene, parent)
    const cell = new Cell({
      ...params,
      gene: params.gene
    })

    return cell
  }

  public createPortal = async (hiveName: string): Promise<HivePortal> => {
    const gene = await HashService.hash(hiveName)
    return new HivePortal(gene, hiveName)
  }
}
