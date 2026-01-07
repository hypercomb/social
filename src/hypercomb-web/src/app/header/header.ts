import { Component } from '@angular/core';
import { SearchBarComponent } from "../common/header/search-bar/search-bar.component";

@Component({
  selector: 'app-header',
  imports: [SearchBarComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {

}
