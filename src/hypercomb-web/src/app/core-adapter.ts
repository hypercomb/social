// hypercomb-web/src/app/core/core-adapter.ts

import { EffectBus } from "@hypercomb/core"
import { Store } from '@hypercomb/shared/core/store'
import { LayerInstaller } from '@hypercomb/shared/core/layer-installer'
import { DependencyLoader } from '@hypercomb/shared/core/dependency-loader'
import { initializeRuntime } from '@hypercomb/shared/core/runtime-initializer'

const _dependencies = [DependencyLoader, LayerInstaller, Store]
void _dependencies

const MESH_PUBLIC_KEY = 'hc:mesh-public'

// REFRESH → PRIVATE. Swarm membership is a per-session gesture, never a
// persisted posture: force the flag off at module load — before any drone
// samples it — so a reload always boots solo/private. Joining is always an
// explicit in-session act (mesh-header cycle → selector → START, or the
// keymap toggle), and leaving is one refresh away.
try { localStorage.setItem(MESH_PUBLIC_KEY, 'false') } catch { /* no storage — default is off anyway */ }

export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  // Always boots false — the module-scope force-write above is the truth.
  private meshPublicValue = false
  public readonly meshPublic = (): boolean => this.meshPublicValue

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  constructor() {
    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: pub }) => {
      this.meshPublicValue = pub
    })
  }

  // -------------------------------------------------
  // mesh toggle
  // -------------------------------------------------

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    const current = this.meshPublic()
    const next = !current
    this.meshPublicValue = next
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

    await initializeRuntime({ logOpfs: false })

    // REFRESH → PRIVATE: every boot starts disconnected (the module-scope
    // force-write is the flag's truth); membership never survives a reload.
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    mesh?.setNetworkEnabled?.(false, true)
  }
}
