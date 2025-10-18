import { Component, inject } from '@angular/core'
import { Autservice } from 'src/app/core/auth/auth-service'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { ViewportService } from 'src/app/pixi/viewport-service'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { environment } from '../../../../environments/environment'
import { TouchDetectionService } from 'src/app/core/mobile/touch-detection-service'
import { ScreenService } from 'src/app/unsorted/utility/screen-service'
import { QUERY_COMB_SVC } from 'src/app/shared/tokens/i-comb-query.token'

@Component({
  standalone: true,
  selector: '[app-icon-menu]',
  templateUrl: './icon-menu.component.html',
  styleUrls: ['./icon-menu.component.scss']
})
export class IconMenuComponent extends Hypercomb {
  private readonly authorization = inject(Autservice)
  private readonly screen = inject(ScreenService)
  private readonly touch = inject(TouchDetectionService)
  public readonly viewport = inject(ViewportService)
  public readonly query = inject(QUERY_COMB_SVC)


  public HiveCreation = HypercombMode.HiveCreation
  public isHovered = false
  public isCreatingHive: any
  public isSignedIn = false
  public userName = ''

  public get awake(): boolean { return this.state.awake }
  public get environment(): boolean { return environment.production }

  public get iconsVisible(): boolean {
    return !this.screen.isFullScreen() || !this.touch.supportsEdit()
  }

  public get signInText(): string {
    return this.isSignedIn ? this.userLabelText : 'sign in'
  }

  public get userLabelText(): string { return this.state.username }

  public fitToScreen = async ($event: MouseEvent) => {
    $event.preventDefault()
    await this.viewport.fitToScreen(<any>this.query.fetchAll)
  }

  public initiateNewHive() { this.isCreatingHive = true }
  public onMouseEnter() { this.isHovered = true }
  public onMouseLeave() { this.isHovered = false }

  public publish = async (event: MouseEvent) => {
    event.preventDefault()
    // await this.publisher.publish()
    throw new Error('Not implemented')
  }

  public async togglePreferences(event: MouseEvent) {
    event.preventDefault()
    this.debug.log('misc', "ev: " + environment.production)
    this.state.toggleToolMode(HypercombMode.ShowPreferences)
  }

  public signIn = async (event: MouseEvent) => {
    this.authorization.signIn()
    event.preventDefault()
  }

  public async viewHelp(event: MouseEvent) {
    event?.preventDefault()
    this.state.toggleToolMode(HypercombMode.ViewHelp)
  }
}


