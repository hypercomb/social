import { Component, OnInit, inject } from "@angular/core"
import { ImageDatabase } from "src/app/database/images/image-database"
import { IdentifierService } from "src/app/database/utility/identifier-service"
import { Hypercomb } from "src/app/core/mixins/abstraction/hypercomb.base"
import { MousewheelZoomService } from "src/app/pixi/mousewheel-zoom-service"
import { RenderScheduler } from "src/app/unsorted/controller/render-scheduler"
import { AxialService } from "src/app/unsorted/utility/axial-service"
import { WakeupService } from "src/app/unsorted/wake-up-service"
import { environment } from "src/environments/environment"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { CELL_REPOSITORY } from "src/app/shared/tokens/i-cell-repository.token"
import { StartUpService } from "src/app/unsorted/start-up-service"
import { WheelState } from "../mouse/wheel-state"
import { PointerState } from "src/app/state/input/pointer-state"
import { ImageService } from "src/app/database/images/image-service"
import { ActionRegistry } from "src/app/actions/action-registry"
import { ImportDatabasesToOpfs } from "src/app/actions/propagation/import-to-ofps"

if (!environment.production) {
  // Dexie.delete('Database')
  // Dexie.delete('hypercomb-images')
}

@Component({
  standalone: true,
  selector: 'app-shell',
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss']
})
export class ShellComponent extends Hypercomb implements OnInit {
  private readonly pixiService = inject(PixiManager)
  private readonly pointerstate = inject(PointerState)
  private readonly axialService = inject(AxialService)
  private readonly imageService = inject(ImageService)
  private readonly mousewheelZoom = inject(MousewheelZoomService)
  private readonly wakeupService = inject(WakeupService)
  private readonly _startUpService = inject(StartUpService)
  private readonly wheelstate = inject(WheelState)

  // ðŸ”€ replace DatabaseFactory.getQueries() â†’ 
  private scheduler = inject(RenderScheduler)

  app: any
  sub: any
  routerSubscription: any

  async ngOnInit() {
    this.debug.log('ui', 'ShellComponent constructor')
    this.axialService.createMatrix()

    if (localStorage.getItem('debug') === 'true') {
      if (
        prompt(
          'Debug mode is enabled - press OK to continue, or Cancel to disable debug mode stop initialization.',
          'true'
        ) !== 'true'
      ) {
        return
      }
    }

    // used to be this.databaseFactory.initialize()
    console.log(this._startUpService)

    const app = await this.pixiService.initialize()
    this.scheduler.hook(app)

    // used to be this.databaseFactory.getQueries()
    await this.pointerstate.setContainer(this.pixiService.container!)
    await this.mousewheelZoom.initialize()
    await this.wheelstate.initialize()
    await this.wakeupService.initialize()
    await this.imageService.initialize()

    //await this.query.fetchAndStageAllHives()
    //await this.database.cloneCelasdfls(10)
    this.state.loading = false

  }
}


