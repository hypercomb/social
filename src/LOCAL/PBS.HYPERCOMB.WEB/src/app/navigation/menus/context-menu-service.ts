import { Injectable, inject, effect, DestroyRef, signal } from "@angular/core"
import { Container, Assets, Sprite, FederatedPointerEvent, TextStyle, Text } from "pixi.js"
import { LayoutState } from "src/app/layout/layout-state"
import { POLICY } from "src/app/core/models/enumerations"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { LocalAssets } from "src/app/unsorted/constants"
import { LinkNavigationService } from "../link-navigation-service"
import { PolicyService } from "./policy-service"
import { Cell } from "src/app/cells/cell"
import { CombStore } from "src/app/cells/storage/comb-store"
import { Events } from "src/app/helper/events/events"
import { takeUntilDestroyed } from "@angular/core/rxjs-interop"
import { fromEvent } from "rxjs"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { ACTION_REGISTRY, IContextMenu } from "src/app/shared/tokens/i-hypercomb.token"
import { CellContext } from "src/app/actions/action-contexts"
import { ActionRegistry } from "src/app/actions/action-registry"


@Injectable({ providedIn: 'root' })
export class ContextMenuService extends PixiServiceBase implements IContextMenu {
  private readonly actions = inject(ACTION_REGISTRY)
  private readonly detector = inject(CoordinateDetector)
  private readonly layout = inject(LayoutState)
  private readonly navigation = inject(LinkNavigationService)
  private readonly store = inject(CombStore)
  private readonly policy = inject(PolicyService)
  private readonly destroyRef = inject(DestroyRef)

  public readonly isBlocked = this.policy.any(
    POLICY.EditInProgress,
    POLICY.ViewingClipboard,
    POLICY.MovingTiles
  )

  private readonly menuContainer = new Container() // dedicated context menu container

  private icons: Text[] = []
  private editIcon!: Text
  private linkIcon!: Text
  private branchIcon!: Text
  private clickAborted = false
  public isVisible = signal(false)

  constructor() {
    super()

    fromEvent<MouseEvent>(document, "contextmenu")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => {
        ev.preventDefault()
      })

    // wait until PixiManager has a container
    effect(() => {
      const container = this.pixi.container
      if (!container) return

      container.label = ContextMenuService.name
      if (!container.children.includes(this.menuContainer)) {
        container.addChild(this.menuContainer)
      }
    })

    // react to active tile detection
    effect(async () => {
      const tile = this.detector.activeTile()

      // if no tile, hide menu immediately
      if (!tile || this.state.isMobile) {
        await this.hide()
        return
      }

      // tile found → look up its data and show
      const cell = this.store.lookupData(tile.cellId)
      if (cell) {
        await this.show(cell)
      }

      // optional: hide if pointer overlaps UI controls
      if (this.layout.isMouseOverControlBar()) {
        await this.hide()
      }
    })



    // DOM events
    document.addEventListener(Events.PanningThreshold, () => {
      this.clickAborted = true
    })
    document.addEventListener('mouseup', () => {
      this.clickAborted = false
    })
  }

  // position of the menu
  private readonly _position = signal<{ x: number; y: number } | null>(null)
  public readonly position = this._position.asReadonly()

  // show/hide is derived from detector’s activeCell
  public readonly activeCell = this.detector.activeTile()

  public hide = async () => {
    this._position.set(null)
    this.menuContainer.visible = false
    this.menuContainer.alpha = 0
    this.isVisible.set(false)
  }


  public show = async (cell: Cell) => {
    if (this.isBlocked()) return
    this.isVisible.set(true)
    this.menuContainer.alpha = 1
    if (this.linkIcon) {
      this.linkIcon.visible = !!cell.link
    }
    const tile = this.store.lookupTile(cell.cellId)!
    if (!tile) return

    const vspace = 125
    const xspace = 94
    const { hexagonOffsetX, hexagonOffsetY } = this.settings.hexagonDimensions

    if (!tile.position) return
    this.menuContainer.x = tile.x + hexagonOffsetX + xspace
    this.menuContainer.y = tile.y + hexagonOffsetY - vspace
    this.menuContainer.visible = true

  }


  protected override onPixiReady(): void {
    void this.safeInit()
  }

  private async safeInit(): Promise<void> {
    this.menuContainer.alpha = 0
    await this.addContainer(0, 0)
    this.menuContainer.eventMode = 'static'

    const style = { fontFamily: 'hypercomb-icons', fontSize: 32, fill: 'white' }

    this.editIcon = new Text({ text: 'N', style })
    this.linkIcon = new Text({ text: '*', style })
    this.branchIcon = new Text({ text: '+', style })

    this.addLinkClick(this.linkIcon)
    this.addEditTileClick(this.editIcon)
    this.addBranchClick(this.branchIcon)

    this.icons.push(this.linkIcon, this.editIcon, this.branchIcon)

    const padding = 20
    this.icons.forEach((icon, index) => {
      icon.anchor.set(0.5, 0.5)
      icon.x = 32
      icon.y = 50 + padding + index * 60
      icon.eventMode = 'dynamic'

      icon.on('pointerover', this.onIconHover)
      icon.on('pointerout', this.onIconOut)

      this.menuContainer.addChild(icon)
    })

    this.menuContainer.on('pointerdown', this.onContainerClick)
  }

  public addContainer = async (x: number, y: number) => {
    const texture = await Assets.load(LocalAssets.Background)
    const background = new Sprite(texture)
    background.width = 60.5
    background.height = 249
    background.interactive = true

    this.menuContainer.addChild(background)
    this.menuContainer.x = x
    this.menuContainer.y = y
    this.menuContainer.zIndex = 1000
  }

  private onIconHover = (event: FederatedPointerEvent) => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: 'hypercomb-icons', fontSize: 46, fill: '#2e3436' })
  }

  private onIconOut = (event: FederatedPointerEvent) => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: 'hypercomb-icons', fontSize: 32, fill: 'white' })
  }

  private addLinkClick(icon: Text) {
    icon.on('pointerup', async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.stack.cell()
      if (cell) await this.navigation.openLink(cell)
    })
  }

  private addEditTileClick(icon: Text) {
    icon.on('pointerup', async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.detector.activeCell()
      if (cell) {
        const payload = { kind: "cell", cell, event } as CellContext
        await this.actions.invoke('layout.editTile', payload)
      }
    })
  }

  private addBranchClick(icon: Text) {
    icon.on('pointerup', async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      //  this.actions.invoke(action.id, { cell })
    })
  }

  private onContainerClick = (e: FederatedPointerEvent) => {
    const point = e.global
    const hit = this.icons.some(icon => icon.containsPoint(point))
    if (!hit) {
      this.debug.log('ui', 'Container clicked', e)
    }
  }

  private clickWasAborted(): boolean {
    const was = this.clickAborted
    this.clickAborted = false
    return was
  }
}


