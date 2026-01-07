import { Injectable } from "@angular/core"
import { Tile } from "src/app/cells/models/tile"

declare var EyeDropper: any

@Injectable({ providedIn: 'root' })
export class ColorPicker {

  public pickColor = async (): Promise<string> => {

    return new Promise(async (resolve, reject) => {
      if ('EyeDropper' in window) {

        try {
          const eyeDropper = new EyeDropper()
          const result = await eyeDropper.open()

          // refresh the tile
          resolve(result.sRGBHex)
        }
        catch (error) {
          reject('Error while finding color.')
        }

      } else {
        reject('EyeDropper API is not supported in this browser.')
      }
    })
  }

  public canPickColor = (): boolean => {
    return !!Tile
  }
}




