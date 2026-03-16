export type HexOrientation = 'pointy' | 'flat'

export class Settings  {

    public hexagonSide = 200

    // pointy-top dimensions (default)
    public get height(): number { return this.hexagonSide * 2 }
    public get width(): number { return this.hexagonSide * Math.sqrt(3) }
    public get hexagonOffsetX(): number { return this.width / 2 }
    public get hexagonOffsetY(): number { return this.height / 2 }

    // orientation-aware dimensions
    public hexWidth(orientation: HexOrientation): number {
        return orientation === 'flat' ? this.hexagonSide * 2 : this.hexagonSide * Math.sqrt(3)
    }
    public hexHeight(orientation: HexOrientation): number {
        return orientation === 'flat' ? this.hexagonSide * Math.sqrt(3) : this.hexagonSide * 2
    }

    // editor canvas is always a square that fits both orientations
    public get editorSize(): number { return this.hexagonSide * 2 }

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
}

window.ioc.register('@diamondcoreprocessor.com/Settings', new Settings())


