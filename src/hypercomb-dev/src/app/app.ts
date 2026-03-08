import { AfterViewInit, Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import type { Bee } from '@hypercomb/core';
import { initializeRuntime } from '@hypercomb/shared/core';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/axial/axial-service';
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/panning.drone';
import { PixiHostWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/pixi-host.drone';
import { ShowHoneycombWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/show-honeycomb.drone';
import { SpacebarPanInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/spacebar-pan.input';
import { TouchPanInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/pan/touch-pan.input';
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/mousewheel-zoom.input';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/zoom.drone';
import { NostrMeshWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/nostr/nostr-signer'
import { HexDetector } from '@hypercomb/essentials/diamondcoreprocessor.com/input/hex-detector'
import { TileOverlayDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-overlay.drone'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history.service'
import { HistoryRecorder } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history-recorder.drone'
import { TileEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import { TileEditorDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.drone'
import { ImageEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import { SelectionService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/selection/selection.service'
import { TileSelectionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/selection/tile-selection.drone'
import { KeyMapService } from '@hypercomb/essentials/diamondcoreprocessor.com/input/keymap/keymap.service'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'
import { ControlsBarComponent } from '@hypercomb/shared/ui/controls-bar/controls-bar.component'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SearchBarComponent, TileEditorComponent, ControlsBarComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('hypercomb-dev');
  private runtimeReady: Promise<void> = Promise.resolve();

  public readonly meshPublic = signal(true);

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any;
    const next = !this.meshPublic();
    this.meshPublic.set(next);
    mesh?.setNetworkEnabled?.(next, true);
  }

  constructor() {
    const _ = [
      AxialService,
      PanningDrone,
      PixiHostWorker,
      ShowHoneycombWorker,
      SpacebarPanInput,
      TouchPanInput,
      MousewheelZoomInput,
      NostrMeshWorker,
      TileOverlayDrone,
      NostrSigner,
      HexDetector,
      Settings,
      ZoomDrone,
      HistoryService,
      HistoryRecorder,
      TileEditorService,
      TileEditorDrone,
      ImageEditorService,
      SelectionService,
      TileSelectionDrone,
      KeyMapService]

    queueMicrotask(() => {
      this.runtimeReady = initializeRuntime({
        onMeshStateChange: enabled => this.meshPublic.set(enabled),
      })
    })
  }

  public ngAfterViewInit(): void {
    void this.runtimeReady.then(() => {
      requestAnimationFrame(() => {
        void this.startRegisteredBees()
      })
    })
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
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
  }
}
