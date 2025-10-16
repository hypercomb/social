// import { hiveId } from 'src/app/tile/models/tile-filters';
// import { Injectable, inject, computed } from "@angular/core"
// import { DataServiceBase } from "src/app/database/data-service-base"
// import { HypercombMode, CellOptions } from "src/app/models/enumerations"
// import { Cell } from "src/app/models/tile-data"
// import { ClipboardState } from "src/app/clipboard/clipboard-state"
// import { CenterTileService } from "src/app/tile/behaviors/center-tile-service"
// import { NewTileService } from "src/app/tile/creation/new-tile-service"
// import { SelectionService } from "src/app/tile/selection/selection-service"
// import { SelectionState } from "src/app/tile/selection/selection-state"
// import { Constants } from "src/app/unsorted/constants"
// import { HoneycombService } from "src/app/unsorted/utility/honeycomb-service"
// import { LAYOUT_CONTROLLER } from "../../ports/layout-helper.port"
// import { PasteService } from "../paste-service"

// import { WithWorkspaceMixin } from "src/app/workspace/workspace.base"
// import { ClipboardRepository } from "src/app/clipboard/clipboard-database"

// @Injectable({ providedIn: 'root' })
// export class ClipboardService extends WithWorkspaceMixin(DataServiceBase) {
//   private readonly db = inject(ClipboardRepository)

//   // state + utilities
//   private readonly cbs = inject(ClipboardState)
//   private readonly ss = inject(SelectionState)
//   private readonly selection = inject(SelectionService)
//   private readonly center = inject(CenterTileService)
//   private readonly honeycomb = inject(HoneycombService)
//   private readonly newTiles = inject(NewTileService)
//   private readonly pasteService = inject(PasteService)

//   // layout refresh port (you referenced it previously)
//   private readonly refreshPort = inject(LAYOUT_CONTROLLER)

//   private clipboardTile?: Cell
//   public key = -1

//   public readonly viewingClipboard = computed(
//     () => (this.state.mode() & HypercombMode.ViewingClipboard) !== 0
//   )

//   // ---------------------------------------------------------
//   // lifecycle
//   // ---------------------------------------------------------
//   public async initialize() {
//     this.clipboardTile = await this.db.getClipboardTile()
//     this.key = this.clipboardTile?.cellId ?? 0

//     if (!this.key) {
//       const stored = await this.newTiles.createClipboardTile()
//       this.clipboardTile = await this.db.getClipboardTile()
//       this.key = stored.cellId!
//     }

//     const hierarchy = await this.query.tile_db.fetchHierarchy(Constants.ClipboardHive, this.key)
//     this.cbs.setItems(hierarchy)
//   }

//   // ---------------------------------------------------------
//   // clipboard ops
//   // ---------------------------------------------------------
//   public async copy(cell: Cell) {
//     // const newParent = await this.db.copyToClipboard(cell, this.key)
//     // this.cbs.addItem(newParent)
//     // await this.selection.clear()
//   }


//   public async cut(cell: Cell) {
//     // const updated = await this.cutToClipboard(cell, this.key)
//     // this.cbs.addItem(updated)
//   }

//   public async paste() {
//     const selections = this.ss.items() ?? []
//     if (selections.length === 0) return

//     // clear selection flags and release any caches (UI concerns)
//     for (const sel of selections) {
//       sel.options &= ~CellOptions.Selected
//     }

//     // build used index set for the paste target
//     const context = this.stack.current()
//     if (!context) return

//     const siblings = await this.query.hive_db.fetchByHiv~e(context.hive)
//     const used = new Set<number>(
//       siblings.filter(s => s.sourceId === context.cellId && s.index != null).map(s => s.index!)
//     )

//     // paste selections one-by-one with index coordination
//     for (const cell of selections) {
//       const nextFree = this.nextFreeIndex(used)
//       used.add(nextFree)
//       await this.pasteService.complete(cell, [nextFree])
//     }

//     this.state.resetMode()
//     this.refreshPort.refresh()
//   }

//   public async clear() {
//     if (!this.key) return
//     this.container.alpha = 0
//     await this.clearClipboard(this.key)
//     this.cbs.setItems([])
//     this.container.alpha = 1
//   }

//   // ---------------------------------------------------------
//   // helpers
//   // ---------------------------------------------------------
//   public async refresh() {
//     if (!this.key) return
//     const data = await this.query.tile_db.fetchHierarchy(Constants.ClipboardHive, this.key)
//     this.cbs.setItems(data)
//   }

//   public async setIndex(data: Cell) {
//     const list = await this.query.tile_db.fetchHierarchy(Constants.ClipboardHive, data.cellId!)
//     data.index = await this.honeycomb.findLowestIndex(list)
//   }

//   public async view() {
//     if (this.state.isViewingClipboard) {
//       this.state.resetMode()
//       this.container.alpha = 1
//       return
//     }

//     this.state.removeMode(HypercombMode.Copy)
//     this.state.removeMode(HypercombMode.Cut)
//     this.state.removeMode(HypercombMode.Select)

//     await this.prepareClipboardView()
//     this.state.setMode(HypercombMode.ViewingClipboard)
//     this.container.alpha = 0

//     this.refreshPort.refresh()
//   }

//   private async prepareClipboardView() {
//     // push the clipboard root onto the tile stack and center it
//     const root = await this.db.getClipboardTile()
//     if (root) this.cs.push(root)

//     requestAnimationFrame(() => {
//       this.center.arrange()
//       this.container.alpha = 1
//     })
//   }



// }


