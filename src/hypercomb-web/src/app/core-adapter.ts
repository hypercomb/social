// hypercomb-web/src/app/core/core-adapter.ts

// The shipped locale catalogs. They used to live inside runtime-initializer;
// that module is in @hypercomb/runtime now and ships none of its own, because
// a locale is content and which languages exist is the host's answer. Web and
// dev still bundle theirs — Angular lazy-chunks them — so pass them in
// explicitly and nothing about these shells changes.
import { bundledCatalogs, bundledLocales } from '@hypercomb/shared/core/bundled-catalogs'
import { Injectable, signal } from "@angular/core"
import { EffectBus } from "@hypercomb/core"
import { Store, DependencyLoader, DroneRegistry, IconProviderRegistry, initializeRuntime } from "@hypercomb/shared/core"
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, DroneRegistry, IconProviderRegistry, LayerService, Store]

const MESH_PUBLIC_KEY = 'hc:mesh-public'

// REFRESH → PRIVATE. Swarm membership is a per-session gesture, never a
// persisted posture: force the flag off at module load — before any drone
// samples it — so a reload always boots solo/private. Joining is always an
// explicit in-session act (mesh-header cycle → selector → START, or the
// keymap toggle), and leaving is one refresh away.
try { localStorage.setItem(MESH_PUBLIC_KEY, 'false') } catch { /* no storage — default is off anyway */ }

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  // Always boots false — the module-scope force-write above is the truth.
  public readonly meshPublic = signal(false);

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  constructor() {
    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: pub }) => {
      this.meshPublic.set(pub)
    })
  }

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

    await initializeRuntime({ logOpfs: false, catalogs: bundledCatalogs, locales: bundledLocales })

    // REFRESH → PRIVATE: every boot starts disconnected (the module-scope
    // force-write is the flag's truth); membership never survives a reload.
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    mesh?.setNetworkEnabled?.(false, true)
  }
}