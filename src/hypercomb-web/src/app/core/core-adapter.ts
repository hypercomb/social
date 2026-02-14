// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, inject } from '@angular/core'
import { environment } from '../../environments/environment'
import { Lineage } from './lineage'
import { Navigation } from './navigation'
import { RuntimeMediator } from './runtime-mediator.service'
import { ScriptPreloader } from './script-preloader'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloader)
  private readonly runtime = inject(RuntimeMediator)
  private readonly store = inject(Store)

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {
    if (this.initialized) return
    this.initialized = true

    // opfs roots
    await this.store.initialize()

    //  // layers -> hydrate drones -> deps (single canonical pipeline)
    await this.runtime.sync()

    // optional: dev diagnostics
    if (!environment.production && new URLSearchParams(location.search).has('test')) {
      const { list } = window.ioc
      console.log('[test] ioc keys:', list())
    }

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)

    // note:
    // - preloader is intentionally not invoked here yet
    // - keep it behind explicit user action or a separate boot phase
    void await this.preloader.preload()
    // console.log('[core-adapter] initialized')

    const { get, list } = window.ioc
    const l = list();
    console.log('[core-adapter] ioc keys:', l)
    
    const hostkey = 'PixiHost'
    const host = <any>get(hostkey)!
    await host.encounter('testing')

    const showkey = 'ShowHoneycomb'
    const show = <any>get(showkey)!
    await show. encounter('testing')


    // const settingKey = 'Settings'
    // const setting = <any>get(settingKey)
    // await setting.encounter('testing')
    // console.log('got setting:', setting)
  }
}