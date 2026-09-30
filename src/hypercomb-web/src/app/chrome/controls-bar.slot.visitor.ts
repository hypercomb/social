// THE BAR COMES WITH THE HIVE. A published site's visitor mounts the controls
// bar only when they reach the hexagons (app.ts `chrome`), yet its ~106 KB of
// code sat in the first script every visitor downloads. Here it is its own
// chunk, imported when this stand-in mounts; the stand-in renders nothing of
// its own (display: contents), so the shell's hide rules still reach the bar.
//
// Created by hand, not with @defer: the shell is zoneless, and a deferred
// block's first change detection never ran — the bar mounted with every @if
// and @for empty (measured 2026-09-28). detectChanges() runs that first pass;
// from then on the bar's own signals schedule its updates.
import { type AfterViewInit, Component, type ComponentRef, EventEmitter, Output, ViewContainerRef, effect, input, viewChild } from '@angular/core'
import type { ControlsBarComponent as Bar } from '@hypercomb/shared/ui/controls-bar/controls-bar.component'

@Component({
  selector: 'hc-controls-bar',
  standalone: true,
  template: '<ng-container #slot />',
  styles: [':host { display: contents }'],
})
export class ControlsBarComponent implements AfterViewInit {
  readonly meshPublic = input<boolean | null>(false)
  @Output() meshToggled = new EventEmitter<void>()
  protected readonly slot = viewChild.required('slot', { read: ViewContainerRef })
  #bar: ComponentRef<Bar> | null = null

  constructor() {
    effect(() => {
      const value = this.meshPublic()
      this.#bar?.setInput('meshPublic', value)
    })
  }

  ngAfterViewInit(): void {
    void import('@hypercomb/shared/ui/controls-bar/controls-bar.component').then(({ ControlsBarComponent: Real }) => {
      const bar = this.slot().createComponent(Real)
      bar.setInput('meshPublic', this.meshPublic())
      bar.instance.meshToggled.subscribe(() => this.meshToggled.emit())
      bar.changeDetectorRef.detectChanges()
      this.#bar = bar
    })
  }
}
