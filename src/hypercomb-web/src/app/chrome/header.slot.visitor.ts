// THE COMMAND LINE COMES WITH THE HIVE. A published site's visitor mounts the
// header only when they reach the hexagons (app.ts `chrome`), yet the command
// line and shell inside it (~137 KB) sat in the first script every visitor
// downloads. Here they are their own chunk, imported when this stand-in
// mounts; the stand-in renders nothing of its own (display: contents).
//
// Created by hand, not with @defer, for the reason controls-bar.slot.visitor.ts
// gives: zoneless, a deferred block's first change detection never ran.
// app.scss sizes `app-header` inside the header bar; the real header here is
// not in App's template, so it takes that size from this stand-in.
import { type AfterViewInit, Component, ViewContainerRef, viewChild } from '@angular/core'

@Component({
  selector: 'app-header',
  standalone: true,
  template: '<ng-container #slot />',
  styles: [':host { display: contents }'],
})
export class Header implements AfterViewInit {
  protected readonly slot = viewChild.required('slot', { read: ViewContainerRef })

  ngAfterViewInit(): void {
    void import('../header/header').then(({ Header: Real }) => {
      const header = this.slot().createComponent(Real)
      const host = header.location.nativeElement as HTMLElement
      host.style.flex = '3'
      host.style.minWidth = '0'
      header.changeDetectorRef.detectChanges()
    })
  }
}
