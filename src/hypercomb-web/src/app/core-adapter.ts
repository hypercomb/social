// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, signal } from "@angular/core"
import { type Navigation, type Lineage, type ScriptPreloader, Store, LayerInstaller, DependencyLoader, OpfsTreeLogger } from "@hypercomb/shared/core"

const _ = [DependencyLoader, LayerInstaller, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  public readonly meshPublic = signal(true);
  private get navigation(): Navigation { return get('@hypercomb.social/Navigation') as Navigation }
  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get preloader(): ScriptPreloader { return get('@hypercomb.social/ScriptPreloader') as ScriptPreloader }

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  // -------------------------------------------------
  // mesh toggle
  // -------------------------------------------------

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any
    const next = !this.meshPublic()
    this.meshPublic.set(next)
    mesh?.setNetworkEnabled?.(next, true)
  }

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {

    if (this.initialized) return
    this.initialized = true

    const logger = get('@hypercomb.social/OpfsTreeLogger') as OpfsTreeLogger
    await logger.log()

    const store = get('@hypercomb.social/Store') as Store
    await store.initialize()

    // Dependencies already loaded in main.ts before Angular bootstrap.
    // Just load bees from OPFS.
    await this.preloader.preload()

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)


    const l = list();
    console.log('[core-adapter] ioc keys:', l)

    const hostkey = '@diamondcoreprocessor.com/PixiHostWorker'
    const host = get(hostkey) as { pulse?: (arg: string) => Promise<void> | void } | undefined
    await host?.pulse?.('testing')

    const showkey = '@diamondcoreprocessor.com/ShowHoneycombWorker'
    const show = get(showkey) as { pulse?: (arg: string) => Promise<void> | void } | undefined
    await show?.pulse?.('testing')

    const zoomkey = '@diamondcoreprocessor.com/ZoomDrone'
    const zoom = get(zoomkey) as { pulse?: (arg: string) => Promise<void> | void } | undefined
    await zoom?.pulse?.('testing')

    const panningkey = '@diamondcoreprocessor.com/PanningDrone'
    const panning = get(panningkey) as { pulse?: (arg: string) => Promise<void> | void } | undefined
    await panning?.pulse?.('testing')

    const overlaykey = '@diamondcoreprocessor.com/TileOverlayDrone'
    const overlay = get(overlaykey) as { pulse?: (arg: string) => Promise<void> | void } | undefined
    await overlay?.pulse?.('testing')

    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any

    if (mesh) {
      await mesh.pulse('smoke-test')

      try {
        const enabled = !!mesh.isNetworkEnabled?.()
        this.meshPublic.set(enabled)
      } catch {
        // ignore
      }
    } else {
      console.warn('[core-adapter] NostrMeshWorker not found — OPFS bundles may need rebuilding')
    }

    // const settingKey = 'Settings'
    // const setting = <any>get(settingKey)
    // await setting.pulse('testing')
    // console.log('got setting:', setting)
  }
}