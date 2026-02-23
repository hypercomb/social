import { Injectable, signal } from '@angular/core'

export type VisualUpdateDetail = {
  source: string
  revision: number
  locationRevision: number
  firstAfterLocation: boolean
}

@Injectable({ providedIn: 'root' })
export class VisualUpdateService {

  private readonly revision = signal(0)
  private locationRevision = 0
  private pendingFirstAfterLocation = true

  public readonly changed = (): number => this.revision()

  public readonly markLocationChange = (_source: string = 'location'): void => {
    this.locationRevision += 1
    this.pendingFirstAfterLocation = true
  }

  public readonly notifyChange = (source: string = 'change'): void => {
    const firstAfterLocation = this.pendingFirstAfterLocation
    if (firstAfterLocation) this.pendingFirstAfterLocation = false

    this.revision.update(v => v + 1)

    const detail: VisualUpdateDetail = {
      source,
      revision: this.revision(),
      locationRevision: this.locationRevision,
      firstAfterLocation
    }

    window.dispatchEvent(new CustomEvent<VisualUpdateDetail>('synchronize', { detail }))
  }
}

window.ioc.register('VisualUpdateService', new VisualUpdateService())