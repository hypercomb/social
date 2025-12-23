import { Component } from '@angular/core';
import { OpfsExplorerComponent } from "../common/file-explorer/opfs-explorer.component";

@Component({
  selector: 'app-home',
  imports: [ OpfsExplorerComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
