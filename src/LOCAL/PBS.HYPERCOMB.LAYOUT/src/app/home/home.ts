import { Component } from '@angular/core';
import { HexGridComponent } from "../pixi/hex-grid/hex-grid.component";
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";

@Component({
  selector: 'app-home',
  imports: [HexGridComponent, OpfsExplorerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
