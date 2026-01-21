// src/app/core/core-adapter.ts
import { Injectable, inject } from '@angular/core'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { Store } from './store'
import { provideRuntimeLibs } from './runtime-libs'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly store = inject(Store)

  private initialized = false

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true

    provideRuntimeLibs()

    await this.store.initialize()
    await this.lineage.initialize()

    // bootstrap navigation based on current URL
    const segments = this.navigation.segments()
    this.navigation.bootstrap(segments)
  }
}
