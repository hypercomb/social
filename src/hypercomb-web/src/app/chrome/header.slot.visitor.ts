// THE COMMAND LINE COMES WITH THE HIVE. A published site's visitor mounts the
// header only when they reach the hexagons (app.ts `chrome`), yet the command
// line and shell inside it (~137 KB) sat in the first script every visitor
// downloads. Here they are their own chunk, fetched when this stand-in mounts;
// the stand-in renders nothing of its own (display: contents).
import { Component } from '@angular/core'
import { Header as RealHeader } from '../header/header'

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RealHeader],
  template: `@defer (on immediate) { <app-header /> }`,
  styles: [':host { display: contents }'],
})
export class Header {}
