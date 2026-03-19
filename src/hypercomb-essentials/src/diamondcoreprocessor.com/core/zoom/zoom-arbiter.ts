// hypercomb-essentials/src/diamondcoreprocessor.com/core/zoom/zoom-arbiter.ts

export class ZoomArbiter {

  private activeSource: string | null = null

  public acquire = (source: string, force = false): boolean => {
    if (!this.activeSource) {
      this.activeSource = source
      return true
    }

    if (this.activeSource === source) return true
    if (!force) return false

    // forced takeover (pinch should usually win)
    this.activeSource = source
    return true
  }

  public release = (source: string): void => {
    if (this.activeSource !== source) return
    this.activeSource = null
  }

  public current = (): string | null => this.activeSource
}
