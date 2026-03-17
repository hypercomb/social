import { AfterViewInit, Component, computed, OnDestroy, signal } from '@angular/core';
import { type Bee, EffectBus } from '@hypercomb/core';
import type { HexOrientation } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import { initializeRuntime } from '@hypercomb/shared/core';
import type { Navigation } from '@hypercomb/shared/core/navigation';
import type { SecretStrengthProvider } from '@hypercomb/shared/core/secret-strength';
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
import { KeyMapService } from '@hypercomb/essentials/diamondcoreprocessor.com/input/keymap/keymap.service'
import { SelectionService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/selection/selection.service'
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
  KeyMapService,
  SelectionService,
]

void _deps

@Component({
  selector: 'app-root',
  imports: [ControlsBarComponent, RouterOutlet, SearchBarComponent, TileEditorComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App implements AfterViewInit, OnDestroy {
  protected readonly title = signal('hypercomb-dev');

  public readonly meshPublic = signal(true);
  public readonly orientation = signal<HexOrientation>(
    (localStorage.getItem('hc:hex-orientation') as HexOrientation) || 'point-top'
  );

  // ── secret state (public-mode mesh scoping) ─────────────
  #secretValue = signal('')
  #secretExpanded = signal(true)

  protected readonly secretValue = this.#secretValue.asReadonly()
  protected readonly secretExpanded = this.#secretExpanded.asReadonly()
  protected readonly hasSecret = computed(() => this.#secretValue().trim().length > 0)

  protected readonly shieldColor = computed(() => {
    const secret = this.#secretValue().trim()
    if (!secret) return 'rgba(245, 245, 245, 0.35)'
    const provider = get('@hypercomb.social/SecretStrengthProvider') as SecretStrengthProvider | undefined
    const score = provider?.evaluate(secret) ?? 0.5
    // interpolate hue: 0 (red) → 130 (green)
    const hue = Math.round(score * 130)
    return `hsl(${hue}, 70%, 50%)`
  })

  private get nav(): Navigation {
    return get('@hypercomb.social/Navigation') as Navigation
  }

  #runtimeReady: Promise<void>
  #pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'

  constructor() {
    this.#runtimeReady = initializeRuntime({
      onMeshStateChange: enabled => this.meshPublic.set(enabled),
    })
    document.addEventListener('keydown', this.#onKeyDown)
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.#onKeyDown)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    // Ctrl+Shift+8 toggles pivot mode
    if (e.ctrlKey && e.shiftKey && e.code === 'Digit8') {
      e.preventDefault()
      this.#pivotOn = !this.#pivotOn
      localStorage.setItem('hc:hex-pivot', String(this.#pivotOn))
      EffectBus.emit('render:set-pivot', { pivot: this.#pivotOn })
    }
  }

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any;

    const wasPublic = this.meshPublic();
    const next = !wasPublic;
    this.meshPublic.set(next);
    mesh?.setNetworkEnabled?.(next, true);
    EffectBus.emit('mesh:public-changed', { public: next })
    if (!wasPublic) {
      // coming back to public — re-emit secret if present
      const secret = this.#secretValue().trim()
      if (secret) EffectBus.emit('mesh:secret', { secret })
    }
  }

  protected readonly onShieldClick = (): void => {
    this.#secretExpanded.update(v => !v)
  }

  protected readonly onSecretInput = (event: Event): void => {
    this.#secretValue.set((event.target as HTMLInputElement).value)
  }

  protected readonly submitSecret = (): void => {
    const value = this.#secretValue().trim()
    if (!value) return
    EffectBus.emit('mesh:secret', { secret: value })
    this.#secretExpanded.set(false)
  }

  public ngAfterViewInit(): void {
    void this.#runtimeReady.then(() => {
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
    if (this.orientation() === 'flat-top') {
      EffectBus.emit('render:set-orientation', { flat: true })
    }

    // restore persisted pivot
    if (this.#pivotOn) {
      EffectBus.emit('render:set-pivot', { pivot: true })
    }

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
