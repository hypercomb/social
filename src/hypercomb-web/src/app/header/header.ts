import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import '@hypercomb/shared/ui/command-line/command-line.element';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class Header {

}
