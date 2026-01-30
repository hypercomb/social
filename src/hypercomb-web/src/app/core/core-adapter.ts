// src/app/core/core-adapter.ts

import { Injectable, inject } from '@angular/core'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { Store } from './store'
import { provideRuntimeLibs } from './runtime-libs'
import { LayerRestorationService } from './layer-restoration.service'
import { ScriptPreloaderService } from './script-preloader.service'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloaderService) 
  private readonly restoration = inject(LayerRestorationService)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true

    provideRuntimeLibs()

    // storage first (lineage + preloader depend on handles)
    await this.store.initialize()
    
    // restore the layout where necessary
    const depth = 3
    await this.restoration.load(this.store.opfsRoot, depth)
    await this.restoration.restore(this.store.opfsRoot, depth)
    
    await this.preloader.preload()

    // lineage is anchored to the platform root (hypercomb folder)
    // note: test-domain root also gets created by store.initialize()
    await this.lineage.initialize()

    // bootstrap navigation using url segments only
    // never inject "hypercomb" into the url
    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)
  }
}
