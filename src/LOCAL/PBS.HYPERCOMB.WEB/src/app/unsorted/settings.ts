import { Injectable } from "@angular/core"
import { PathOptions } from "../core/models/path-options"
import { Constants } from "./constants"

@Injectable({ providedIn: 'root' })
export class Settings  {

    public static hexagonSide = Constants.HexagonSide

    public get height(): number { return Settings.hexagonSide * 2 }
    public get width(): number { return Settings.hexagonSide * Math.sqrt(3) }
    public get hexagonOffsetX(): number { return this.width / 2 }
    public get hexagonOffsetY(): number { return this.height / 2 }

    
    // expose dimensions as a readonly object (no mutation from outside)
    public get hexagonDimensions(): Readonly<Settings> {
        return this
    }

    // platform-specific
    public readonly isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)

    // rendering / interaction settings
    public bitDepth = 0.8
    public panThreshold = 25
    public readonly rings = 50

    public fillColor = "#242a30"

    constructor(public path: PathOptions) {

    }
}


