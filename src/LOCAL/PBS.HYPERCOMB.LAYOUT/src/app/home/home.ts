import { Component } from '@angular/core';
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";
import { HistoryComponent } from "../common/history-component/history";
import { PortalOverlayComponent } from "../common/portal/portal-overlay.component";

@Component({
  selector: 'app-home',
  imports: [HistoryComponent, OpfsExplorerComponent, PortalOverlayComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
