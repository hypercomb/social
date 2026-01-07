import { Directive, HostListener, inject } from '@angular/core'
import { LayoutState } from 'src/app/layout/layout-state'

@Directive({
  standalone: true,
  selector: '[controls-active]',
})
export class ControlsActiveDirective {
  private readonly layout = inject(LayoutState)

  // listen to mouseenter and set isControlMode = true
  @HostListener('mouseenter') onMouseEnter() {
    this.layout.setMouseOverControlBar(true)
  }

  // listen to mouseleave and set isControlMode = false
  @HostListener('mouseleave') onMouseLeave() {
    this.layout.setMouseOverControlBar(false)
  }
}


