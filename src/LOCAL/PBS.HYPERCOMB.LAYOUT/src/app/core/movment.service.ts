// src/app/core/movement.service.ts

import { Injectable, inject, signal } from '@angular/core'
import { OpfsStore } from './opfs.store'

@Injectable({ providedIn: 'root' })
export class MovementService {

  // increments only after opfs.current is aligned to the url
  public readonly moved = signal(0)

  private readonly opfs = inject(OpfsStore)

  // prevents overlapping sync waves from racing each other
  private committing: Promise<void> | null = null

  constructor() {
    // back/forward (and user nav) activates a different history entry
    // the browser fires popstate, so we commit from here
    window.addEventListener('popstate', () => {
      void this.commit(false)
    })
  }

  // -------------------------------------------------
  // relative movement
  // -------------------------------------------------

  public move = async (segment: string): Promise<void> => {
    const seg = segment.trim()
    if (!seg) return

    const current = window.location.pathname.split('/').filter(Boolean)
    current.push(seg)

    window.history.pushState(null, '', '/' + current.join('/'))

    // pushstate does not trigger popstate, so we must commit explicitly
    await this.commit(false)
  }

  // -------------------------------------------------
  // history
  // -------------------------------------------------

  public back = (): void => {
    window.history.back()
    // popstate will commit + bump
  }

  public forward = (): void => {
    window.history.forward()
    // popstate will commit + bump
  }

  // -------------------------------------------------
  // internal (commit protocol)
  // -------------------------------------------------

  private readonly commit = async (create: boolean): Promise<void> => {
    // do nothing until opfs is initialized
    if (!this.opfs.ready()) return

    // serialize commits to avoid races from fast clicks / rapid back-forward
    if (this.committing) {
      await this.committing
      // after waiting, align again to the latest url
      // (in case url changed during the wait)
    }

    this.committing = (async () => {
      const dir = await this.opfs.syncToUrl(create)
      this.opfs.current.set(dir)
      this.moved.update(v => v + 1)
    })()

    try {
      await this.committing
    } finally {
      this.committing = null
    }
  }
}
