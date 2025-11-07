// src/app/navigation/menus/context-menu-service.ts
import { Injectable, inject, effect, DestroyRef, signal } from "@angular/core"
import { Container, Assets, Sprite, FederatedPointerEvent, TextStyle, Text, Rectangle } from "pixi.js"
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

  private readonly menuContainer = new Container()
  private icons: Text[] = []
  private editIcon!: Text
  private linkIcon!: Text
  private branchIcon!: Text
  private clickAborted = false
  public isVisible = signal(false)

  constructor() {
    super()

    // prevent default browser menu
    fromEvent<MouseEvent>(document, "contextmenu")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => ev.preventDefault())

    // attach menu container to main pixi container
    effect(() => {
      const container = this.pixi.container
      if (!container) return
      container.label = ContextMenuService.name
      if (!container.children.includes(this.menuContainer)) {
        container.addChild(this.menuContainer)
      }
    })

    // watch active tile for context menu triggers
    effect(async () => {
      const tile = this.detector.activeTile()
      if (!tile || this.state.isMobile) {
        await this.hide()
        return
      }

      const cell = this.store.lookupData(tile.cellId)
      if (cell) {
        await this.show(cell)
      }

      if (this.layout.isMouseOverControlBar()) {
        await this.hide()
      }
    })

    // handle click aborts from panning
    document.addEventListener(Events.PanningThreshold, () => (this.clickAborted = true))
    document.addEventListener("mouseup", () => (this.clickAborted = false))
  }

  private readonly _position = signal<{ x: number; y: number } | null>(null)
  public readonly position = this._position.asReadonly()

  public readonly activeCell = this.detector.activeTile()

  public hide = async () => {
    this._position.set(null)
    this.menuContainer.visible = false
    this.menuContainer.alpha = 0
    this.isVisible.set(false)
    this.state.setContextActive(false) // always reset when menu hidden
  }

  public show = async (cell: Cell) => {
    if (this.isBlocked()) return
    this.isVisible.set(true)
    this.menuContainer.alpha = 1

    if (this.linkIcon) this.linkIcon.visible = !!cell.link

    const tile = this.store.lookupTile(cell.cellId)
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

    // Ensure the container catches all pointer events over its area
    this.menuContainer.eventMode = 'static'
    this.menuContainer.interactive = true

    // Define a hit area matching the menu’s visual bounds
    this.menuContainer.hitArea = new Rectangle(0, 0, 60.5, 249)

    // Track pointer hover state (used for disabling tile clicks)
    this.menuContainer.on('pointerenter', () => this.state.setContextActive(true))
    this.menuContainer.on('pointerleave', () => this.state.setContextActive(false))

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
    background.eventMode = 'none'  // <- allow parent to get pointerenter/leave
    this.menuContainer.addChild(background)
    this.menuContainer.x = x
    this.menuContainer.y = y
    this.menuContainer.zIndex = 1000
  }


  private onIconHover = (event: FederatedPointerEvent) => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: "hypercomb-icons", fontSize: 46, fill: "#2e3436" })
  }

  private onIconOut = (event: FederatedPointerEvent) => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: "hypercomb-icons", fontSize: 32, fill: "white" })
  }

  private addLinkClick(icon: Text) {
    icon.on("pointerup", async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.stack.cell()
      if (cell) await this.navigation.openLink(cell)
      await this.hide()
    })
  }

  private addEditTileClick(icon: Text) {
    icon.on("pointerup", async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.detector.activeCell()
      if (cell) {
        const payload = { kind: "cell", cell, event } as CellContext
        await this.actions.invoke("layout.editTile", payload)
      }
      await this.hide()
    })
  }

  private addBranchClick(icon: Text) {
    icon.on("pointerup", async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      await this.hide()
    })
  }

  private onContainerClick = (e: FederatedPointerEvent) => {
    const point = e.global
    const hit = this.icons.some(icon => icon.containsPoint(point))
    if (!hit) this.hide()
  }

  private clickWasAborted(): boolean {
    const was = this.clickAborted
    this.clickAborted = false
    return was
  }
}
