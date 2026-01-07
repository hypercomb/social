// src/app/app.component.ts

import {
  Component,
  computed,
  CUSTOM_ELEMENTS_SCHEMA,
  HostListener,
  inject,
  OnInit
} from '@angular/core'
import { environment } from 'src/environments/environment'

import { ControlsComponent } from './common/footer-controls/controls.component'
import { HeaderBarComponent } from './common/header/header-bar.component'
import { HelpPageComponent } from './common/header/help-page/help-page.component'
import { ShortcutsPageComponent } from './common/header/shortcuts-page/shortcuts-page.component'
import { YoutubeViewerComponent } from './common/media/view-youtube/youtube-viewer.component'
import { OpfsFileExplorerComponent } from './common/opfs/file-explorer/opfs-file-explorer.component'
import { ShellComponent } from './common/shell/shell.component'
import { TileEditorComponent } from './common/tile-editor/tile-editor.component'
import { EmptyHoneycombComponent } from './common/overlays/empty-honeycomb/empty-honeycomb.component'

import { CustomCursorDirective } from './core/directives/custom-cursor-directive'
import { GhostTileDirective } from './cells/creation/ghost-tile-directive'

import { Hypercomb } from './core/mixins/abstraction/hypercomb.base'
import { POLICY } from './core/models/enumerations'
import { EditorService } from './state/interactivity/editor-service'
import { CoordinateDetector } from './helper/detection/coordinate-detector'
import { Events } from './helper/events/events'
import { HONEYCOMB_STORE } from './shared/tokens/i-honeycomb-store.token'
import { SELECTIONS } from './shared/tokens/i-selection.token'
import { InteractionState } from './interactivity/interaction.state'
import { PhotoState } from './state/feature/photo-state'

@Component({
  standalone: true,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    ControlsComponent,
    HeaderBarComponent,
    HelpPageComponent,
    ShortcutsPageComponent,
    YoutubeViewerComponent,
    OpfsFileExplorerComponent,
    TileEditorComponent,
    ShellComponent,
    EmptyHoneycombComponent,
    CustomCursorDirective,
    GhostTileDirective
  ]
})
export class AppComponent extends Hypercomb implements OnInit {

  private readonly store = inject(HONEYCOMB_STORE)
  private readonly selections = inject(SELECTIONS)
  private readonly es = inject(EditorService)
  private readonly photoState = inject(PhotoState)

  public readonly detector = inject(CoordinateDetector)

  public readonly interaction = computed<InteractionState>(() => {
    const inEditor = this.es.isEditing()
    const photoActive = !!this.photoState.imageUrl

    return {
      appMode: inEditor
        ? { kind: 'editor' }
        : photoActive
          ? { kind: 'viewer' }
          : { kind: 'world' },

      viewer: {
        active: photoActive,
        type: photoActive ? 'photo' : null
      },

      keyboardFocus: inEditor
        ? { kind: 'text', targetId: 'editor' }
        : { kind: 'shortcuts' },

      conditions: {
        snap: true,
        grid: true,
        debug: !environment.production
      },

      world: {
        gesture: { kind: 'idle' },
        camera: { x: 0, y: 0, zoom: 1 }
      },

      editor: {
        tool: { kind: 'select' },
        gesture: { kind: 'idle' },
        camera: { x: 0, y: 0, zoom: 1 }
      },

      selection: {
        active: this.selections.canSelect()
      }
    }
  })

  public readonly hasCells = computed(() =>
    this.store.hasCells()
  )

  public get loading(): boolean {
    return this.state.loading
  }

  public get json(): any {
    return environment.production
      ? ''
      : (localStorage.getItem('allowDebug')
        ? this.state.debugJson
        : '')
  }

  async ngOnInit() {
    this.policy.registerSignal(
      POLICY.CommbandModeActive,
      computed(() => false),
      this.injector
    )
  }

  @HostListener(`document:${Events.NotifyLocked}`, ['$event'])
  public notifyLockedHandler() {
  }
}
