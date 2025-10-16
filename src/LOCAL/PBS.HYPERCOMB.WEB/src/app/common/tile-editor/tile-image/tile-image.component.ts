import { Application, Container, Sprite, Rectangle, FederatedPointerEvent } from 'pixi.js'
import { IHiveImage } from 'src/app/core/models/i-hive-image'
import { EditorService } from 'src/app/state/interactivity/editor-service'
import { TileLayerManager } from 'src/app/cells/miscellaneous/tile-layer-manager'
import { Settings } from 'src/app/unsorted/settings'
import { ImageSprite } from 'src/app/user-interface/sprite-components/image-sprite'
import { MaskComponent } from 'src/app/user-interface/sprite-components/mask-component'
import { noImage } from 'src/app/cells/models/cell-filters'
import { DragAndDropDirective } from 'src/app/core/directives/drag-and-drop-directive'
import { BlobService } from 'src/app/hive/rendering/blob-service'
import { Component, OnDestroy, ViewChild, ElementRef, inject, signal, effect, HostListener } from '@angular/core'
import { EditImageSprite } from 'src/app/user-interface/sprite-components/edit-image-sprite'
import { EditCell } from 'src/app/cells/cell'
import { ImageCaptureService } from 'src/app/unsorted/image-services/image-capture-service'
import { Events } from 'src/app/helper/events/events'
import { DebugService } from 'src/app/core/diagnostics/debug-service'

@Component({
  standalone: true,
  selector: '[app-tile-image]',
  templateUrl: './tile-image.component.html',
  styleUrls: ['./tile-image.component.scss'],
  imports: [DragAndDropDirective]
})
export class TileImageComponent implements OnDestroy {
  @ViewChild('tilearea', { static: true }) tilearea!: ElementRef<HTMLDivElement>

  private readonly settings = inject(Settings)
  private readonly imageSprite = inject(ImageSprite)
  private readonly editImageSprite = inject(EditImageSprite)
  private readonly mask = inject(MaskComponent)
  private readonly layers = inject(TileLayerManager)
  public readonly es = inject(EditorService)
  private readonly captureService = inject(ImageCaptureService)
  private readonly debug = inject(DebugService)

  // ──────────────────────────────────────────────
  // local state
  // ──────────────────────────────────────────────
  public noImage = noImage
  public placeholderActive = signal(false)
  private pixiApp = new Application()
  private container!: Container
  private baseImage?: IHiveImage
  private initialized = false
  private isDragging = false
  private dragStart = { x: 0, y: 0 }
  private sprite: Sprite | undefined = undefined

  // ⬇️ add to class fields
  private transformPersistTimer?: number // optional if you later debounce a persist
  private readonly transformPersistDelay = 300

  // ⬇️ add to class (helper: ensure we have a small working record)
  private ensureSmall = (): IHiveImage => {
    const cell = this.es.context() as EditCell | null
    if (!cell) throw new Error('no cell in context')
    if (!cell.image) {
      cell.image = {
        id: undefined,
        cellId: cell.cellId!,
        blob: BlobService.defaultBlob, // placeholder until capture
        x: 0,
        y: 0,
        scale: 1,
        getBlob: function () { return Promise.resolve(this.blob) }
      }
    }
    return cell.image
  }

  // ⬇️ add to class (helper: copy sprite → model)
  private syncTransformsToModel = (): void => {
    const cell = this.es.context() as EditCell | null
    const s = this.sprite
    if (!cell || !s) return

    const x = s.x - this.settings.hexagonOffsetX
    const y = s.y - this.settings.hexagonOffsetY
    const scale = s.scale.x

    // update working copy used to render
    if (this.baseImage) {
      this.baseImage.x = x
      this.baseImage.y = y
      this.baseImage.scale = scale
    }

    // also mirror onto large so large-only fallback keeps pose
    if (cell.largeImage) {
      cell.largeImage.x = x
      cell.largeImage.y = y
      cell.largeImage.scale = scale
    }

    // flag for snapshot pipeline
    cell.imageDirty = true

    // optional: debounce a transforms-only persist here if you want cross-session restore
    // this.queuePersistTransforms(small) // uncomment if you wire a repo call
  }


  // ──────────────────────────────────────────────
  // ctor
  // ──────────────────────────────────────────────
  constructor() {


    document.addEventListener(Events.DirectImageDrop, async (event: any) => {
      const blob = event.detail.Blob as Blob
      const cell = this.es.context() as EditCell | null
      if (!cell) return

      // create a new IHiveImage for large
      const newImage: IHiveImage = {
        id: undefined,
        cellId: cell.cellId!,
        blob,
        x: 0,
        y: 0,
        scale: 1,
        getBlob: async () => blob
      }

      // assign as large image
      cell.largeImage = newImage
      cell.imageDirty = true

      // rebuild base image reference
      this.baseImage = newImage

      // visually refresh PIXI sprite
      await this.renderLayers(cell, new Container())

      // optionally trigger a capture or save later via ImageCaptureService
      // await this.captureService.capture()

    })


    effect(() => {
      const border = this.es.borderColorTile()
      const background = this.es.backgroundTile()
      const branch = this.es.branchTile()

      // if any of these change, re-render
      if (border || background || branch) {
        const cell = this.es.context() as EditCell
        if (cell) {
          this.renderLayers(cell, new Container())
        }
        this.es.reset()
      }
    })

    effect((onCleanup) => {
      let canceled = false
      onCleanup(() => (canceled = true))
        ; (async () => {
          const cell = this.es.context() as EditCell | null
          if (!cell) return

          this.ensureSmall()
          // ensure working small image exists
          this.baseImage = <IHiveImage>{ ...cell.largeImage }

          // init pixi once
          if (!this.initialized) {
            const { width, height } = this.settings.hexagonDimensions
            await this.pixiApp.init({
              resizeTo: this.tilearea.nativeElement,
              width,
              height,
              backgroundColor: 0x1e1e1e,
              antialias: true,
              autoDensity: true
            })
            if (canceled) return
            this.pixiApp.start() // if you want manual renders only, call stop() and render on demand
            this.pixiApp.stage.eventMode = 'static'
            this.pixiApp.stage.hitArea = this.pixiApp.screen
            this.pixiApp.canvas.style.cursor = 'auto'
            this.tilearea.nativeElement.appendChild(this.pixiApp.canvas)
            this.initialized = true
          }

          await this.renderLayers(cell, new Container())
        })()
    })
  }

  // ──────────────────────────────────────────────
  // rendering
  // ──────────────────────────────────────────────
  public renderLayers = async (cell: EditCell, container: Container): Promise<void> => {
    this.container = container
    const baseImage = this.baseImage
    if (!baseImage && !cell.blob) {
      this.sprite = undefined
      return
    }

    const { width, height } = this.settings.hexagonDimensions
    container.removeChildren()
    container.eventMode = 'dynamic'
    container.cursor = 'move'
    container.hitArea = new Rectangle(0, 0, width, height)
    container.off('pointerdown', this.onPointerDown).on('pointerdown', this.onPointerDown)

    const sprite = baseImage
      ? await this.editImageSprite.build(baseImage)
      : await this.imageSprite.build(cell)

    sprite.anchor.set(0.5)
    const layers = await this.layers.getLayers(cell, sprite)
    for (const l of layers) container.addChild(l)
    container.sortChildren()
    this.sprite = sprite
    sprite.x = (baseImage?.x ?? 0) + this.settings.hexagonOffsetX
    sprite.y = (baseImage?.y ?? 0) + this.settings.hexagonOffsetY

    sprite.scale.set(baseImage?.scale ?? 1)

    const mask = await this.mask.build()
    mask.x = width / 2
    mask.y = height / 2
      ; (mask as any).eventMode = 'none'
    container.mask = mask as Sprite
    container.addChild(mask)

    this.pixiApp.stage.addChild(container)
    await this.captureService.setContainer(container)
    this.es.rendered.set(true)
  }

  // ──────────────────────────────
  // pointer interactions
  // ──────────────────────────────
  private onPointerDown = (e: FederatedPointerEvent): void => {
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

  private onPointerMove = (e: FederatedPointerEvent): void => {
    if (!this.isDragging) return
    const sprite = this.sprite
    if (!sprite) return

    const pos = this.container.toLocal(e.global)
    sprite.position.set(pos.x - this.dragStart.x, pos.y - this.dragStart.y)
  }

  private onPointerUp = async (_e: FederatedPointerEvent): Promise<void> => {
    this.isDragging = false
    this.pixiApp.stage.off('pointermove', this.onPointerMove)
    this.pixiApp.stage.off('pointerup', this.onPointerUp)
    this.pixiApp.stage.off('pointerupoutside', this.onPointerUp)
    this.pixiApp.canvas.style.cursor = 'auto'


    // sync x/y/scale into cell.image + largeImage
    this.syncTransformsToModel()
  }


  // ──────────────────────────────────────────────
  // zoom (pointer-centered)
  // ──────────────────────────────────────────────
  @HostListener('wheel', ['$event'])
  public onWheel = async (event: WheelEvent): Promise<void> => {
    try {
      if (!this.sprite || !this.baseImage) return

      event.preventDefault()
      const sprite = this.sprite
      const rect = this.pixiApp.canvas.getBoundingClientRect()

      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top

      const beforeZoom = this.container.toLocal({ x: mouseX, y: mouseY })

      const scaleFactor = event.deltaY > 0 ? 0.95 : 1.05
      let newScale = sprite.scale.x * scaleFactor
      newScale = Math.max(0.2, Math.min(10, newScale))
      sprite.scale.set(newScale)

      const afterZoom = this.container.toLocal({ x: mouseX, y: mouseY })

      const dx = (afterZoom.x - beforeZoom.x) * sprite.scale.x
      const dy = (afterZoom.y - beforeZoom.y) * sprite.scale.y
      sprite.position.x += dx
      sprite.position.y += dy

      // ⬇️ onWheel: at the end (right after updating sprite.position/scale)
      this.syncTransformsToModel()

      // if ticker is stopped, uncomment: this.pixiApp.render()
    } catch (err) {
      this.debug.error('tile-image', 'error in onWheel:', err)
    }
  }

  // ⬇️ add to class if you want debounced persist
  private queuePersistTransforms = (image: IHiveImage): void => {
    window.clearTimeout(this.transformPersistTimer)
    this.transformPersistTimer = window.setTimeout(async () => {
      try {
        // todo: call your repo to upsert the 'small' variant without changing blob
        // await this.modify.images.put(image, 'small')
      } catch (e) {
        this.debug.warn('tile-image', 'transform persist failed', e)
      }
    }, this.transformPersistDelay)
  }

  // ──────────────────────────────────────────────
  // cleanup
  // ──────────────────────────────────────────────
  public ngOnDestroy(): void {
    this.debug.info('tile-image', '🧹 TileImageComponent destroying...')
    this.pixiApp.stop()
    this.pixiApp.stage.removeAllListeners()
    if (this.container) this.container.removeAllListeners()
    this.pixiApp.stage.removeChildren()
    this.sprite = undefined
    this.pixiApp.destroy()
  }


}
