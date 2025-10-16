import { Container, Point, Sprite, Texture } from 'pixi.js'
import { Cell } from '../cell'

export class Tile extends Container {
  public readonly cellId: number
  public readonly uniqueId: string
  public sprite!: Sprite

  public onPositionUpdate?: (args: {
    cellId: number
    x: number
    y: number
    index?: number
  }) => void

  constructor(cell: Cell, sprite?: Sprite) {
    super()
    this.cellId = cell.cellId
    this.uniqueId = cell.uniqueId

    if (sprite) {
      this.sprite = sprite
      this.addChild(sprite)
    }

    this.eventMode = 'dynamic'
  }

  public applyTexture(texture: Texture) {
    if (this.sprite) {
      this.removeChild(this.sprite)
      this.sprite.destroy(true) // ✅ clean old sprite
    }
    this.sprite = new Sprite(texture)
    this.addChild(this.sprite)
  }

  public setPosition(location: Point) {
    this.position.copyFrom(location)
  }

  public requestPositionUpdate(x: number, y: number, index?: number) {
    this.onPositionUpdate?.({
      cellId: this.cellId,
      x,
      y,
      index
    })
  }

  /** 
   * invalidate → cleanup for when tile is removed from store
   */
  public invalidate(): void {
    // detach from parent container if attached
    if (this.parent) {
      this.parent.removeChild(this)
    }

    // destroy sprite explicitly (releases GPU texture refs)
    if (this.sprite) {
      this.sprite.destroy({ children: true, texture: false, textureSource: false })
    }

    // destroy self and any children
    this.destroy({ children: true })
  }
}
