import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from "./header/header";
import { Footer } from "./footer/footer";
import { HexGridComponent } from './pixi/hex-grid/hex-grid.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    Header,
    HexGridComponent,
    Footer], // , OpfsExplorerComponent
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('PBS.HYPERCOMB.LAYOUT');
  public showHeader: boolean = true
  public showFooter: boolean = true
  constructor() {

  }
}



// three columns on the header
// mobile view
//  -- header  left is logo, middle is centered caption (focused tile), right is menu icons