import { inject, Inject, Injectable } from "@angular/core";
import { CellContext } from "../action-contexts";
import { ActionBase } from "../action.base";
import { Tile } from "src/app/cells/models/tile";
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector";

@Injectable({ providedIn: 'root' })
export class MouseLockCheckAction extends ActionBase {

  id = "debug.mouselocked"
  override label = "Mouse Lock Check"
  override description = "Toggle mouse lock check (debug only)"
  public override enabled = (): boolean => {
    return true
  }

  public run = async (): Promise<void> => {
    this.state.checkMouseLock = true
    let position = this.ps.localPosition()
    const coordinate = this.detector.coordinate()
    const detected = this.detector.activeTile()
    console.log(`active tile :${detected?.position}`, detected)
    await this.ps.refresh()
    position = this.ps.localPosition()
    this.detector.detect(position!)
    const detected2 = this.detector.activeTile()
    const coordinate2 = this.detector.coordinate()
    console.log(`after refresh :${detected2?.position}`, detected2)
    console.log('before', coordinate, 'after', coordinate2)
    this.state.checkMouseLock = false
  }

}