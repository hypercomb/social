@Injectable({ providedIn: "root" })
export class CenterTileAction extends ActionBase<CellContext> {
  public id = "layout.centerTile"

  public enabled = async (): Promise<boolean> => {
    // ✅ only enable if a tile is hovered (or you can check hive too)
    return !!this.hovered
  }

  public run = async (payload: CellContext): Promise<void> => {
    const cell = payload.cell ?? this.hovered
    if (!cell) return
    await this.centerSprite([cell])
  }
}
