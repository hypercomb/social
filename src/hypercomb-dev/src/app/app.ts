import { AfterViewInit, Component, computed, signal } from '@angular/core';
import { type Bee, EffectBus } from '@hypercomb/core';
import type { HexOrientation } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import { initializeRuntime } from '@hypercomb/shared/core';
import type { SecretStore } from '@hypercomb/shared/core/secret-store';
import type { Navigation } from '@hypercomb/shared/core/navigation';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service';
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone';
import { PixiHostWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone';
import { ShowHoneycombWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone';
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { InputGate } from '@hypercomb/essentials/diamondcoreprocessor.com/input/input-gate.service';
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone';
import { NostrMeshWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-signer'
import { HexDetector } from '@hypercomb/essentials/diamondcoreprocessor.com/input/hex-detector'
import { TileOverlayDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-overlay.drone'
import { TileSelectionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-selection.drone'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history.service'
import { HistoryRecorder } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history-recorder.drone'
import { TileEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import { TileEditorDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.drone'
import { ImageEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'
import { ControlsBarComponent } from '@hypercomb/shared/ui';

const _deps = [
  AxialService,
  PanningDrone,
  PixiHostWorker,
  ShowHoneycombWorker,
  MousewheelZoomInput,
  NostrMeshWorker,
  TileOverlayDrone,
  TileSelectionDrone,
  NostrSigner,
  HexDetector,
  Settings,
  InputGate,
  ZoomDrone,
  HistoryService,
  HistoryRecorder,
  TileEditorService,
  TileEditorDrone,
  ImageEditorService,
]

void _deps

@Component({
  selector: 'app-root',
  imports: [ControlsBarComponent, RouterOutlet, SearchBarComponent, TileEditorComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App implements AfterViewInit {
  protected readonly title = signal('hypercomb-dev');

  public readonly meshPublic = signal(true);
  public readonly orientation = signal<HexOrientation>(
    (localStorage.getItem('hc:hex-orientation') as HexOrientation) || 'pointy'
  );

  // ── secret state (public-mode mesh scoping) ─────────────
  #secretValue = signal('')
  #secretVisible = signal(false)

  protected readonly secretValue = this.#secretValue.asReadonly()
  protected readonly secretVisible = this.#secretVisible.asReadonly()
  protected readonly hasSecret = computed(() => this.#secretValue().trim().length > 0)

  private get secretStore(): SecretStore | undefined {
    return get('@hypercomb.social/SecretStore') as SecretStore | undefined
  }

  private get nav(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }

  #runtimeReady: Promise<void>

  constructor() {
    this.#runtimeReady = initializeRuntime({
      onMeshStateChange: enabled => this.meshPublic.set(enabled),
    })
  }

  public toggleOrientation = (): void => {
    const next: HexOrientation = this.orientation() === 'pointy' ? 'flat' : 'pointy'
    this.orientation.set(next)
    localStorage.setItem('hc:hex-orientation', next)
    EffectBus.emit('render:set-orientation', { flat: next === 'flat' })
  }

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any;

    const wasPublic = this.meshPublic();
    const next = !wasPublic;
    this.meshPublic.set(next);
    mesh?.setNetworkEnabled?.(next, true);
    EffectBus.emit('mesh:public-changed', { public: next })
    if (!wasPublic) {
      // coming back to public — restore secret from store
      const stored = this.secretStore?.value ?? ''
      this.#secretValue.set(stored)
      if (stored) EffectBus.emit('mesh:secret', { secret: stored })
    }
  }

  protected readonly onShieldClick = (): void => {
    this.#secretVisible.update(v => !v)
  }

  protected readonly onSecretInput = (event: Event): void => {
    this.#secretValue.set((event.target as HTMLInputElement).value)
  }

  protected readonly submitSecret = (): void => {
    const value = this.#secretValue().trim()
    if (!value) return
    this.secretStore?.set(value)
    EffectBus.emit('mesh:secret', { secret: value })
    const segments = value.split('/').map(s => s.trim()).filter(Boolean)
    this.nav.go(segments)
  }

  public ngAfterViewInit(): void {
    void this.#runtimeReady.then(() => {
      // pre-fill secret from store (subdomain may have populated it)
      const stored = this.secretStore?.value ?? ''
      if (stored) this.#secretValue.set(stored)

      requestAnimationFrame(() => {
        void this.startRegisteredBees()
      })
    })
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
    console.log('[core-adapter] ioc keys:', list())

    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    for (const bee of values) {
      try {
        await bee.pulse('')
      } catch (error) {
        console.warn('[app] failed to start bee', bee.constructor?.name, error)
      }
    }

    window.dispatchEvent(new Event('synchronize'))

    // restore persisted orientation
    if (this.orientation() === 'flat') {
      EffectBus.emit('render:set-orientation', { flat: true })
    }

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
