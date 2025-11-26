// src/app/navigation/menus/context-menu-service.ts
import { Injectable, inject, effect, DestroyRef, signal } from "@angular/core"
import { Container, Assets, Sprite, FederatedPointerEvent, TextStyle, Text, Rectangle } from "pixi.js"
import { LayoutState } from "src/app/layout/layout-state"
import { POLICY } from "src/app/core/models/enumerations"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { LocalAssets } from "src/app/helper/constants"
import { LinkNavigationService } from "../link-navigation-service"
import { PolicyService } from "./policy-service"
import { Cell } from "src/app/cells/cell"
import { HoneycombStore } from "src/app/cells/storage/honeycomb-store"
import { Events } from "src/app/helper/events/events"
import { takeUntilDestroyed } from "@angular/core/rxjs-interop"
import { fromEvent } from "rxjs"
import { CoordinateDetector } from "src/app/helper/detection/coordinate-detector"
import { ACTION_REGISTRY, IContextMenu } from "src/app/shared/tokens/i-hypercomb.token"
import { CellPayload } from "src/app/actions/action-contexts"

@Injectable({ providedIn: "root" })
export class ContextMenuService extends PixiServiceBase implements IContextMenu {
  private readonly actions = inject(ACTION_REGISTRY)
  private readonly detector = inject(CoordinateDetector)
  private readonly layout = inject(LayoutState)
  private readonly navigation = inject(LinkNavigationService)
  private readonly store = inject(HoneycombStore)
  private readonly policy = inject(PolicyService)
  private readonly destroyRef = inject(DestroyRef)

  public readonly isBlocked = this.policy.any(
    POLICY.EditInProgress,
    POLICY.ViewingClipboard,
    POLICY.MovingTiles
  )

  private readonly menuContainer = new Container()
  private icons: Text[] = []

  // RENAMED for clarity
  private topIcon!: Text       // previously "branchIcon"
  private editIcon!: Text      // unchanged
  private bottomIcon!: Text    // previously "linkIcon"

  private background?: Sprite
  private clickAborted = false
  public isVisible = signal(false)

  constructor() {
    super()

    fromEvent<MouseEvent>(document, "contextmenu")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(ev => ev.preventDefault())

    effect(() => {
      const container = this.pixi.container
      if (!container) return
      container.label = ContextMenuService.name
      if (!container.children.includes(this.menuContainer)) {
        container.addChild(this.menuContainer)
      }
    })

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

    document.addEventListener(Events.PanningThreshold, () => (this.clickAborted = true))
    document.addEventListener("mouseup", () => (this.clickAborted = false))
  }

  private readonly _position = signal<{ x: number; y: number } | null>(null)
  public readonly position = this._position.asReadonly()

  public readonly activeCell = this.detector.activeTile()

  public hide = async (): Promise<void> => {
    this._position.set(null)
    this.menuContainer.visible = false
    this.menuContainer.alpha = 0
    this.isVisible.set(false)
    this.state.setContextActive(false)
  }

  public show = async (cell: Cell): Promise<void> => {
    if (this.isBlocked()) return
    this.isVisible.set(true)
    this.menuContainer.alpha = 1

    // bottom icon toggled by cell.link logic (same as before)
    if (this.bottomIcon) this.bottomIcon.visible = !!cell.link

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

    this.menuContainer.eventMode = "static"
    this.menuContainer.interactive = true
    this.menuContainer.hitArea = new Rectangle(0, 0, 60.5, 249)

    this.menuContainer.on("pointerdown", this.onContainerPointerDown)

    this.menuContainer.on("pointerenter", () => this.state.setContextActive(true))
    this.menuContainer.on("pointerleave", () => this.state.setContextActive(false))

    const style = { fontFamily: "hypercomb-icons", fontSize: 32, fill: "white" }

    // RENAMED but kept same icons & behavior
    // this.topIcon = new Text({ text: "*", style })      // previously branchIcon
    this.editIcon = new Text({ text: "N", style })
    this.bottomIcon = new Text({ text: "*", style })   // previously linkIcon

    //this.addBranchClick(this.topIcon)
    this.addEditTileClick(this.editIcon)
    this.addLinkClick(this.bottomIcon)

    // ORDER UNCHANGED
    this.icons.push(this.editIcon, this.bottomIcon)

    const padding = 20
    this.icons.forEach((icon, index) => {
      icon.anchor.set(0.5, 0.5)
      icon.x = 32
      icon.y = 110 + padding + index * 60
      icon.eventMode = "dynamic"
      icon.on("pointerover", this.onIconHover)
      icon.on("pointerout", this.onIconOut)
      this.menuContainer.addChild(icon)
    })
  }

  public addContainer = async (x: number, y: number): Promise<void> => {
    const texture = await Assets.load(LocalAssets.Background)
    const background = new Sprite(texture)
    this.background = background

    background.width = 60.5
    background.height = 249

    background.eventMode = "dynamic"
    background.interactive = true

    background.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation()
      e.stopImmediatePropagation()
    })

    background.on("pointerup", this.onBackgroundClick)

    this.menuContainer.addChild(background)
    this.menuContainer.x = x
    this.menuContainer.y = y
    this.menuContainer.zIndex = 1000
  }

  private onContainerPointerDown = (e: FederatedPointerEvent): void => {
    e.stopPropagation()
    e.stopImmediatePropagation()
  }

  private onBackgroundClick = async (e: FederatedPointerEvent): Promise<void> => {
    e.stopPropagation()
    e.stopImmediatePropagation()
    e.preventDefault()
    if (this.clickWasAborted() || e.button === 2) return
    await this.hide()
  }

  private onIconHover = (event: FederatedPointerEvent): void => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: "hypercomb-icons", fontSize: 46, fill: "#2e3436" })
  }

  private onIconOut = (event: FederatedPointerEvent): void => {
    const icon = event.currentTarget as Text
    icon.style = new TextStyle({ fontFamily: "hypercomb-icons", fontSize: 32, fill: "white" })
  }

  private addLinkClick(icon: Text): void {
    // unchanged
    icon.on("pointerup", async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.detector.activeCell()!
      if (cell) await this.navigation.openLink(cell)
      await this.hide()
    })
  }

  private addEditTileClick(icon: Text): void {
    icon.on("pointerup", async (event: FederatedPointerEvent) => {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (this.clickWasAborted() || event.button === 2) return
      const cell = this.detector.activeCell()
      if (cell) {
        const payload = { kind: "cell", cell, event } as CellPayload
        await this.actions.invoke("layout.editTile", payload)
      }
      await this.hide()
    })
  }


  private clickWasAborted(): boolean {
    const was = this.clickAborted
    this.clickAborted = false
    return was
  }
}
