import { Component, computed, effect, HostListener, inject, OnInit } from '@angular/core'
import { NgIf, NgForOf } from '@angular/common'
import { debounced } from '../debounce-service'
import { SearchFilterService } from '../header/header-bar/search-filter-service'
import { CarouselItemComponent } from './carousel-item/carousel-item.component'
import { HypercombData } from 'src/app/actions/hypercomb-data'
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
import { COMB_STORE } from 'src/app/shared/tokens/i-comb-store.token'
import { PassiveTextureStreamer } from 'src/app/hive/rendering/passive-texture-steamer'

@Component({
  standalone: true,
  selector: '[app-carousel-menu]',
  templateUrl: './carousel-menu.component.html',
  styleUrls: ['./carousel-menu.component.scss'],
  imports: [CarouselItemComponent, NgIf, NgForOf],
})
export class CarouselMenuComponent extends HypercombData implements OnInit {
  private readonly comb = {
    store: inject(COMB_STORE)
  }
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly coordinator = inject(HiveLoader)
  private readonly filter = inject(SearchFilterService)
  private readonly editor = inject(EditorService)
  private readonly hivestate = inject(HIVE_STATE)
  private readonly wheelState = inject(WheelState)
  private readonly carousel = inject(CarouselService)
  private readonly debouncedFilter = debounced(() => this.filter.value(), 300)
  // private readonly textureStream = inject(PassiveTextureStreamer)

  public current = computed(() => this.carousel.current())
  public searchValue = ''
  // ─────────────────────────────────────────────
  // derived signals
  // ─────────────────────────────────────────────
  public readonly isAllowed = computed(() => this.hivestate.items().length > 1 && !this.editor.isEditing())
  public readonly isVisible = computed(() => !this.editor.isEditing())

  public upper: IDexieHive[] = []
  public lower: IDexieHive[] = []
  public middleTile!: IDexieHive
  public jumpTo = (name: string): void => this.carousel.jumpTo(name)

  private wheelLocked = false
  private lastPulse = 0

  // ─────────────────────────────────────────────
  // lifecycle
  // ─────────────────────────────────────────────
  constructor() {
    super()
    let initialized = false
    effect(() => {
      const items = this.hivestate.items()
      if (initialized || items.length === 0) return

      this.carousel.setItems(items)
      this.updateMenu()
      initialized = true

      // 🐝 preload textures for the first hive
      // console.debug('[CarouselMenu] starting initial passive texture stream')
      // void this.textureStream.streamForCarousel({
      //   current: this.current()!,
      //   upper: this.carousel.upper(),
      //   lower: this.carousel.lower()
      // })
    })

    this.initializeWheelControl()
    this.initializeFilterWatcher()
    this.initializeScoutWatcher()
    if (!environment.production) this.debugWatchCurrentHive()
  }

  ngOnInit(): void {
    this.updateTileLimit()
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateTileLimit()
  }


  private initializeWheelControl(): void {
    effect(() => {
      const pulse = this.wheelState.pulse()
      if (pulse === 0 || pulse === this.lastPulse || this.wheelLocked) return

      const now = performance.now()
      if (now - this.lastPulse < 150) return // throttle
      this.lastPulse = now
      this.wheelLocked = true

      const dir = this.wheelState.deltaY > 0 ? 1 : -1
      void (dir > 0 ? this.cycleBackward() : this.cycleForward())

      // unlock after a small delay
      setTimeout(() => (this.wheelLocked = false), 100)
    })
  }

  private initializeFilterWatcher(): void {
    effect(() => void this.debouncedFilter())
  }

  private initializeScoutWatcher(): void {
    let lastHive = ''
    effect(() => {
      const hiveName = this.state.scout()?.name
      if (!hiveName || lastHive === hiveName) return
      lastHive = hiveName
      this.carousel.setHive(hiveName)
      this.updateMenu()
      this.wheelLocked = false
    })
  }

  private debugWatchCurrentHive(): void {
    effect(() => console.log('current hive:', this.current()?.name ?? '(none)'))
  }


  // ─────────────────────────────────────────────
  // navigation
  // ─────────────────────────────────────────────
  private async applyHeadChange(): Promise<void> {
    if (!this.current()) return

    await this.changeHive()
    this.updateMenu()

    // 🐝  DON'T AWAIT - passive preload for current + neighbors
    // void this.textureStream.streamForCarousel({
    //   current: this.current()!,
    //   upper: this.carousel.upper(),
    //   lower: this.carousel.lower()
    // })
  }


  public changeHiveByName = (hiveName: string): void => {
    if (!hiveName) return
    this.carousel.setHive(hiveName)   // ensures selected hive moves to head
  }


  public cycleForward = async (): Promise<void> => {
    if (!this.isAllowed()) return
    this.carousel.next()
    await this.applyHeadChange()
  }

  public cycleBackward = async (): Promise<void> => {
    if (!this.isAllowed()) return
    this.carousel.previous()
    await this.applyHeadChange()
  }

  public async changeHive(): Promise<void> {
    this.filter.clear()
    const hiveName = this.current()?.name
    if (!hiveName) return

    await this.registry.invoke(ExportDatabaseAction.ActionId, {})

    const realm = await this.coordinator.resolve(hiveName)
    if (!realm) throw new Error(`Failed to resolve hive: ${hiveName}`)

    const [baseName, fragment] = hiveName.split('#')
    const url = `/${baseName}${fragment ? `#${fragment}` : ''}`
    this.carousel.jumpTo(url)
    this.updateMenu()
  }

  // ─────────────────────────────────────────────
  // layout
  // ─────────────────────────────────────────────
  private updateMenu(): void {
    const current = this.carousel.current()
    const items = this.hivestate.items()

    if (!current) {
      this.middleTile = items[0]
      this.upper = []
      this.lower = []
      return
    }

    this.middleTile = current
    this.upper = this.carousel.upper()
    this.lower = this.carousel.lower()
    console.debug('[CarouselMenu] updateMenu:', { current: this.middleTile?.name, upper: this.upper?.length, lower: this.lower?.length })
  }

  public trackByName(index: number, item: IDexieHive): string {
    return item?.name ?? index.toString()
  }

  private updateTileLimit(): void {
    const windowHeight = window.innerHeight - 90
    const tileHeight = 72
    const tilesPerSide = Math.floor(((windowHeight / 2) - 65.5) / tileHeight)
    this.carousel.setTileLimit(tilesPerSide)
  }

  private async findTargetHiveIndex(target: string): Promise<number> {
    const list = this.hivestate.items()
    for (let i = 0; i < list.length; i++) {
      const normalized = await simplify(list[i].name)
      if (normalized === target) return i
    }
    return -1
  }
}
