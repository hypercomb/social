import { Component, signal } from '@angular/core'
import { type Bee, EffectBus } from '@hypercomb/core'
import { RouterOutlet } from '@angular/router'
import { initializeRuntime } from '@hypercomb/shared/core'

// ─── minimal drone imports for avatar swarm ────────────────────
// Only what's needed: pixi host, mesh networking, and the swarm drone.
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/grid/axial-service'
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/preferences/settings'
import { PixiHostWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/pixi-host.worker'
import { ShowCellDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/show-cell.drone'
import { NostrMeshDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/sharing/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/sharing/nostr-signer'
import { AvatarSwarmDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/avatars/avatar-swarm.drone'
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/zoom.drone'
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/mousewheel-zoom.input'
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/pan/panning.drone'
import { InputGate } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/input-gate.service'
import { BackgroundDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/background/background.drone'
import { HexDetector } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/hex-detector'
import { LayoutService } from '@hypercomb/essentials/diamondcoreprocessor.com/move/layout.service'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/history/history.service'

// prevent tree-shaking
const _deps = [
  AxialService,
  Settings,
  PixiHostWorker,
  ShowCellDrone,
  NostrMeshDrone,
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
        const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
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
