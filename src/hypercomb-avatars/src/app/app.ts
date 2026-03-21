import { Component, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { initializeRuntime } from '@hypercomb/shared/core'

// ─── minimal drone imports for avatar swarm ────────────────────
// Only what's needed: pixi host, mesh networking, and the swarm drone.
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service'
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings'
import { PixiHostWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone'
import { ShowHoneycombWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone'
import { NostrMeshWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-signer'
import { AvatarSwarmDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/avatar-swarm.drone'
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone'
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input'
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone'
import { InputGate } from '@hypercomb/essentials/diamondcoreprocessor.com/input/input-gate.service'
import { BackgroundDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/background/background.drone'
import { HexDetector } from '@hypercomb/essentials/diamondcoreprocessor.com/input/hex-detector'
import { LayoutService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/layout/layout.service'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history.service'

// prevent tree-shaking
const _deps = [
  AxialService,
  Settings,
  PixiHostWorker,
  ShowHoneycombWorker,
  NostrMeshWorker,
  NostrSigner,
  AvatarSwarmDrone,
  ZoomDrone,
  MousewheelZoomInput,
  PanningDrone,
  InputGate,
  BackgroundDrone,
  HexDetector,
  LayoutService,
  HistoryService,
]
void _deps

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'] as any,
})
export class App {
  protected readonly title = signal('hypercomb-avatars')
  protected readonly peerCount = signal(0)

  #runtimeReady: Promise<void>

  constructor() {
    this.#runtimeReady = initializeRuntime()

    queueMicrotask(() => {
      void this.#runtimeReady.then(() => {
        // enable mesh networking by default for avatars
        const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any
        mesh?.setNetworkEnabled?.(true, true)

        void this.startBees()
      })
    })
  }

  private readonly startBees = async (): Promise<void> => {
    console.log('[hypercomb-avatars] starting bees...')

    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    for (const bee of values) {
      try {
        await bee.pulse('')
      } catch (error) {
        console.warn('[hypercomb-avatars] failed to start bee', bee.constructor?.name, error)
      }
    }

    window.dispatchEvent(new Event('synchronize'))

    // listen for swarm peer count updates
    EffectBus.on('swarm:peer-count', (payload: any) => {
      this.peerCount.set(payload?.count ?? 0)
    })

    console.log('[hypercomb-avatars] all bees started')
  }
}
