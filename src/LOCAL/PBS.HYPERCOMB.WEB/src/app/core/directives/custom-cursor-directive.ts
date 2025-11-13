// custom-cursor.directive.ts
// note: subscriptions moved to ngOnInit writes to canvas deferred until the pixi canvas exists

import { Directive, effect, inject } from '@angular/core'
import { HypercombMode } from '../models/enumerations'
import { PixiServiceBase } from 'src/app/pixi/pixi-service-base'
import { ModeChangeService } from 'src/app/unsorted/mode-change-service'

@Directive({
  standalone: true,
  selector: '[app-custom-cursor]'
})
export class CustomCursorDirective extends PixiServiceBase {
  private readonly mode_change = inject(ModeChangeService)

  // run cursor updates reactively, but only once pixi is safe
  constructor() {
    super()

    effect(() => {
      if (!this.pixi.ready()) return
      void this.set(this.state.mode())
    })
  }

  private set = async (mode: HypercombMode) => {
    let cursorImage = ''
    switch (mode) {
      case HypercombMode.Move: cursorImage = 'assets/cursor/move-cursor.svg'; break
      case HypercombMode.EditMode: cursorImage = 'assets/cursor/edit-cursor.svg'; break
      case HypercombMode.Copy: cursorImage = 'assets/cursor/copy-cursor.svg'; break
      case HypercombMode.Cut: cursorImage = 'assets/cursor/cut-cursor.svg'; break
      default: cursorImage = ''; break
    }

    const canvas = this.pixi.app!.canvas as HTMLCanvasElement | undefined // ✅ safe now, Pixi is ready

    canvas!.style.cursor = cursorImage
      ? `url(${cursorImage}) 16 16, auto`
      : 'auto'

    this.mode_change.emitModeChange(mode)
  }

}


