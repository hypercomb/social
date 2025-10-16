import { Component, computed, effect, HostListener, inject, OnInit } from '@angular/core'
import { debounced } from '../debounce-service'
import { SearchFilterService } from '../header/header-bar/search-filter-service'
import { CarouselItemComponent } from './carousel-item/carousel-item.component'
import { DataServiceBase } from 'src/app/actions/service-base-classes'
import { simplify } from 'src/app/shared/services/name-simplifier'
import { HIVE_STATE } from 'src/app/shared/tokens/i-hive-store.token'
import { WheelState } from '../mouse/wheel-state'
import { environment } from 'src/environments/environment'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { CarouselService } from './carousel-service'
import { IDexieHive } from 'src/app/hive/hive-models'
import { HiveLoader } from 'src/app/hive/name-resolvers/hive-loader'
import { ExportDatabaseAction } from 'src/app/actions/propagation/export-database'
import { ACTION_REGISTRY } from 'src/app/shared/tokens/i-hypercomb.token'

@Component({
  standalone: true,
  selector: '[app-carousel-menu]',
  templateUrl: './carousel-menu.component.html',
  styleUrls: ['./carousel-menu.component.scss'],
  imports: [CarouselItemComponent],
})
export class CarouselMenuComponent extends DataServiceBase implements OnInit {
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly coordinator = inject(HiveLoader)
  private readonly filter = inject(SearchFilterService)
  private readonly editor = inject(EditorService)
  private readonly hivestate = inject(HIVE_STATE)
  private readonly debouncedFilter = debounced(() => this.filter.value(), 300)
  private readonly wheelState = inject(WheelState)
  private readonly carousel = inject(CarouselService)

  public current = computed(() => this.carousel.current())
  public searchValue = ''
  public upper: IDexieHive[] = []
  public lower: IDexieHive[] = []
  public jumpTo = (name: string): void => this.carousel.jumpTo(name)
  public middleTile!: IDexieHive

  private lastPulse = 0
  private wheelLocked = false

  ngOnInit() {
    this.updateTileLimit()
  }
  @HostListener('window:resize')
  onResize() {
    this.updateTileLimit()
  }

  constructor() {
    super()

    let initialized = false

    // initial load set the items
    effect(() => {
      const items = this.hivestate.items()
      if (initialized || items.length === 0) return

      this.carousel.setItems(items)
      this.updateMenu()
      initialized = true
    })

    // wheel scroll logic
    effect(() => {
      const pulse = this.wheelState.pulse()
      if (pulse === 0 || pulse === this.lastPulse || this.wheelLocked) return

      // throttle: ignore scrolls that happen too fast
      const now = performance.now()
      if (now - this.lastPulse < 150) return // 150ms between scroll actions

      this.lastPulse = now
      this.wheelLocked = true

      const dir = this.wheelState.deltaY > 0 ? 1 : -1
      const run = async () => {
        if (dir > 0) {
          await this.cycleBackward()
        } else {
          await this.cycleForward()
        }
        // small unlock delay to avoid double pulses
        setTimeout(() => (this.wheelLocked = false), 100)
      }

      void run()
    })


    // search filter clears
    effect(() => void this.debouncedFilter())

    let last = ''
    // initialize index from scout
    effect(() => {
      void (async () => {
        const hiveName = this.state.scout()?.name
        if (!hiveName || last === hiveName) return
          last = hiveName
        this.carousel.setHive(hiveName)
        this.updateMenu()
        this.wheelLocked = false  
      })()
    })

    // debug
    if (!environment.production) {
      effect(() => console.log('current hive:', this.current()?.name ?? '(none)'))
    }
  }

  public isAllowed = computed(() => this.hivestate.items().length > 1 && !this.editor.isEditing())

  public isVisibile = computed(() => !this.editor.isEditing())

  private async applyHeadChange() {
    if (!this.current()) return
    await this.changeHive()
    this.updateMenu()
  }

  public cycleForward = async () => {
    console.log(this.isAllowed())
    this.carousel.next() // <-- should be next, not previous
    await this.applyHeadChange()
  }

  public cycleBackward = async () => {
    if (!this.isAllowed()) return
    this.carousel.previous() // <-- should be previous, not next
    await this.applyHeadChange()
  }

  // change by name → rotate, then change hive
  public changeHiveByName = (hiveName: string) => {
    if (!hiveName) return
    this.carousel.jumpTo(hiveName)
  }

  public changeHive = async () => {

    this.filter.clear()
    const hiveName = this.current()?.name
    if (!hiveName) return

    await this.registry.invoke(ExportDatabaseAction.ActionId, {}) // auto-export current hive before switching

    const realm = await this.coordinator.resolve(hiveName)

    if (!realm) throw new Error(`Failed to resolve hive: ${hiveName}`)

    const [baseName, fragment] = hiveName.split('#')
    const url = `/${baseName}${fragment ? `#${fragment}` : ''}` // define url
    this.carousel.jumpTo(url) // update carousel state

    this.updateMenu()
  }

  private updateMenu() {
    const current = this.carousel.current()
    const items = this.hivestate.items()

    if (!current) {
      this.middleTile = items[0] // fallback if list is empty, or skip rendering in template

      this.upper = []
      this.lower = []
      return
    }

    this.middleTile = current

    this.upper = this.carousel.upper()
    console.log(this.carousel.upper())
    this.lower = this.carousel.lower()
  }

  private updateTileLimit() {
    const windowHeight = window.innerHeight - 90 // for header and footer 
    console.log(window.innerHeight)
    const tileHeight = 72 // 4.6 em with gap plus tile height

    // number of tiles that fit above OR below the middle
    const tilesPerSide = Math.floor(((windowHeight / 2) - 65.5) / tileHeight) // minus the middle tile 

    console.log(tilesPerSide)

    this.carousel.setTileLimit(tilesPerSide)
  }

  private findTargetHiveIndex = async (target: string): Promise<number> => {
    const list = this.hivestate.items()
    for (let i = 0; i < list.length; i++) {
      const normalized = await simplify(list[i].name)
      if (normalized === target) return i
    }
    return -1
  }
}

