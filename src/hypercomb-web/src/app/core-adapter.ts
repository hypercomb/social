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
import { meshResumed, rememberMeshSession } from '@hypercomb/shared/core/mesh-session'
import { LayerService } from "./layer-service"

const _ = [DependencyLoader, DroneRegistry, IconProviderRegistry, LayerService, Store]

const MESH_PUBLIC_KEY = 'hc:mesh-public'

// REFRESH KEEPS THE SWARM; CLOSING THE TAB LEAVES IT. main.ts imports
// mesh-session first, which rewrites the flag from this tab's session before
// any drone samples it. See hypercomb-shared/core/mesh-session.ts.

@Injectable({ providedIn: 'root' })
export class CoreAdapter {

  // -------------------------------------------------
  // dependencies (lazy IoC resolution)
  // -------------------------------------------------
  // Boots from this tab's session — mesh-session's write is the truth.
  public readonly meshPublic = signal(meshResumed);

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  constructor() {
    // Every join and leave path announces here (control, keymap, join/leave
    // words), so this is the one place the tab's session is written.
    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: pub }) => {
      this.meshPublic.set(pub)
      rememberMeshSession(pub)
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

    // REFRESH KEEPS THE SWARM: the network starts as this tab's session left
    // it (mesh-session's write is the flag's truth) — connected on a reload
    // mid-swarm, disconnected on a new tab.
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    mesh?.setNetworkEnabled?.(meshResumed, true)
  }
}