// src/app/core/core-adapter.ts
import { Injectable, inject } from '@angular/core'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { Store } from './store'
import { provideRuntimeLibs } from './runtime-libs'
import { ProcessorHost } from './processor-host'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly store = inject(Store)
  private readonly processorHost = inject(ProcessorHost)

  private initialized = false

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true

    provideRuntimeLibs()

    await this.store.initialize()
    await this.lineage.initialize()

    this.navigation.listen()

    const segments = this.navigation.segments()

    // align history first (root + one entry per segment with history.state.segments)
    this.navigation.bootstrap(segments)

    // start reacting to navigation after history is aligned
    this.processorHost.start()
  }
}
