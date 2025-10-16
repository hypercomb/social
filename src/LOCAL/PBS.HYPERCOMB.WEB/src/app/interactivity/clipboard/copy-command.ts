// copy.action.ts
import { inject } from "@angular/core"
import { ClipboardService } from "src/app/clipboard/clipboard-service"
import { CellFactory } from "src/app/inversion-of-control/factory/cell-factory"
import { ImageDatabase } from "src/app/database/images/image-database"
import { HypercombMode } from "src/app/core/models/enumerations"
import { Cell } from "src/app/cells/cell"
import { COMB_STORE } from "src/app/shared/tokens/i-comb-store.token"
import { EditorService } from "src/app/state/interactivity/editor-service"
import { Action } from "rxjs/internal/scheduler/Action"

export const copyAction: Action<Cell> = {
  id: "tile.copy",
  label: "Copy Tile",
  description: "Copy active tile into the clipboard hive",
  risk: "none",

  enabled: async (cell) => {
    const es = inject(EditorService)
    const {editor} = es // or EditorService if needed
    return !!cell && (es.mode() & HypercombMode.Copy) !== 0
  },

  run: async (cell:Cell) => {
    if (!cell) return 

    const clipboard = inject(ClipboardService)
    const factory = inject(CellFactory)
    const imageDb = inject(ImageDatabase)
    const store = inject(COMB_STORE)

    const copyMap = new Map<number, Cell>()
    // const rootCopy = await doCopy(ctx.cell, Constants.ClipboardHive, ctx.cell.sourceId ?? 0, {
    //   factory,
    //   imageDb,
    //   store,
    //   copyMap,
    // })

    // if (rootCopy) {
    // //   clipboard.set(rootCopy)
    //   return true
    // }
    return
  },
}

// helper: recursive copy
const doCopy = async (
  data: Cell,
  newHive: string,
  sourceId: number,
  deps: {
    factory: CellFactory
    imageDb: ImageDatabase
    store: typeof COMB_STORE
    copyMap: Map<number, Cell>
  }
): Promise<Cell | undefined> => {
    throw new Error("Not implemented")
//   if (!data.cellId) return undefined
//   if (deps.copyMap.has(data.cellId)) return deps.copyMap.get(data.cellId)

//   const clone: Partial<Cell> = {
//     ...data,
//     cellId: undefined,
//     hive: newHive,
//     sourceId,
//     isInitialized: true,
//     options: (data.options | CellOptions.Active) & ~CellOptions.Deleted,
//     previousIndex: data.index,
//   }

//   const newCell = await deps.factory.create(clone)
//   deps.copyMap.set(data.cellId, newCell)

//   // copy image if present
//   const image = await deps.imageDb.get(data.hiveId)
//   if (image?.blob) {
//     const newImage = { ...image, hiveId: newCell.hiveId, imageId: undefined }
//     await deps.imageDb.store(newImage)
//   }

//   // persist via comb store
//   await deps.store.addCell(newCell)

//   // recurse into children
//   const children = await deps.store.fetchChildren(data.hive, data.cellId)
//   for (const child of children) {
//     await doCopy(child, newHive, newCell.cellId!, deps)
//   }

//   return newCell
}
