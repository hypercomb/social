import { Component } from '@angular/core';

/** The catch-all lineage route's component. The shell renders the hive from
 *  the Pixi host and the registry-fed surfaces, so this template is empty by
 *  design — the route exists to consume the URL segments (see
 *  `lineageMatcher`), not to draw anything. */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {}
