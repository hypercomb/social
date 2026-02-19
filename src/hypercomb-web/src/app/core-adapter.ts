// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, inject } from "@angular/core"
import { Navigation, Lineage, ScriptPreloader, Store, LayerInstaller, DependencyLoader, OpfsTreeLogger } from "@hypercomb/shared/core"
import { LocationParser } from "@hypercomb/shared/core/initializers/location-parser"
import { LayerService } from "./layer-service"
import { RuntimeMediator } from "@hypercomb/shared/ui/runtime-mediator"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {
  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloader)
  private readonly runtime = inject(RuntimeMediator)

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

    const logger = <OpfsTreeLogger>window.ioc.get("OpfsTreeLogger")
    await logger.log()

    const store = window.ioc.get('Store') as Store

    // opfs roots
    await store.initialize()

    //  // layers -> hydrate drones -> deps (single canonical pipeline)
    const parsed = LocationParser.parse("https://storagehypercomb.blob.core.windows.net/content/da83f9918946df8b4c9440aa9aee8fedb9a4156e5bc7919d5069ea57afe2c2cf")
    await this.runtime.sync(parsed)

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)


    const { list } = window.ioc
    const l = list();
    console.log('[core-adapter] ioc keys:', l)

    // const hostkey = 'PixiHost'
    // const host = <any>get(hostkey)!
    // await host.encounter('testing')

    // const showkey = 'ShowHoneycomb'
    // const show = <any>get(showkey)!
    // await show. encounter('testing')

    // const zoomkey = 'ZoomDrone'
    // const zoom = <any>get(zoomkey)!
    // await zoom.encounter('testing')

    //     const panningkey = 'PanningDrone'
    // const panning = <any>get(panningkey)!
    // await panning.encounter('testing')

    // const settingKey = 'Settings'
    // const setting = <any>get(settingKey)
    // await setting.encounter('testing')
    // console.log('got setting:', setting)
  }
}