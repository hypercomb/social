// src/app/core/core-adapter.ts
import './ioc.web'

import { Injectable, inject } from '@angular/core'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { Store } from './store'
import { LayerRestorationService } from './layer-restoration.service'
import { ScriptPreloader } from './script-preloader'
import { DependencyLoader } from './dependency-loader'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly dependency = inject(DependencyLoader)
  private readonly preloader = inject(ScriptPreloader)
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

    // storage first (lineage + preloader depend on handles)
    await this.store.initialize()

    // restore the layout where necessary
    const depth = 3
    await this.dependency.load()
    await this.restoration.load(this.store.opfsRoot, depth)
    await this.restoration.restore(this.store.opfsRoot, depth)

    await this.preloader.preload()

    // lineage is anchored to the platform root (hypercomb folder)
    // note: test-domain root also gets created by store.initialize()
    await this.lineage.initialize()

    // const { get , list } = window.ioc
    // const l = list();
    // const hostkey = 'Pixi Host'
    // const host = <any>get(hostkey)!
    // await host.encounter('testing')

    // const showkey = 'Show Honeycomb'
    // const show = <any>get(showkey)!
    // await show. encounter('testing')

    // const l2 = list();
    // const hostkey2 = 'ddd2317a1089b8b067a2d1f1e48c0ddcc3f8a9fe49333e1a8a868c9f69e39a31'
    // const host2 = new PixiHostDrone(hostkey2)!
    // JSON.stringify(host2)

    // await host2.encounter('testing')

    // const showkey2 = 'bcbaf6cbc1f21798e0d728a66acb04f1b4ce5b044e0c7ac854a0fce14a824834'
    // const show2 = new ShowHoneycombDrone(showkey2)!
    // await show2.encounter('testing')



    // const hello = get<HelloWorldDrone>('e9e4750b480a8271b92a1a95cd83d613076ecd19ece0bf5d918e3a48f68609c4')!
    // await hello.encounter('hello')

    // bootstrap navigation using url segments only
    // never inject "hypercomb" into the url
    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)
  }
}
