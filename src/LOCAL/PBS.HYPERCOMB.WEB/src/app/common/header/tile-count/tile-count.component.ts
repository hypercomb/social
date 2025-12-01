import { Component, input } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-tile-count',
  templateUrl: './tile-count.component.html',
  styleUrls: ['./tile-count.component.scss'],
})
export class TileCountComponent {
  count = input<number>(0);
}
