// src/app/core/core-adapter.ts
import { Injectable, inject } from '@angular/core'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly store = inject(Store)

  private initialized = false

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true

    // storage first so resources preload is ready
    await this.store.initialize()

    // root handle for lineage
    await this.lineage.initialize()

    // start listening for browser navigation
    this.navigation.listen()

    // build state from url without creating anything
    await this.lineage.tryResolve(this.navigation.segments())

    // whenever navigation changes, update derived lineage state (read-only)
    window.addEventListener('navigate', this.onNavigate)
  }

  private readonly onNavigate = async (e: Event): Promise<void> => {
    const { segments } = (e as CustomEvent<{ segments: string[] }>).detail
    await this.lineage.tryResolve(segments)
  }
}
