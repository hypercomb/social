// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, signal } from "@angular/core"
import { EffectBus } from "@hypercomb/core"
import { Store, LayerInstaller, DependencyLoader, initializeRuntime } from "@hypercomb/shared/core"
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

const MESH_PUBLIC_KEY = 'hc:mesh-public'

function readMeshPublic(): boolean {
  return localStorage.getItem(MESH_PUBLIC_KEY) === 'true'
}

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  public readonly meshPublic = signal(readMeshPublic());

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  // -------------------------------------------------
  // mesh toggle
  // -------------------------------------------------

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    const current = this.meshPublic()
    const next = !current
    this.meshPublic.set(next)
    localStorage.setItem(MESH_PUBLIC_KEY, String(next))
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
      onMeshStateChange: enabled => {
        // only accept runtime-reported state when no stored preference exists
        if (readMeshPublic() === null) {
          this.meshPublic.set(enabled)
          localStorage.setItem(MESH_PUBLIC_KEY, String(enabled))
        }
      },
    })

    // push stored preference to the mesh after init
    const stored = readMeshPublic()
    if (stored !== null) {
      const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
      mesh?.setNetworkEnabled?.(stored, true)
    }
  }
}