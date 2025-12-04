import { Component, inject, input, output } from '@angular/core';
import { DebugService } from 'src/app/core/diagnostics/debug-service';
import { HypercombState } from 'src/app/state/core/hypercomb-state';

@Component({
  selector: 'app-search-box',
  standalone: true,
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss'
})
export class SearchBoxComponent {

  private readonly state = inject(HypercombState)
  private readonly debug = inject(DebugService)

  public value = input<string>('');
  public changed = output<string>();

  public focused($event: FocusEvent) {
    this.state.ignoreShortcuts = true
    this.debug.log("search", "Entered search box, shortcuts ignored.")
  }

  public unfocused($event: FocusEvent) {
    this.state.ignoreShortcuts = false
    this.debug.log("search", " Left search box, shortcuts enabled.")
  }

  public onInput(ev: Event) {
    const target = ev.target as HTMLInputElement;
    const value = target.value.trim()
    this.changed.emit(value);
  }
}
