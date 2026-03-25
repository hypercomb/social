import { AfterViewInit, Component, OnDestroy, signal } from '@angular/core';
import { type Bee, EffectBus } from '@hypercomb/core';
import type { HexOrientation } from '@hypercomb/essentials/diamondcoreprocessor.com/preferences/settings';
import { RouterOutlet } from '@angular/router';
import { CommandLineComponent } from '@hypercomb/shared';
import { MeshHeaderComponent } from '@hypercomb/shared/ui';
import { initializeRuntime } from '@hypercomb/shared/core';
import { AxialService } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/grid/axial-service';
import { PanningDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/pan/panning.drone';
import { PixiHostWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/pixi-host.worker';
import { ShowCellDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/show-cell.drone';
import { MousewheelZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/mousewheel-zoom.input';
import { Settings } from '@hypercomb/essentials/diamondcoreprocessor.com/preferences/settings';
import { InputGate } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/input-gate.service';
import { ZoomDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/zoom.drone';
import { NostrMeshDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/sharing/nostr-mesh.drone'
import { NostrSigner } from '@hypercomb/essentials/diamondcoreprocessor.com/sharing/nostr-signer'
import { HexDetector } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/hex-detector'
import { TileOverlayDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/tile-overlay.drone'
import { TileActionsDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/tile-actions.drone' // overlay icon provider
import { TileSelectionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/tile-selection.drone'
import { HistoryService } from '@hypercomb/essentials/diamondcoreprocessor.com/history/history.service'
import { HistoryRecorder } from '@hypercomb/essentials/diamondcoreprocessor.com/history/history-recorder.drone'
import { TileEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import { TileEditorDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.drone'
import { ImageEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import { KeyMapService } from '@hypercomb/essentials/diamondcoreprocessor.com/keyboard/keymap.service'
import { SelectionService } from '@hypercomb/essentials/diamondcoreprocessor.com/selection/selection.service'
import '@hypercomb/essentials/diamondcoreprocessor.com/selection/tile-selection.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/keyboard/escape-cascade'
import '@hypercomb/essentials/diamondcoreprocessor.com/navigation/bee-toggle'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'
import { ControlsBarComponent, ShortcutSheetComponent, CommandPaletteComponent, ActivityLogComponent } from '@hypercomb/shared/ui';
import { PortalOverlayComponent } from '@hypercomb/shared/ui/portal/portal-overlay.component'
import { SensitivityBarComponent } from '@hypercomb/shared/ui/sensitivity-bar/sensitivity-bar.component'
import { LayoutService } from '@hypercomb/essentials/diamondcoreprocessor.com/move/layout.service'
import { MoveDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/move/move.drone'
import { DesktopMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/move/desktop-move.input'
import { TouchMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/move/touch-move.input'
import { MovePreviewDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/move-preview.drone'
// import { TileIndexOverlayDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/tile-index-overlay.drone'
import { BackgroundDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/background/background.drone'
import { ShortcutSheetDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/shortcut-sheet.drone'
import { CommandPaletteDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/command-palette.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/commands/slash-command.drone'
import { AvatarSwarmDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/avatars/avatar-swarm.drone'
import { ClipboardService } from '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/clipboard.service'
import { ClipboardWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/clipboard.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/image-paste.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/claude-bridge.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/atomize.drone'
import { HelpQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/help.queen'
import { KeywordQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/keyword.queen'
import { DebugQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/debug.queen'
import { PixiDebugDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/pixi-debug.drone'
import { PinchZoomInput } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/pinch-zoom.input'
import { TouchGestureCoordinator } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/touch/touch-gesture.coordinator'
import { HiveMeetingDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/meeting/hive-meeting.drone'
import { MeetingVideoDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/meeting/meeting-video.drone'
import { MeetingControlsWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/meeting/meeting-controls.worker'
import { HypercombMeetingDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/meeting/meeting.drone'
import { MeetingQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/meeting/meeting.queen'

const _deps = [
  AxialService,
  PanningDrone,
  PixiHostWorker,
  ShowCellDrone,
  MousewheelZoomInput,
  NostrMeshDrone,
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
  KeywordQueenBee,
  DebugQueenBee,
  PixiDebugDrone,
  PinchZoomInput,
  TouchGestureCoordinator,
  HiveMeetingDrone,
  MeetingVideoDrone,
  MeetingControlsWorker,
  HypercombMeetingDrone,
  MeetingQueenBee,
]

void _deps

@Component({
  selector: 'app-root',
  imports: [ControlsBarComponent, MeshHeaderComponent, RouterOutlet, CommandLineComponent, TileEditorComponent, ShortcutSheetComponent, CommandPaletteComponent, PortalOverlayComponent, ActivityLogComponent, SensitivityBarComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App {
  protected readonly title = signal('hypercomb-dev');

  public readonly meshPublic = signal(
    localStorage.getItem('hc:mesh-public') === 'true' ? true
    : false // default: solo mode
  );
  public readonly secretOpen = signal(false);
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

    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: pub }) => {
      this.meshPublic.set(pub)
    })

    queueMicrotask(() => {
      void this.#runtimeReady.then(() => {
        // push stored preference to the mesh
        const stored = localStorage.getItem('hc:mesh-public')
        if (stored !== null) {
          const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
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
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any;

    const next = !this.meshPublic();
    this.meshPublic.set(next);
    localStorage.setItem('hc:mesh-public', String(next))
    mesh?.setNetworkEnabled?.(next, true);
    EffectBus.emit('mesh:public-changed', { public: next })
  }

  private readonly startRegisteredBees = async (): Promise<void> => {
    // console.log('[core-adapter] ioc keys:', list())

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
