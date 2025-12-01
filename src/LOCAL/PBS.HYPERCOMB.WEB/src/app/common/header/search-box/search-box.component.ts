import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-search-box',
  standalone: true,
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss'
})
export class SearchBoxComponent {
  value = input<string>('');
  changed = output<string>();

  onInput(ev: Event) {
    const target = ev.target as HTMLInputElement;
    this.changed.emit(target.value);
  }
}
