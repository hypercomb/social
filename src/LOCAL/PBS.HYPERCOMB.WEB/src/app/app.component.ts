import { Component, computed, CUSTOM_ELEMENTS_SCHEMA, HostListener, inject, OnInit } from '@angular/core'
import { environment } from 'src/environments/environment'
import { CarouselMenuComponent } from './common/carousel-menu/carousel-menu.component'
import { ChatWindowComponent } from './common/chat-window/chat-window.component'
import { ControlsComponent } from './common/footer-controls/controls.component'
import { HeaderBarComponent } from './common/header/header-bar/header-bar.component'
import { HelpPageComponent } from './common/header/help-page/help-page.component'
import { YoutubeViewerComponent } from './common/media/view-youtube/youtube-viewer.component'
import { ShellComponent } from './common/shell/shell.component'
import { TileEditorComponent } from './common/tile-editor/tile-editor.component'
import { CustomCursorDirective } from './core/directives/custom-cursor-directive'
import { HypercombMode, POLICY } from './core/models/enumerations'
import { CoordinateDetector } from './helper/detection/coordinate-detector'
import { EditorService } from './state/interactivity/editor-service'
import { Events } from './helper/events/events'
import { Hypercomb } from './core/mixins/abstraction/hypercomb.base'
import { HONEYCOMB_STORE } from './shared/tokens/i-comb-store.token'
import { SELECTIONS } from './shared/tokens/i-selection.token'
import { OpfsFileExplorerComponent } from './common/opfs/file-explorer/opfs-file-explorer.component'
import { SampleDataLoaderService } from './database/sample-data-loader.service'
import { GhostTileDirective } from "./cells/creation/ghost-tile-directive"
import { EmptyHoneycombComponent } from './common/overlays/empty-honeycomb/empty-honeycomb.component'

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CarouselMenuComponent,
    ChatWindowComponent,
    // ConfirmDeleteDialogComponent,
    ControlsComponent,
    CustomCursorDirective,
    EmptyHoneycombComponent,
    HeaderBarComponent,
    HelpPageComponent,
    // JsonViewerComponent,
    // LoadingOverlayComponent,
    // PhotoViewerComponent,
    // ShowOpfsImagesComponent,
    TileEditorComponent,
    OpfsFileExplorerComponent,
    ShellComponent,
    YoutubeViewerComponent,
    OpfsFileExplorerComponent,
    GhostTileDirective
]
})
export class AppComponent extends Hypercomb implements OnInit {

  private readonly store = inject(HONEYCOMB_STORE)
  public readonly detector = inject(CoordinateDetector)
  public readonly es = inject(EditorService)
  private readonly selections = inject(SELECTIONS)
  private readonly sampleDataLoader = inject(SampleDataLoaderService)
  public readonly isYoutubeViewerActive = computed(() =>
    (this.state.mode() & HypercombMode.YoutubeViewer) === HypercombMode.YoutubeViewer
  )
  public readonly isSelectionMode = computed(() => this.selections.canSelect())

  // === non-mode fields you already use ===
  public NewHive: HypercombMode = HypercombMode.HiveCreation
  public notifyLocked = false
  public notifyLockTimeout = 400
  public title = 'app'

  public hasCells = computed(() => {
    const comb = this.stack.top()!
    if (!comb) return false

    const has = this.store.hasCells()
    return has
  })

  // keep cheap getters that delegate to HypercombState
  public get body(): any { return document.body }
  public get isNewHiveMode(): boolean { return this.state.hasMode(HypercombMode.HiveCreation) }
  public get json(): any { return environment.production ? '' : (localStorage.getItem('allowDebug') ? this.state.debugJson : '') }
  public get loading(): boolean { return this.state.loading }
  public get isChatWindowMode(): boolean { return this.state.isChatWindowMode }
  public get isHelpPageActive(): boolean { return this.state.hasMode(HypercombMode.ViewHelp) }
  public get isShortcutPageActive(): boolean { return this.state.hasMode(HypercombMode.ShowPreferences) }
  public get isShowingGoogleDocument(): boolean { return this.state.hasMode(HypercombMode.ViewingGoogleDocument) }
  public get isPromptModeActive(): boolean { return this.state.hasMode(HypercombMode.AiPrompt) }
  public get isPhotoViewerActive(): boolean { return this.state.hasMode(HypercombMode.ViewingPhoto) }
  public get isOpfsMode(): boolean { return this.state.hasMode(HypercombMode.OpfsFileExplorer) }

  async ngOnInit() {
    await this.sampleDataLoader.loadSampleDataIfNeeded();

    // Register CommandModeBlockOpenLink policy: true if any command mode is active
    this.policy.registerSignal(
      POLICY.CommbandModeActive,
      computed(() => (this.state.mode() & HypercombMode.CommandModes) !== 0),
      this.injector
    );

    // this.oidc.checkAuth().subscribe({
    //   next: async ({ isAuthenticated, userData }) => {
    //     this.state.autstate.set({ isAuthenticated, ...userData })
    //     if (!isAuthenticated) return

    //     try {
    //       this.oidc.getAccessToken().subscribe({
    //         next: async (token) => {
    //           this.debug.log('auth', 'user:', userData)
    //           this.debug.log('auth', 'token:', token)

    //           const returnUrl = localStorage.getItem('returnUrl') || '/'
    //           localStorage.removeItem('returnUrl')

    //           await this.hive_service.changeLocation(returnUrl).then(() => {
    //             this.events.cancelEvent({})
    //           })
    //         },
    //         error: (error) => {
    //           console.error('Error occurred while getting access token:', error)
    //         }
    //       })
    //     } catch (error) {
    //       // swallow or log if you prefer
    //     }
    //   },
    //   error: (err) => {
    //     console.error('Auth check failed:', err)
    //   }
    // })
  }

  @HostListener(`document:${Events.NotifyLocked}`, ['$event'])
  public notifyLockedHandler() {
    this.notifyLocked = true
    setTimeout(() => (this.notifyLocked = false), this.notifyLockTimeout)
  }
}


