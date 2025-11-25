import { Injectable, inject } from "@angular/core"
import { ActionBase } from "src/app/actions/action.base"
import { CellPayload } from "src/app/actions/action-contexts"
import { Cell } from "src/app/cells/cell"
import { ContextMenuService } from "src/app/navigation/menus/context-menu-service"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { OpenLinkAction } from "src/app/actions/navigation/open-link"
import { Container } from "pixi.js"
import { TILE_FACTORY } from "src/app/shared/tokens/i-hypercomb.token"

@Injectable({ providedIn: "root" })
export class RenderTileAction extends ActionBase<CellPayload> {
  public id = "tile.render"
  public override label = "Render Tile"
  public override description = "Render a tile into the current layout"
  public override risk: "warning" = "warning"

  // services
  private readonly contextMenu = inject(ContextMenuService)
  private readonly factory = inject(TILE_FACTORY)
  private readonly pixi = inject(PixiManager)

  // runtime registries
  private readonly tiles = new Map<number, Container>()     // cellId -> tile display object
  private readonly layers = new Map<number, Container>()        // layerIndex -> container

  // ─────────────────────────────────────────────────────────────
  // event wiring (unchanged: click + hover behavior)
  // ─────────────────────────────────────────────────────────────
  constructor() {
    super()

    this.ps.onHover(() => {
      const cell = this.detector.activeCell()!
      if (!cell) return
      this.debug.log("tiles", "tile hovered")
      this.contextMenu.show(cell)
    })
  }

  // ─────────────────────────────────────────────────────────────
  // public api required by scheduler
  // ─────────────────────────────────────────────────────────────

  public override enabled = async (payload: CellPayload): Promise<boolean> => {
   
    // Check if the cell is editable
    const cell = payload.cell
    if(cell.kind === 'Hive') return false 
    return !this.state.cancelled()
  }

  // render or update one tile, deduped by cellId, into its layer container
  public run = async (payload: CellPayload): Promise<void> => {
    const src = payload.cell
    const cell = new Cell(src) // normalize/clamp if your Cell ctor does that
    const id = cell.cellId!
    const layerIndex = (cell as any).layerIndex ?? (cell as any).zIndex ?? (cell as any).layer ?? 0

    // ensure layer container exists
    const layer = this.getLayer(layerIndex)

    // dedupe: if a tile already exists for this id, replace it safely
    const existing = this.tiles.get(id)
    if (existing) {
      existing.parent?.removeChild(existing)
        // if you prefer diff/patch instead, replace the next 2 lines with your updater
        ; (existing as any).destroy?.({ children: true })
      this.combstore.unregister?.(id) // keep combstore in sync if available
      this.tiles.delete(id)
    }

    // build the display object
    const tile = await this.factory.create(cell)

    tile.on("click", (e: MouseEvent) => {
      const cell = this.detector.activeCell()
      if (!cell) return
      this.handleClick(e, cell)
    })

    // mount into correct layer and register
    layer.addChild(tile)
    this.tiles.set(id, tile)
    this.combstore.register(tile, cell) // pair with your combstore if present
  }

  // remove one tile by id
  public cull = async (cellId: number): Promise<void> => {
    if (cellId == null) return
    const tile = this.tiles.get(cellId) ?? this.combstore.lookupTile?.(cellId)
    if (!tile) return

    tile.parent?.removeChild(tile)
      ; (tile as any).destroy?.({ children: true })
    this.tiles.delete(cellId)
    this.combstore.unregister?.(cellId)
  }

  // hard sweep used by scheduler on first hot tick of a hive swap
  // removes everything not in the keep set, preventing leftovers from previous hive
  public cullAllExcept = async (keep: Set<number>): Promise<void> => {
    for (const [id, tile] of this.tiles) {
      if (!keep.has(id)) {
        tile.parent?.removeChild(tile)
          ; (tile as any).destroy?.({ children: true })
        this.tiles.delete(id)
        this.combstore.unregister?.(id)
      }
    }
  }

  // optional: aggressive reset used by scheduler when desired
  public clearContainer = async (): Promise<void> => {
    // remove all visual children
    this.pixi.container.removeChildren()
    // clear registries
    for (const id of this.tiles.keys()) this.combstore.unregister?.(id)
    this.tiles.clear()
    this.layers.clear()
  }

  // optional: readiness hook the scheduler will await before rendering a layer
  // if you can preload textures/assets per cell, do it here; otherwise leave as no-op
  public prepare = async (_cell: Cell): Promise<void> => {
    // no-op by default; implement if tileFactory can preload textures
  }

  // optional: layer hooks (useful if you want to create special containers or masks per layer)
  public beginLayer = async (layerIndex: number): Promise<void> => {
    this.getLayer(layerIndex) // ensure exists
  }
  public endLayer = async (_layerIndex: number): Promise<void> => {
    // no-op by default
  }

  // ─────────────────────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────────────────────

  private getLayer = (layerIndex: number): Container => {
    let layer = this.layers.get(layerIndex)
    if (!layer) {
      layer = new Container()
      layer.sortableChildren = true
      layer.zIndex = layerIndex
      this.pixi.container.addChild(layer)
      this.layers.set(layerIndex, layer)
    }
    return layer
  }

  private handleClick = (event: MouseEvent, cell: Cell): void => {
    const cellContext = <CellPayload>{ cell }
    this.registry.invoke(OpenLinkAction.ActionId, cellContext)
  }
}
