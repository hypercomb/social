import { Component, computed, effect, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { environment } from 'src/environments/environment'
import { IconMenuComponent } from './icon-menu/icon-menu.component'
import { TileCountComponent } from './tile-count/tile-count.component'
import { SearchBoxComponent } from './search-box/search-box.component'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { CoordinateDetector } from 'src/app/helper/detection/coordinate-detector'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { TouchDetectionService } from 'src/app/core/mobile/touch-detection-service'
import { HONEYCOMB_SVC } from 'src/app/shared/tokens/i-honeycomb-service.token'
import { HONEYCOMB_STORE } from 'src/app/shared/tokens/i-honeycomb-store.token'
import { CellEditor } from 'src/app/common/tile-editor/cell-editor'
import { CellEditContext } from 'src/app/state/interactivity/cell-edit-context'
import { ScreenService } from 'src/app/services/screen-service'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'

@Component({
  standalone: true,
  selector: '[app-header-bar]',
  templateUrl: './header-bar.component.html',
  styleUrls: ['./header-bar.component.scss'],
  imports: [TileCountComponent, SearchBoxComponent, IconMenuComponent, FormsModule],
})
export class HeaderBarComponent extends Hypercomb {

  private readonly es = inject(EditorService)
  private readonly manager = inject(CellEditor)
  private readonly navigation = inject(LinkNavigationService)
  private readonly screen = inject(ScreenService)
  private readonly _Hypercomb = 'Hypercomb'
  public readonly detector = inject(CoordinateDetector)
  public readonly touch = inject(TouchDetectionService)
  public readonly store = inject(HONEYCOMB_STORE)
  public readonly cellstate = inject(HONEYCOMB_SVC)

  public readonly name = computed(() => {
    const cell = this.stack.cell()
    if (!cell) return this._Hypercomb

    return cell?.name || this._Hypercomb
  })

  public showEdit = false
  public isHovered = false
  public isSignedIn = false
  public userName = 'Sign In'

  // derived signals
  public readonly isHelpPageActive = computed(() => this.state.hasMode(HypercombMode.ViewHelp))
  public readonly isEditingCaption = computed(() => this.state.hasMode(HypercombMode.EditingCaption))

  public readonly link = computed(() => environment.production ? this.ls.link : this.ls.information)
  public readonly isDoubleClickIconAllowed = computed(() =>
    !this.es.isEditing() &&
    !this.screen.isFullScreen()
  )

  public readonly isTabEditAllowed = computed(() =>
    !this.es.isEditing() &&
    !this.screen.isFullScreen()
  )

  public caption = computed(() => {
    const coordinate = this.detector.coordinate()
    const tile = this.detector.activeTile()
    if (!coordinate) return this.state.hive()

    // lookup cell name if tile is present, otherwise fall back to coordinate only
    const cell = tile ? this.store.lookupData(tile.cellId) : undefined
    const name = cell?.name ?? this.state.hive()

    return `${name}`
    // return `${name}  ${environment.production ? '' : coordinate.index}`// | index: ${coordinate.index} : ${coordinate.Location}`
  })

  constructor() {
    super()

    effect(() => {
      const ev = this.ks.keyUp()
      if (!ev) return

      if (this.ks.when(ev).key('i', { alt: true, ctrl: false, shift: false })) {
        ev.preventDefault()
        ev.stopPropagation()
        this.state.toggleToolMode(HypercombMode.ShowChat)
      }
    })
  }

  public readonly cellCount = computed(() => this.detector.activeCell()?.childCount || 0)
  public readonly showCount = computed(() => this.cellCount() > 0)
  public readonly iconsVisible = computed(() =>
    !this.screen.isFullScreen() || !this.touch.supportsEdit()
  )

  public openLink() {
    const cell = this.detector.activeCell()
    this.navigation.openLink(cell)
  }

  public cancel(_: any) {
    this.manager.cancel()
  }

  public edit(_: any) {
    const cell = this.stack.cell()!
    const context = new CellEditContext(cell)
    this.manager.beginEditing(context)
  }

  public onFocusChanged(focused: boolean) {
    if (focused) {
      this.state.setMode(HypercombMode.Filtering)
    } else {
      this.state.removeMode(HypercombMode.Filtering)
    }
  }

  public onHover = (state: boolean) => {
    this.isHovered = state
  }

  public save = async (_: MouseEvent) => {
    this.showEdit = false
    this.state.removeMode(HypercombMode.EditingCaption)
  }
  
}


