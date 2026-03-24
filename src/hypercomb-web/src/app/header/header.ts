import { Component } from '@angular/core';
import { CommandLineComponent } from '@hypercomb/shared/ui/command-line/command-line.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommandLineComponent],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {

}
