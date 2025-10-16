import { Directive, ElementRef, Injector, OnDestroy, Renderer2, Type } from '@angular/core'
import { DropDiagnosticsService } from 'src/app/helper/drag-and-drop/drop-diagnostics'
import { FileDropDispatcher } from 'src/app/helper/drag-and-drop/file-drop-dispatcher'
import { IDropDispatcher } from 'src/app/helper/drag-and-drop/i-drop-dispatcher'
import { ImageSrcDropDispatcher } from 'src/app/helper/drag-and-drop/image-src-drop-dispatcher'
import { LinkDropDispatcher } from 'src/app/helper/drag-and-drop/link-drop-dispatcher'
import { DragOverEvent } from 'src/app/helper/events/event-interfaces'

@Directive({
  standalone: true,
  selector: '[app-drag-and-drop]'
})
export class DragAndDropDirective implements OnDestroy {

  element: any

  private dragStartListener?: () => void
  private dragOverListener?: () => void
  private dragLeaveListener?: () => void
  private dropListener?: () => void

  public get dropDispatchers(): IDropDispatcher[] {
    return [
      this.injector.get(FileDropDispatcher),
      this.injector.get(ImageSrcDropDispatcher),
      this.injector.get(LinkDropDispatcher)
    ]
  }

  constructor(el: ElementRef,
    private injector: Injector,
    private renderer: Renderer2, private dropDiagnosticsService: DropDiagnosticsService) {
    this.element = el.nativeElement
    // console.log('drag and drop...')
    this.setupDragListeners()
  }

  ngOnDestroy() {
    this.removeDragListeners()
  }

  private setupDragListeners() {

    this.dragOverListener = this.renderer.listen(document, 'dragover', (event: DragEvent) => {
      // console.log('drag over')
      event.preventDefault()
      event.stopPropagation()
      const dispatch = new CustomEvent<DragOverEvent>('drag-over-event', {
        detail: { event: event }
      })

      document.dispatchEvent(dispatch)
      this.element.classList.add('hover')
    })

    this.dragLeaveListener = this.renderer.listen(document, 'dragleave', (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const dispatch = new CustomEvent<DragOverEvent>('drag-leave-event', {
        detail: { event: event }
      })
      document.dispatchEvent(dispatch)
      this.element.classList.remove('hover')
    })

    this.dropListener = this.renderer.listen(document, 'drop', (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      this.element.classList.remove('hover')

      // Call the async logic inside a synchronous wrapper
      this.handleDropEvent(event).catch((error) => {
        console.error('Error during drop handling:', error)
      })
    })
  }

  private async handleDropEvent(event: DragEvent) {
    // Optional diagnostics display
    if (!!localStorage.getItem("show-drop-info")) {
      this.dropDiagnosticsService.show(event)
    }

    for (const dropDispatcher of this.dropDispatchers) {

      const dispatched = await dropDispatcher.dispatch(event)
      if (dispatched) return // Stop if handled
    }
  }

  private removeDragListeners() {
    if (this.dragStartListener) this.dragStartListener()
    if (this.dragOverListener) this.dragOverListener()
    if (this.dragLeaveListener) this.dragLeaveListener()
    if (this.dropListener) this.dropListener()
  }
}


