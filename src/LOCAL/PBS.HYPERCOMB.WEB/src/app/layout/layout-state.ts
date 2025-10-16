import { Injectable, signal } from "@angular/core"
import { Cell } from "src/app/cells/cell"

@Injectable({
  providedIn: 'root'
})
export class LayoutState {

  public offsetFromCenterX: number = 0
  public offsetFromCenterY: number = 0

  // private readonly _layoutLocked = signal(false)
  // public readonly layoutLocked = this._layoutLocked.asReadonly()

  // public lockLayout = () => this._layoutLocked.set(true)
  // public unlockLayout = () => this._layoutLocked.set(false)

  private readonly _layoutInitialized = signal(false)
  public readonly layoutInitialized = this._layoutInitialized.asReadonly()
  private readonly _mouseOverControlBar = signal(false)
  public readonly isMouseOverControlBar = this._mouseOverControlBar.asReadonly()

  public baseId: any = 0
  public information: string = ''
  public link: string = ''
  public localData: Cell[] = []
  public minScale = 0.2
  public maxScale = 2

  // mutators
  public setLayoutInitialized = (on: boolean) => {
    this._layoutInitialized.set(on)
  }

  public setMouseOverControlBar = (on: boolean) => {
    this._mouseOverControlBar.set(on)
  }
}



