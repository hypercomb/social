// src/app/common/footer-controls/mobile-view/mobile-view.component.ts
import { Component, HostListener, inject } from '@angular/core'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { ACTION_REGISTRY } from 'src/app/shared/tokens/i-hypercomb.token'
import { BackHiveAction } from 'src/app/actions/navigation/back.action'
import { CenterTileService } from 'src/app/cells/behaviors/center-tile-service'
import { ScreenService } from 'src/app/services/screen-service'

@Component({
  standalone: true,
  selector: 'app-mobile-view',
  templateUrl: './mobile-view.component.html',
  styleUrls: ['./mobile-view.component.scss']
})
export class MobileViewComponent extends Hypercomb {
list() {
throw new Error('Method not implemented.')
}
home() {
throw new Error('Method not implemented.')
}
  private readonly screen = inject(ScreenService)
  private readonly centersvc = inject(CenterTileService)
  private readonly registry = inject(ACTION_REGISTRY)


  private touchStartX = 0
  private touchEndX = 0
  private readonly swipeThreshold = 200

  // --- Swipe listeners ---
   @HostListener('document:touchstart', ['$event'])
    onTouchStart(event: TouchEvent) {
    this.touchStartX = event.changedTouches[0].screenX
  }

  @HostListener('document:touchend', ['$event'])
  async onTouchEnd(event: TouchEvent) {
    this.touchEndX = event.changedTouches[0].screenX
    await this.handleSwipe()
  }

  private async handleSwipe(): Promise<void> {
    const delta = this.touchEndX - this.touchStartX

    // Swipe Right → Go Back
    if (delta > this.swipeThreshold) {
      await this.goBack(new MouseEvent('swipe-right'))
      return
    }

    // Swipe Left → Your "Next" action or Center action
    if (delta < -this.swipeThreshold) {
      
      // Didn't know if we had a go forward action so centering for now
      await this.center()
      return
    }
  }


  public goBack = async (event: MouseEvent): Promise<void> => {
    await this.registry.invoke(BackHiveAction.ActionId, { event })
  }

  public center = async (): Promise<void> => {
    await this.centersvc.arrange()
  }

  public fullscreen = async (): Promise<void> => {
    this.screen.goFullscreen()
  }
}
