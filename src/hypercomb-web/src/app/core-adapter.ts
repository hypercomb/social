// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable } from "@angular/core"
import { type Navigation, type Lineage, type ScriptPreloader, Store, LayerInstaller, DependencyLoader, OpfsTreeLogger } from "@hypercomb/shared/core"
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------

  private get navigation(): Navigation { return get('Navigation') as Navigation }
  private get lineage(): Lineage { return get('Lineage') as Lineage }
  private get preloader(): ScriptPreloader { return get('ScriptPreloader') as ScriptPreloader }

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

    const store = get('Store') as Store

    // Store is already initialized in ensure-install (pre-boot)
    // but re-init is safe (idempotent)
    await store.initialize()

    // Install was already performed in ensure-install (before import map).
    // Just load dependencies into memory — the import map is now populated.
    const dependency = get('DependencyLoader') as DependencyLoader | undefined
    await dependency?.load?.()
    console.log('[core-adapter] dependencies loaded')

    await this.preloader.preload()

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)


    const l = list();
    console.log('[core-adapter] ioc keys:', l)

    const hostkey = 'PixiHost'
    const host = get(hostkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await host?.encounter?.('testing')

    const showkey = 'ShowHoneycomb'
    const show = get(showkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await show?.encounter?.('testing')

      const zoomkey = 'ZoomDrone'
      const zoom = <any>get(zoomkey)!
      await zoom.encounter('testing')

          const panningkey = 'PanningDrone'
      const panning = <any>get(panningkey)!
      await panning.encounter('testing')

    // const settingKey = 'Settings'
    // const setting = <any>get(settingKey)
    // await setting.encounter('testing')
    // console.log('got setting:', setting)
  }
}