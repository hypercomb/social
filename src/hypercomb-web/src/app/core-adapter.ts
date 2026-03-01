// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, inject } from "@angular/core"
import { Navigation, Lineage, ScriptPreloader, Store, LayerInstaller, DependencyLoader, OpfsTreeLogger } from "@hypercomb/shared/core"
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloader)

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

    // const logger = <OpfsTreeLogger>window.ioc.get("OpfsTreeLogger")
    // await logger.log()

    const store = window.ioc.get('Store') as Store

    // Store is already initialized in ensure-install (pre-boot)
    // but re-init is safe (idempotent)
    await store.initialize()

    // Install was already performed in ensure-install (before import map).
    // Just load dependencies into memory — the import map is now populated.
    const dependency = window.ioc.get('DependencyLoader') as DependencyLoader | undefined
    await dependency?.load?.()
    console.log('[core-adapter] dependencies loaded')

    await this.preloader.preload()

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)


    const { list } = window.ioc
    const l = list();
    console.log('[core-adapter] ioc keys:', l)

    const hostkey = 'PixiHost'
    const host = window.ioc.get(hostkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await host?.encounter?.('testing')

    const showkey = 'ShowHoneycomb'
    const show = window.ioc.get(showkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await show?.encounter?.('testing')

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