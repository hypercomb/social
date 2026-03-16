// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, signal } from "@angular/core"
import { EffectBus } from "@hypercomb/core"
import { Store, LayerInstaller, DependencyLoader, initializeRuntime } from "@hypercomb/shared/core"
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  public readonly meshPublic = signal(true);

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
    EffectBus.emit('mesh:public-changed', { public: next })
  }

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {

    if (this.initialized) return
    this.initialized = true

    await initializeRuntime({
      logOpfs: true,
      onMeshStateChange: enabled => this.meshPublic.set(enabled),
    })
  }
}