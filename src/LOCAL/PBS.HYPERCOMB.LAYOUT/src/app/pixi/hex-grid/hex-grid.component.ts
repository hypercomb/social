// src/app/pixi/hex-grid/hex-grid.component.ts

import { AfterViewInit, Component, DestroyRef, ElementRef, inject, viewChild } from '@angular/core'
import { createLandingGrid } from './hex-grid.bootstrap'
import { HexGridStage } from './hex-grid.stage'

@Component({
  selector: 'hc-hex-grid',
  template: `<div class="grid-host" #host></div>`,
  styles: [`
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
    .grid-host { width: 100%; height: 100%; }
  `]
})
export class HexGridComponent implements AfterViewInit {

  private readonly destroyRef = inject(DestroyRef)
  protected readonly host = viewChild<ElementRef<HTMLDivElement>>('host')

  private stage: HexGridStage | null = null

  public ngAfterViewInit(): void {
    // const el = this.host()?.nativeElement
    // if (!el) return

    // void (async () => {
    //   this.stage = await createLandingGrid(el)
    //   this.destroyRef.onDestroy(() => this.stage?.destroy())
    // })()
  }
}
