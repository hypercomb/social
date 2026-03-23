import { AfterViewInit, Component, OnDestroy, signal } from '@angular/core';
import { type Bee, EffectBus } from '@hypercomb/core';
import type { HexOrientation } from '@hypercomb/essentials/diamondcoreprocessor.com/core/settings';
import { RouterOutlet } from '@angular/router';
import { SearchBarComponent } from '@hypercomb/shared';
import { MeshHeaderComponent } from '@hypercomb/shared/ui';
import { initializeRuntime } from '@hypercomb/shared/core';
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
import { TileActionsDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-actions.drone' // overlay icon provider
import { TileSelectionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-selection.drone'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history.service'
import { HistoryRecorder } from '@hypercomb/essentials/diamondcoreprocessor.com/core/history-recorder.drone'
import { TileEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import { TileEditorDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.drone'
import { ImageEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import { KeyMapService } from '@hypercomb/essentials/diamondcoreprocessor.com/input/keymap/keymap.service'
import { SelectionService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/selection/selection.service'
import '@hypercomb/essentials/diamondcoreprocessor.com/input/escape-cascade'
import '@hypercomb/essentials/diamondcoreprocessor.com/input/pivot-toggle'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'
import { ControlsBarComponent, ShortcutSheetComponent, CommandPaletteComponent, ActivityLogComponent } from '@hypercomb/shared/ui';
import { PortalOverlayComponent } from '@hypercomb/shared/ui/portal/portal-overlay.component'
import { SensitivityBarComponent } from '@hypercomb/shared/ui/sensitivity-bar/sensitivity-bar.component'
import { LayoutService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/layout/layout.service'
import { MoveDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/input/move/move.drone'
import { DesktopMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/move/desktop-move.input'
import { TouchMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/move/touch-move.input'
import { MovePreviewDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/move-preview.drone'
// import { TileIndexOverlayDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/tile-index-overlay.drone'
import { BackgroundDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/background/background.drone'
import { ShortcutSheetDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/ui/shortcut-sheet.drone'
import { CommandPaletteDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/ui/command-palette.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/ui/slash-command/slash-command.drone'
import { AvatarSwarmDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/pixi/avatar-swarm.drone'
import { ClipboardService } from '@hypercomb/essentials/diamondcoreprocessor.com/core/clipboard/clipboard.service'
import { ClipboardWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/core/clipboard/clipboard.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/bridge/claude-bridge.drone'
import { HelpQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/ui/help.queen'
import { PinchZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/input/zoom/pinch-zoom.input'
import { TouchGestureCoordinator } from '@hypercomb/essentials/diamondcoreprocessor.com/input/touch/touch-gesture.coordinator'

const _deps = [
  AxialService,
  PanningDrone,
  PixiHostWorker,
  ShowHoneycombWorker,
  MousewheelZoomInput,
  NostrMeshWorker,
  TileOverlayDrone,
  TileActionsDrone,
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
  LayoutService,
  MoveDrone,
  DesktopMoveInput,
  TouchMoveInput,
  MovePreviewDrone,
  // TileIndexOverlayDrone,
  BackgroundDrone,
  ShortcutSheetDrone,
  CommandPaletteDrone,
  AvatarSwarmDrone,
  ClipboardService,
  ClipboardWorker,
  HelpQueenBee,
  PinchZoomInput,
  TouchGestureCoordinator,
]

void _deps

@Component({
  selector: 'app-root',
  imports: [ControlsBarComponent, MeshHeaderComponent, RouterOutlet, SearchBarComponent, TileEditorComponent, ShortcutSheetComponent, CommandPaletteComponent, PortalOverlayComponent, ActivityLogComponent, SensitivityBarComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('hypercomb-dev');

  public readonly meshPublic = signal(
    localStorage.getItem('hc:mesh-public') === 'true' ? true
    : localStorage.getItem('hc:mesh-public') === 'false' ? false
    : null as boolean | null
  );
  public readonly orientation = signal<HexOrientation>(
    (localStorage.getItem('hc:hex-orientation') as HexOrientation) || 'point-top'
  );

  #pivotOn = localStorage.getItem('hc:hex-pivot') === 'true'
  #runtimeReady: Promise<void>

  constructor() {
    this.#runtimeReady = initializeRuntime({
      onMeshStateChange: enabled => {
        if (localStorage.getItem('hc:mesh-public') === null) {
          this.meshPublic.set(enabled)
          localStorage.setItem('hc:mesh-public', String(enabled))
        }
      },
    })

    queueMicrotask(() => {
      void this.#runtimeReady.then(() => {
        // push stored preference to the mesh
        const stored = localStorage.getItem('hc:mesh-public')
        if (stored !== null) {
          const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any
          mesh?.setNetworkEnabled?.(stored === 'true', true)
        }
        void this.startRegisteredBees()
      })
    })
  }

  public toggleOrientation = (): void => {
    const next: HexOrientation = this.orientation() === 'point-top' ? 'flat-top' : 'point-top'
    this.orientation.set(next)
    localStorage.setItem('hc:hex-orientation', next)
    EffectBus.emit('render:set-orientation', { flat: next === 'flat-top' })
  }

  public toggleMesh = (): void => {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshWorker') as any;

    const next = !this.meshPublic();
    this.meshPublic.set(next);
    localStorage.setItem('hc:mesh-public', String(next))
    mesh?.setNetworkEnabled?.(next, true);
    EffectBus.emit('mesh:public-changed', { public: next })
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

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
