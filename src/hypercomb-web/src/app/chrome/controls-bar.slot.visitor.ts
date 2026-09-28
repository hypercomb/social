// THE BAR COMES WITH THE HIVE. A published site's visitor mounts the controls
// bar only when they reach the hexagons (app.ts `chrome`), yet its ~106 KB of
// code sat in the first script every visitor downloads. Here it is its own
// chunk, fetched when this stand-in mounts; the stand-in renders nothing of its
// own (display: contents), so the shell's rules still reach the bar.
import { Component, EventEmitter, Output, input } from '@angular/core'
import { ControlsBarComponent as Bar } from '@hypercomb/shared/ui/controls-bar/controls-bar.component'

@Component({
  selector: 'hc-controls-bar',
  standalone: true,
  imports: [Bar],
  template: `@defer (on immediate) { <hc-controls-bar [meshPublic]="meshPublic()" (meshToggled)="meshToggled.emit()" /> }`,
  styles: [':host { display: contents }'],
})
export class ControlsBarComponent {
  readonly meshPublic = input<boolean | null>(false)
  @Output() meshToggled = new EventEmitter<void>()
}
