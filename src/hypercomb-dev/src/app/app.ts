import { AfterViewInit, Component, HostBinding, ViewChild, signal } from '@angular/core';
import { type Bee, EffectBus } from '@hypercomb/core';
import type { HexOrientation } from '@hypercomb/essentials/diamondcoreprocessor.com/preferences/settings';
import { RouterOutlet } from '@angular/router';
import { CommandLineComponent } from '@hypercomb/shared';
import { MeshHeaderComponent } from '@hypercomb/shared/ui';
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
import { HistoryCursorService } from '@hypercomb/essentials/diamondcoreprocessor.com/history/history-cursor.service'
import { HistorySliderDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/history/history-slider.drone'
import { TileEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'
import { TileEditorDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.drone'
import { ImageEditorService } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-editor.service'
import { KeyMapService } from '@hypercomb/essentials/diamondcoreprocessor.com/keyboard/keymap.service'
import { SelectionService } from '@hypercomb/essentials/diamondcoreprocessor.com/selection/selection.service'
import '@hypercomb/essentials/diamondcoreprocessor.com/selection/tile-selection.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/keyboard/escape-cascade'
import '@hypercomb/essentials/diamondcoreprocessor.com/navigation/bee-toggle'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'
import { AudioPlayerComponent } from '@hypercomb/shared/ui/audio-player/audio-player.component'
import { ControlsBarComponent, ShortcutSheetComponent, CommandPaletteComponent, ActivityLogComponent, SelectionContextMenuComponent, AtomizerBarComponent, AtomizerSidebarComponent, ConfirmDialogComponent, ToastComponent, InstructionOverlayComponent, DocsOverlayComponent } from '@hypercomb/shared/ui';
import { FormatPainterComponent } from '@hypercomb/shared/ui/format-painter/format-painter.component'
import { PortalOverlayComponent } from '@hypercomb/shared/ui/portal/portal-overlay.component'
import { SensitivityBarComponent } from '@hypercomb/shared/ui/sensitivity-bar/sensitivity-bar.component'
import { YoutubeViewerComponent } from '@hypercomb/shared/ui/youtube-viewer/youtube-viewer.component'
import { LayoutService } from '@hypercomb/essentials/diamondcoreprocessor.com/move/layout.service'
import { MoveDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/move/move.drone'
import { DesktopMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/move/desktop-move.input'
import { TouchMoveInput } from '@hypercomb/essentials/diamondcoreprocessor.com/move/touch-move.input'
import { MovePreviewDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/tiles/move-preview.drone'
import { BackgroundDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/background/background.drone'
import { ShortcutSheetDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/shortcut-sheet.drone'
import { CommandPaletteDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/command-palette.drone'
import { ToastDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/toast.drone'
import { InstructionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/instructions/instruction.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/commands/slash-behaviour.drone'
import { AvatarSwarmDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/presentation/avatars/avatar-swarm.drone'
import { ClipboardService } from '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/clipboard.service'
import { ClipboardWorker } from '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/clipboard.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/clipboard/image-paste.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/editor/image-drop.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/claude-bridge.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/atomize.drone'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/atomizer-drop.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/input.atomizer'
import '@hypercomb/shared/ui/command-line/command-line.atomizer'
import '@hypercomb/essentials/diamondcoreprocessor.com/safety/link-safety.service'
import '@hypercomb/essentials/diamondcoreprocessor.com/link/link-drop.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/link/photo.view'
import '@hypercomb/essentials/diamondcoreprocessor.com/link/link-open.worker'
import '@hypercomb/essentials/diamondcoreprocessor.com/assistant/llm.queen'
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
import { RemoveQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/remove.queen'
import { FormatQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/format/format.queen'
import { FormatPainterDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/format/format-painter.drone'
import { LanguageQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/language.queen'
import { LayoutQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/move/layout.queen'
import { ArrangeQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/arrange.queen'
import { AccentQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/accent.queen'
import { RenameQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/commands/rename.queen'
import { ConversationQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/assistant/conversation.queen'
import { ReviseQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/history/revise.queen'
import { FitQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/navigation/zoom/fit.queen'
import { SubstrateQueenBee } from '@hypercomb/essentials/diamondcoreprocessor.com/substrate/substrate.queen'
import { SubstrateDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/substrate/substrate.drone'
import { SubstrateService } from '@hypercomb/essentials/diamondcoreprocessor.com/substrate/substrate.service'
import { TileLinkActionDrone } from '@hypercomb/essentials/diamondcoreprocessor.com/link/tile-link-action.drone'

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
  HistoryCursorService,
  HistorySliderDrone,
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
  RemoveQueenBee,
  FormatQueenBee,
  FormatPainterDrone,
  LanguageQueenBee,
  LayoutQueenBee,
  ArrangeQueenBee,
  AccentQueenBee,
  RenameQueenBee,
  ConversationQueenBee,
  ReviseQueenBee,
  FitQueenBee,
  SubstrateQueenBee,
  SubstrateDrone,
  SubstrateService,
  TileLinkActionDrone,
  ToastDrone,
  InstructionDrone,
]

void _deps

@Component({
  selector: 'app-root',
  imports: [ControlsBarComponent, MeshHeaderComponent, RouterOutlet, CommandLineComponent, TileEditorComponent, ShortcutSheetComponent, CommandPaletteComponent, PortalOverlayComponent, ActivityLogComponent, SensitivityBarComponent, SelectionContextMenuComponent, FormatPainterComponent, YoutubeViewerComponent, AtomizerBarComponent, AtomizerSidebarComponent, ConfirmDialogComponent, ToastComponent, InstructionOverlayComponent, DocsOverlayComponent, AudioPlayerComponent],
  styleUrls: ['./app.scss'] as any,
  templateUrl: './app.html'
})
export class App implements AfterViewInit {
  protected readonly title = signal('hypercomb-dev');
  readonly clipboardMode = signal(false);
  readonly moveMode = signal(false);
  readonly introPlaying = signal(localStorage.getItem('hc:intro-played') !== 'true');
  readonly introPhase = signal<'speech' | 'interlude' | 'outro'>('speech');

  @ViewChild('speechAudio') speechAudioRef?: AudioPlayerComponent;
  @ViewChild('outroAudio') outroAudioRef?: AudioPlayerComponent;
  #interludeTimer?: ReturnType<typeof setTimeout>;

  @HostBinding('class.clipboard-mode')
  get clipboardModeClass() { return this.clipboardMode(); }

  @HostBinding('class.move-mode')
  get moveModeClass() { return this.moveMode(); }

  @HostBinding('class.intro-active')
  get introActiveClass() { return this.introPlaying(); }

  public readonly meshPublic = signal(
    localStorage.getItem('hc:mesh-public') === 'true' ? true
    : false // default: solo mode
  );
  public readonly secretOpen = signal(false);
  public readonly viewActive = signal(false);
  public readonly orientation = signal<HexOrientation>(
    (localStorage.getItem('hc:hex-orientation') as HexOrientation) || 'point-top'
  );

  constructor() {
    EffectBus.on<{ public: boolean }>('mesh:public-changed', ({ public: pub }) => {
      this.meshPublic.set(pub)
    })

    EffectBus.on<{ active: boolean }>('view:active', ({ active }) => {
      this.viewActive.set(active)
    })

    EffectBus.on<{ active: boolean }>('clipboard:view', ({ active }) => {
      this.clipboardMode.set(active)
    })

    EffectBus.on<{ active: boolean }>('move:mode', ({ active }) => {
      this.moveMode.set(active)
    })

    // Runtime already initialized by main.ts — go straight to bee startup
    queueMicrotask(() => {
      if (localStorage.getItem('hc:mesh-public') === null) {
        localStorage.setItem('hc:mesh-public', 'false')
      }
      const stored = localStorage.getItem('hc:mesh-public')
      if (stored !== null) {
        const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
        mesh?.setNetworkEnabled?.(stored === 'true', true)
      }
      void this.startRegisteredBees()
    })
  }

  ngAfterViewInit(): void {
    // autoplay + gesture fallback is handled inside AudioPlayerComponent
  }

  onSpeechEnded(): void {
    this.enterInterlude();
  }

  skipSpeech(): void {
    this.speechAudioRef?.reset();
    this.enterInterlude();
  }

  skipInterlude(): void {
    this.enterOutro();
  }

  onOutroEnded(): void {
    this.dismissIntro();
  }

  skipOutro(): void {
    this.outroAudioRef?.reset();
    this.dismissIntro();
  }

  startIntroAudio(): void {
    if (this.introPhase() === 'speech') void this.speechAudioRef?.play();
    else if (this.introPhase() === 'outro') void this.outroAudioRef?.play();
  }

  private enterInterlude(): void {
    this.introPhase.set('interlude');
    this.#interludeTimer = setTimeout(() => this.enterOutro(), 2500);
  }

  private enterOutro(): void {
    if (this.#interludeTimer) {
      clearTimeout(this.#interludeTimer);
      this.#interludeTimer = undefined;
    }
    this.introPhase.set('outro');
  }

  private dismissIntro(): void {
    localStorage.setItem('hc:intro-played', 'true');
    this.introPlaying.set(false);
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
    const values = list()
      .map(key => get(key))
      .filter((value): value is Bee => !!value && typeof (value as Bee).pulse === 'function')

    await Promise.allSettled(
      values.map(bee => bee.pulse('').catch(error =>
        console.warn('[app] failed to start bee', bee.constructor?.name, error)
      ))
    )

    window.dispatchEvent(new Event('synchronize'))

    // Dev mode: bees are imported directly, not through ScriptPreloader.
    // Set resourceCount so the command line unlocks.
    const preloader = get('@hypercomb.social/ScriptPreloader') as any
    preloader?.setResourceCount?.(values.length)

    // restore persisted orientation
    if (this.orientation() === 'flat-top') {
      EffectBus.emit('render:set-orientation', { flat: true })
    }

    // broadcast initial mesh state so drones can react
    EffectBus.emit('mesh:public-changed', { public: this.meshPublic() })
  }
}
