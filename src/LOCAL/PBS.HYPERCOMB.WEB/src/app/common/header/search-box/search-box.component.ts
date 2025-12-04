import { Component, inject } from '@angular/core';
import { DebugService } from 'src/app/core/diagnostics/debug-service';
import { HypercombState } from 'src/app/state/core/hypercomb-state';
import { SearchFilter } from '../search-filter';

@Component({
  selector: 'app-search-box',
  standalone: true,
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss'
})
export class SearchBoxComponent {

  private readonly state = inject(HypercombState)
  private readonly debug = inject(DebugService)
  public readonly filter = inject(SearchFilter)

  public focused(_: FocusEvent) {
    this.state.ignoreShortcuts = true
    this.debug.log("search", "Entered search box, shortcuts ignored.")
  }

  public unfocused(_: FocusEvent) {
    this.state.ignoreShortcuts = false
    this.debug.log("search", "Left search box, shortcuts enabled.")
  }

  public onInput(ev: Event) {
    const target = ev.target as HTMLInputElement;
    const value = target.value.trim();
    this.filter.set(value);
  }

  /** optional: allow UI button or clear-on-escape */
  public clear() {
    this.filter.clear();
  }
}
  