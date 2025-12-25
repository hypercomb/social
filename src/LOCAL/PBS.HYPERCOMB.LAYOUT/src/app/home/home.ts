import { Component } from '@angular/core';
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";
import { HistoryComponent } from "../common/history-component/history";

@Component({
  selector: 'app-home',
  imports: [HistoryComponent, OpfsExplorerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
