import { Component } from '@angular/core';
import { HexGridComponent } from "../pixi/hex-grid/hex-grid.component";

@Component({
  selector: 'app-home',
  imports: [HexGridComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {

}
