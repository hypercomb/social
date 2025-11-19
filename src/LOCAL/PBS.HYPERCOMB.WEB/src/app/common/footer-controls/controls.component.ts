// src/app/common/footer-controls/controls.component.ts
import { Component, OnInit } from '@angular/core'
import { ControlsActiveDirective } from 'src/app/core/directives/controls-active-directive'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { Constants } from 'src/app/unsorted/constants'
import { environment } from 'src/environments/environment'
import { DefaultViewComponent } from './default-view/default-view.component'
import { MobileViewComponent } from './mobile-view/mobile-view.component'

@Component({
  standalone: true,
  selector: '[app-controls]',
  templateUrl: './controls.component.html',
  styleUrls: ['./controls.component.scss'],
  imports: [
    ControlsActiveDirective,
    MobileViewComponent,
    DefaultViewComponent
  ]
})
export class ControlsComponent extends Hypercomb implements OnInit {
  public ViewingGoogleDoc: HypercombMode = HypercombMode.ViewingGoogleDocument

  public get link(): string {
    return environment.production ? this.ls.link : this.ls.information
  }

  public ngOnInit(): void {
    // initialize build mode on desktop only
    this.state.isBuildMode = !this.state.isMobile && localStorage.getItem(Constants.BuildMode) === 'true'
  }
}
