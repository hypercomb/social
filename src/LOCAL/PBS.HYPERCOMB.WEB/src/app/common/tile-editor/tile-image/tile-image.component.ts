// src/app/common/tile-editor/tile-image/tile-image.component.ts
import { Application, Container, Sprite, Rectangle, FederatedPointerEvent } from 'pixi.js'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { TileLayerManager } from 'src/app/cells/miscellaneous/tile-layer-manager'
import { Settings } from 'src/app/core/settings'
import { ImageSprite } from 'src/app/user-interface/sprite-components/image-sprite'
import { MaskComponent } from 'src/app/user-interface/sprite-components/mask-component'
import { DragAndDropDirective } from 'src/app/core/directives/drag-and-drop-directive'
import { Component, OnDestroy, ViewChild, ElementRef, inject, signal, effect, HostListener } from '@angular/core'
import { DebugService } from 'src/app/core/diagnostics/debug-service'
import { ImageCaptureManager } from './image-capture-manager'
import { Events } from 'src/app/helper/events/events'
import { EditImageSprite } from 'src/app/user-interface/sprite-components/edit-image-sprite'
import { Cell } from 'src/app/cells/cell'

@Component({
  standalone: true,
  selector: '[app-tile-image]',
  templateUrl: './tile-image.component.html',
  styleUrls: ['./tile-image.component.scss'],
  imports: [DragAndDropDirective],
})
export class TileImageComponent implements OnDestroy {

  @ViewChild('tilearea', { static: true }) tilearea!: ElementRef<HTMLDivElement>

  private readonly settings = inject(Settings)
  private readonly imageSprite = inject(ImageSprite)
  private readonly editImageSprite = inject(EditImageSprite)
  private readonly mask = inject(MaskComponent)
  private readonly layers = inject(TileLayerManager)
  public readonly es = inject(EditorService)
  private readonly manager = inject(ImageCaptureManager)
  private readonly debug = inject(DebugService)

  public placeholderActive = signal(false)

  private pixiApp = new Application()
  private container!: Container
  private baseImage?: IHiveImage
  private initialized = false
  private sprite?: Sprite
  private isDragging = false
  private dragStart = { x: 0, y: 0 }

  constructor() {
    document.addEventListener(Events.DirectImageDrop, this.onDirectDrop)

    effect(() => {
      const context = this.es.context()
      if (!context) return

      const border = this.es.borderColorTile()
      const background = this.es.backgroundTile()
      const branch = this.es.branchTile()

      if (border || background || branch) {
        void this.renderLayers(context.cell, new Container())
        this.es.reset()
      }
    })

    effect(onCleanup => {
      let cancelled = false
      onCleanup(() => (cancelled = true))

      const context = this.es.context()
      const cell = context?.cell
      if (!context || !cell) return

      ;(async () => {
        const ctx = this.es.context()!
        this.baseImage =
          ctx.modifiedLarge ??
          ctx.originalLarge ??
          undefined

        if (!this.initialized) {
          const { width, height } = this.settings.hexagonDimensions

          await this.pixiApp.init({
            resizeTo: this.tilearea.nativeElement,
            width,
            height,
            backgroundColor: 0x1e1e1e,
            antialias: true,
            autoDensity: true,
          })

          if (cancelled) return

          this.pixiApp.start()
          this.pixiApp.stage.eventMode = 'static'
          this.pixiApp.canvas.style.cursor = 'auto'
          this.tilearea.nativeElement.appendChild(this.pixiApp.canvas)

          this.initialized = true
        }

        await this.renderLayers(cell, new Container())
      })()
    })
  }

  private onDirectDrop = async (event: any): Promise<void> => {
    const context = this.es.context()
    const cell = this.es.cell()
    if (!context || !cell) return

    const blob = event.detail.Blob as Blob

    const newImage: IHiveImage = {
      imageHash: cell.imageHash!,
      blob,
      x: cell.x ?? 0,
      y: cell.y ?? 0,
      scale: cell.scale ?? 1,
    }

    context.originalLarge = newImage
    context.modifiedLarge = newImage
    context.imageDirty = true
    this.baseImage = newImage

    await this.renderLayers(cell, new Container())
  }

  private syncTransformsToModel = (): void => {
    const context = this.es.context()
    const cell = this.es.cell()
    if (!context || !cell || !this.sprite) return

    const s = this.sprite
    const x = s.x - this.settings.hexagonOffsetX
    const y = s.y - this.settings.hexagonOffsetY
    const scale = s.scale.x

    const working = context.modifiedLarge ?? context.originalLarge
    if (working) {
      working.x = x
      working.y = y
      working.scale = scale
    }

    cell.x = x
    cell.y = y
    cell.scale = scale

    context.imageDirty = true
  }

  public renderLayers = async (cell: Cell, container: Container): Promise<void> => {
    if (this.container) {
      this.container.removeAllListeners()
      this.container.removeChildren()
      this.container.parent?.removeChild(this.container)
    }

    this.container = container

    const base = this.baseImage
    const hasHash = !!cell.imageHash

    if (!base && !hasHash) {
      this.debug.warn('tile-image', 'no image found', cell.cellId)
      this.sprite = undefined
      this.es.rendered.set(false)
      return
    }

    const { width, height } = this.settings.hexagonDimensions

    container.removeChildren()
    container.eventMode = 'dynamic'
    container.cursor = 'move'
    container.hitArea = new Rectangle(0, 0, width, height)
    container.off('pointerdown', this.onPointerDown).on('pointerdown', this.onPointerDown)

    const sprite = base
      ? await this.editImageSprite.build(base)
      : await this.imageSprite.build(cell)

    sprite.anchor.set(0.5)

    const tileLayers = await this.layers.getLayers(cell, sprite)
    for (const L of tileLayers) container.addChild(L)

    container.sortChildren()

    this.sprite = sprite
    sprite.x = (base?.x ?? cell.x ?? 0) + this.settings.hexagonOffsetX
    sprite.y = (base?.y ?? cell.y ?? 0) + this.settings.hexagonOffsetY
    sprite.scale.set(base?.scale ?? cell.scale ?? 1)

    const mask = await this.mask.build()
    mask.x = width / 2
    mask.y = height / 2
    container.mask = mask as Sprite
    container.addChild(mask)

    this.pixiApp.stage.addChild(container)
    this.manager.setContainer(container)
    this.es.rendered.set(true)
  }

  private onPointerDown = (e: FederatedPointerEvent) => {
    const sprite = this.sprite
    if (!sprite) return

    const start = this.container.toLocal(e.global)
    this.dragStart.x = start.x - sprite.x
    this.dragStart.y = start.y - sprite.y

    this.pixiApp.stage.on('pointermove', this.onPointerMove)
    this.pixiApp.stage.on('pointerup', this.onPointerUp)
    this.pixiApp.stage.on('pointerupoutside', this.onPointerUp)

    this.isDragging = true
    this.pixiApp.canvas.style.cursor = 'grabbing'
  }

  private onPointerMove = (e: FederatedPointerEvent) => {
    if (!this.isDragging || !this.sprite) return

    const pos = this.container.toLocal(e.global)
    this.sprite.position.set(pos.x - this.dragStart.x, pos.y - this.dragStart.y)
  }

  private onPointerUp = () => {
    this.isDragging = false
    this.pixiApp.stage.off('pointermove', this.onPointerMove)
    this.pixiApp.stage.off('pointerup', this.onPointerUp)
    this.pixiApp.stage.off('pointerupoutside', this.onPointerUp)
    this.pixiApp.canvas.style.cursor = 'auto'
    this.syncTransformsToModel()
  }

  @HostListener('wheel', ['$event'])
  public onWheel = async (event: WheelEvent) => {
    if (!this.sprite || !this.baseImage) return

    event.preventDefault()
    const sprite = this.sprite
    const rect = this.pixiApp.canvas.getBoundingClientRect()

    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    const before = this.container.toLocal({ x: mouseX, y: mouseY })
    const factor = event.deltaY > 0 ? 0.95 : 1.05

    let newScale = sprite.scale.x * factor
    newScale = Math.max(0.2, Math.min(10, newScale))
    sprite.scale.set(newScale)

    const after = this.container.toLocal({ x: mouseX, y: mouseY })
    sprite.position.x += (after.x - before.x) * sprite.scale.x
    sprite.position.y += (after.y - before.y) * sprite.scale.y

    this.syncTransformsToModel()
  }

  public ngOnDestroy(): void {
    document.removeEventListener(Events.DirectImageDrop, this.onDirectDrop)
    this.pixiApp.stop()
    this.pixiApp.stage.removeAllListeners()
    this.container?.removeAllListeners()
    this.pixiApp.stage.removeChildren()
    this.sprite = undefined
    this.pixiApp.destroy()
  }
}
