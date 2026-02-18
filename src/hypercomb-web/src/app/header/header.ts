import { Component } from '@angular/core';
import { SearchBarComponent } from '@hypercomb/shared/ui/search-bar/search-bar.component';
import { OpfsExplorerComponent } from "@hypercomb/shared/ui";

@Component({
  selector: 'app-header',
  imports: [SearchBarComponent, OpfsExplorerComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {

}
