import { Component, computed, effect, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Preferences } from 'src/app/unsorted/preferences'
import { environment } from 'src/environments/environment'
import { FocusWatcherDirective } from '../focus-watcher'
import { IconMenuComponent } from '../icon-menu/icon-menu.component'
import { SearchFilterService } from './search-filter-service'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { HypercombMode, POLICY } from 'src/app/core/models/enumerations'
import { CoordinateDetector } from 'src/app/helper/detection/coordinate-detector'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { HexagonEditManager } from 'src/app/unsorted/hexagons/hexagon-edit-manager'
import { TouchDetectionService } from 'src/app/unsorted/mobile/touch-detection-service'
import { ScreenService } from 'src/app/unsorted/utility/screen-service'
import { COMB_SERVICE } from 'src/app/shared/tokens/i-comb-service.token'
import { COMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'

@Component({
  standalone: true,
  selector: '[app-header-bar]',
  templateUrl: './header-bar.component.html',
  styleUrls: ['./header-bar.component.scss'],
  imports: [IconMenuComponent, FocusWatcherDirective, FormsModule],
})
export class HeaderBarComponent extends HypercombData {
  private readonly es = inject(EditorService)
  private readonly manager = inject(HexagonEditManager)
  private readonly navigation = inject(LinkNavigationService)
  private readonly preferences = inject(Preferences)
  private readonly screen = inject(ScreenService)
  private readonly search = inject(SearchFilterService)
  public readonly detector = inject(CoordinateDetector)
  public readonly touch = inject(TouchDetectionService)
  public readonly store = inject(COMB_STORE)
  public readonly cellstate = inject(COMB_SERVICE)


  public readonly name = computed(() => {
    const cell = this.stack.cell()
    if (!cell) return this._Hypercomb

    return cell?.name || this._Hypercomb
  })

  public showEdit = false
  public isHovered = false
  public searchFilter: string = ''
  public isSignedIn = false
  public userName = 'Sign In'

  // derived signals
  public readonly isHelpPageActive = computed(() => this.state.hasMode(HypercombMode.ViewHelp))
  public readonly isEditingCaption = computed(() => this.state.hasMode(HypercombMode.EditingCaption))
  public readonly link = computed(() => environment.production ? this.ls.link : this.ls.information)
  public readonly isDoubleClickIconAllowed = computed(() =>
    this.preferences.showDoubleClickIcon &&
    !this.es.isEditing() &&
    !this.screen.isFullScreen()
  )
  public readonly isTabEditAllowed = computed(() =>
    this.preferences.showTabEditIcon &&
    !this.es.isEditing() &&
    !this.screen.isFullScreen()
  )

  public caption = computed(() => {
    const coordinate = this.detector.coordinate()
    const tile = this.detector.activeTile()
    if (!coordinate) return 'Hypercomb'

    // lookup cell name if tile is present, otherwise fall back to coordinate only
    const cell = tile ? this.store.lookupData(tile.cellId) : undefined
    const name = cell?.name ?? 'Hypercomb'

    return `${name} index: ${coordinate.index} : ${coordinate.Location}`
  })



  public readonly cellCount = computed(() => this.stack.size())
  public readonly showCount = computed(() => this.cellCount()> 0)
  public readonly iconsVisible = computed(() =>
    !this.screen.isFullScreen() || !this.touch.supportsEdit()
  )

  private readonly _isCaptionBlocked = this.policy.any(POLICY.EditInProgress)

  private readonly _Hypercomb = 'Hypercomb'

  // store effects in private readonly fields
  private readonly _filterEffect = effect(() => {
    const text = this.search.value().toLowerCase()
    this.searchFilter = text
  })

  private readonly _keyboardEffect = effect(() => {
    const ev = this.ks.keyUp()
    if (!ev) return

    if (this.ks.when(ev).key('i', { alt: true, ctrl: false, shift: false })) {
      ev.preventDefault()
      ev.stopPropagation()
      this.state.toggleToolMode(HypercombMode.ShowChat)
    }
  })

  public openLink() {
    this.navigation.openLink()
  }

  public cancel(_: any) {
    this.manager.cancel()
  }

  public edit(_: any) {
    const entry = this.stack.top()!
    const cell = entry?.cell!
    this.manager.beginEditing(cell)
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

  public onSearchTextChange(value: string) {
    this.search.set(value)
  }

  public save = async (_: MouseEvent) => {
    this.showEdit = false
    this.state.removeMode(HypercombMode.EditingCaption)
  }
}


