import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
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
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SearchBarComponent, TileEditorComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('hypercomb-dev');

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
      ImageEditorService]

    queueMicrotask(async () => {
      const l = list();
      console.log('[core-adapter] ioc keys:', l)

      const hostkey = '@diamondcoreprocessor.com/PixiHostWorker'
      const host = <any>get(hostkey)!
      await host.pulse('testing')

      const showkey = '@diamondcoreprocessor.com/ShowHoneycombWorker'
      const show = <any>get(showkey)!
      await show.pulse('testing')

      const zoomkey = '@diamondcoreprocessor.com/ZoomDrone'
      const zoom = <any>get(zoomkey)!
      await zoom.pulse('testing')

      const pankey = '@diamondcoreprocessor.com/PanningDrone'
      const pan = <any>get(pankey)!
      await pan.pulse('testing')

      const overlaykey = '@diamondcoreprocessor.com/TileOverlayDrone'
      const overlay = <any>get(overlaykey)!
      await overlay.pulse('testing')

      const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any

      // 1) hard-start mesh lifecycle
      await mesh.pulse('smoke-test')

      try {
        const enabled = !!mesh?.isNetworkEnabled?.()
        this.meshPublic.set(enabled)
      } catch {
        // ignore
      }

    })
  }
}
