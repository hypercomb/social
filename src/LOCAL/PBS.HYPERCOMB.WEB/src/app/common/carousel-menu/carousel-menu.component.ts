import { Component, computed, effect, HostListener, inject, OnInit } from '@angular/core'
import { CarouselItemComponent } from './carousel-item/carousel-item.component'
import { HypercombData } from 'src/app/actions/hypercomb-data'
import { SearchFilter } from '../header/search-filter'
import { HIVE_STATE } from 'src/app/shared/tokens/i-hive-store.token'
import { WheelState } from '../mouse/wheel-state'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { IDexieHive } from 'src/app/hive/hive-models'
import { HiveLoader } from 'src/app/hive/loaders/hive.loader'
import { ExportDatabaseAction } from 'src/app/actions/propagation/export-database'
import { ACTION_REGISTRY, CAROUSEL_SVC } from 'src/app/shared/tokens/i-hypercomb.token'
import { environment } from 'src/environments/environment'
import { HONEYCOMB_STORE } from 'src/app/shared/tokens/i-honeycomb-store.token'

@Component({
  standalone: true,
  selector: '[app-carousel-menu]',
  templateUrl: './carousel-menu.component.html',
  styleUrls: ['./carousel-menu.component.scss'],
  imports: [CarouselItemComponent],
})
export class CarouselMenuComponent extends HypercombData implements OnInit {

  // services
  private readonly honeycomb = { store: inject(HONEYCOMB_STORE) }
  private readonly filter = inject(SearchFilter)
  private readonly hivestate = inject(HIVE_STATE)
  private readonly editor = inject(EditorService)
  private readonly registry = inject(ACTION_REGISTRY)
  private readonly coordinator = inject(HiveLoader)
  private readonly carousel = inject(CAROUSEL_SVC)
  private readonly wheelState = inject(WheelState)

  // local state
  private wheelLocked = false
  private lastPulseId = 0
  private lastPulseTime = 0
  private prepopulated = false

  // computed values
  public readonly current = computed(() => this.carousel.current())
  public readonly isVisible = computed(() => !this.editor.isEditing())
  public readonly isAllowed = computed(() =>
    this.hivestate.items().length > 1 && !this.editor.isEditing()
  )

  public upper: IDexieHive[] = []
  public lower: IDexieHive[] = []
  public middleTile: IDexieHive | null = null

  constructor() {
    super()

    this.prepopulateHives()

    // sync carousel from filtered list without resetting order on every navigate
    let lastSig = ''

    effect(() => {
      const items = this.hivestate.filteredHives()
      if (!items.length) return

      const sig = items.map(i => i.name).join('|')
      if (sig === lastSig) return

      lastSig = sig
      this.carousel.setItems(items)
      this.updateMenu()
    })

    this.initializeWheelControl()
    this.initializeScoutWatcher()

    if (!environment.production) this.debugWatchCurrentHive()
  }

  public ngOnInit(): void {
    this.updateTileLimit()
  }

  @HostListener('window:resize')
  public onResize(): void {
    this.updateTileLimit()
  }

  // ─────────────────────────────────────────────
  // scroll wheel
  // ─────────────────────────────────────────────
  private initializeWheelControl(): void {
    effect(() => {
      const pulse = this.wheelState.pulse()
      if (!pulse || pulse === this.lastPulseId || this.wheelLocked) return

      const now = performance.now()
      if (now - this.lastPulseTime < 150) return

      this.lastPulseId = pulse
      this.lastPulseTime = now
      this.wheelLocked = true

      const dir = this.wheelState.deltaY > 0 ? 1 : -1

      void (async () => {
        try {
          if (dir > 0) await this.cycleBackward()
          else await this.cycleForward()
        } finally {
          setTimeout(() => (this.wheelLocked = false), 80)
        }
      })()
    })
  }

  // ─────────────────────────────────────────────
  // scout watcher
  // ─────────────────────────────────────────────
  private initializeScoutWatcher(): void {
    let last = ''

    effect(() => {
      const hiveName = this.state.scout()?.name
      if (!hiveName || hiveName === last) return

      last = hiveName
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
  public changeHiveByName = (hiveName: string): void => {
    if (!hiveName) return

    this.filter.clear()
    this.carousel.setHive(hiveName)
    void this.applyHeadChange()
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

  private applyHeadChange = async (): Promise<void> => {
    if (!this.current()) return
    await this.changeHive()
    this.updateMenu()
  }

  public changeHive = async (): Promise<void> => {
    this.filter.clear()

    const hiveName = this.current()?.name
    if (!hiveName) return

    await this.registry.invoke(ExportDatabaseAction.ActionId, {})

    const realm = await this.coordinator.resolve(hiveName)
    if (!realm) throw new Error(`failed to resolve: ${hiveName}`)

    // service handles "/base#id" or "base#id"
    this.carousel.jumpTo(hiveName)

    this.updateMenu()
  }

  public jumpTo = (name: string): void => {
    if (!name) return
    this.filter.clear()
    this.carousel.jumpTo(name)
  }

  // ─────────────────────────────────────────────
  // layout
  // ─────────────────────────────────────────────
  private updateMenu(): void {
    const current = this.carousel.current()
    const items = this.hivestate.filteredHives()

    if (!current) {
      this.middleTile = items[0] ?? null
      this.upper = []
      this.lower = []
      return
    }

    this.middleTile = current
    this.upper = this.carousel.upper()
    this.lower = this.carousel.lower()
  }

  private updateTileLimit(): void {
    const windowHeight = window.innerHeight - 90
    const tileHeight = 72
    const perSide = Math.floor(((windowHeight / 2) - 65.5) / tileHeight)
    this.carousel.setTileLimit(perSide)
  }

  // ─────────────────────────────────────────────
  // hive prepopulation
  // ─────────────────────────────────────────────
  private prepopulateHives(): void {
    if (this.prepopulated) return

    ;(async () => {
      try {
        if (this.hivestate.items().length) {
          this.prepopulated = true
          return
        }

        const listFn = (this.coordinator as any).listHives?.bind(this.coordinator)
        const all = listFn ? await listFn() : await this.bfsLoadHives()
        if (!all?.length) return

        const store = this.hivestate as any

        if (typeof store.hydrate === 'function') {
          await store.hydrate(all)
        } else if (typeof store.addOrUpdate === 'function') {
          for (const h of all) store.addOrUpdate(h)
        }

        this.carousel.setItems(all)
        this.updateMenu()
        this.prepopulated = true
      } catch (err) {
        console.warn('[CarouselMenu] prepopulate error:', err)
      }
    })()
  }

  private bfsLoadHives = async (): Promise<IDexieHive[]> => {
    const roots =
      (await (this.coordinator as any).fetchRootHives?.()) ??
      (await (this.coordinator as any).listRoots?.()) ??
      []

    const seen = new Map<string, IDexieHive>()
    const queue = [...roots]

    while (queue.length) {
      const hive = queue.shift()!
      if (!hive?.name || seen.has(hive.name)) continue

      seen.set(hive.name, hive)

      const children =
        (await (this.coordinator as any).fetchChildren?.(hive.name)) ??
        (await (this.coordinator as any).childrenOf?.(hive.name)) ??
        []

      for (const child of children) {
        if (child?.name && !seen.has(child.name)) queue.push(child)
      }
    }

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}
