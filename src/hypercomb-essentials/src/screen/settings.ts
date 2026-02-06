export class Settings {

  public static hexagonSide = 200

  public get height(): number { return Settings.hexagonSide * 2 }
  public get width(): number { return Settings.hexagonSide * Math.sqrt(3) }
  public get hexagonOffsetX(): number { return this.width / 2 }
  public get hexagonOffsetY(): number { return this.height / 2 }

  public get hexagonDimensions(): Readonly<Settings> {
    return this
  }

  // guard navigator
  public readonly isMac =
    typeof navigator !== 'undefined'
      ? /Mac|iMac|Macintosh/.test(navigator.userAgent)
      : false

  public bitDepth = 0.8
  public panThreshold = 25
  public readonly rings = 50
  public fillColor = "#242a30"
}
