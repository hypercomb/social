import { Component } from '@angular/core'
import { ServiceBase } from 'src/app/core/mixins/abstraction/service-base'
import { Events } from 'src/app/helper/events/events'

@Component({
  standalone: true,
  selector: '[app-help-page]',
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.scss']
})
export class HelpPageComponent extends ServiceBase {
  constructor() {
    super()

    document.addEventListener(Events.EscapeCancel, (_: any) => {
      this.close()
    })
  }
  close() {
    this.state.clearToolMode()

  }
}


