import { Injectable, inject, signal } from '@angular/core'
import { Navigation } from './navigation'

@Injectable({ providedIn: 'root' })
export class MovementService {

  // increments only after navigation intent is committed
  public readonly moved = signal(0)

  private get navigation(): Navigation { return <Navigation>window.ioc.get("Navigation") }

  // prevents overlapping navigation commits
  private committing: Promise<void> | null = null

  public constructor() {
    // browser back/forward
    window.addEventListener('popstate', () => {
      void this.commit()
    })
  }

  // ----------------------------------
  // relative movement
  // ----------------------------------

  public move = async (segment: string): Promise<void> => {
    const clean = segment.replace(/\s+/g, ' ').trim()
    if (!clean) return

    const segments = this.navigation.segments()
    segments.push(clean)

    this.navigation.go(segments)
    await this.commit()
  } 

  // ----------------------------------
  // history
  // ----------------------------------

  public back = (): void => {
    window.history.back()
    // popstate will trigger commit
  }

  public forward = (): void => {
    window.history.forward()
    // popstate will trigger commit
  }

  // ----------------------------------
  // internal
  // ----------------------------------

  private readonly commit = async (): Promise<void> => {
    if (this.committing) {
      await this.committing
    }

    this.committing = Promise.resolve().then(() => {
      // navigation intent is already committed to the url
      // this service only signals movement
      this.moved.update(v => v + 1)
    })

    try {
      await this.committing
    } finally {
      this.committing = null
    }
  }
}
