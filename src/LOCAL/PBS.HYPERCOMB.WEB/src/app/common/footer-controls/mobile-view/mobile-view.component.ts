// src/app/common/footer-controls/mobile-view/mobile-view.component.ts
import { Component, inject } from '@angular/core'
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
  private readonly screen = inject(ScreenService)
  private readonly centersvc = inject(CenterTileService)
  private readonly registry = inject(ACTION_REGISTRY)

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
