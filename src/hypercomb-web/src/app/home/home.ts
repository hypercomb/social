import { Component, inject } from '@angular/core';
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";
import { PortalOverlayComponent } from "../common/portal/portal-overlay.component";
import { ResourceMessageHandler } from '../messaging/resource-message-handler';

@Component({
  selector: 'app-home',
  imports: [OpfsExplorerComponent, PortalOverlayComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  private handler = inject(ResourceMessageHandler)

  ngOnDestroy(): void {
    this.handler.destroy()
  }
}
