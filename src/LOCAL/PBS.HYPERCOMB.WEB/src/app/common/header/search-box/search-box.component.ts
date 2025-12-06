import { Component, inject } from '@angular/core';
import { DebugService } from 'src/app/core/diagnostics/debug-service';
import { HypercombState } from 'src/app/state/core/hypercomb-state';
import { HypercombMode } from 'src/app/core/models/enumerations';
import { Router } from '@angular/router';
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
  private readonly router = inject(Router)
  public readonly filter = inject(SearchFilter)

  public isCreationMode() {
    return this.state.hasMode(HypercombMode.HiveCreation);
  }

  public onInput(ev: Event) {
    const target = ev.target as HTMLInputElement;
    const value = target.value.trim();

    if (!this.isCreationMode()) {
      this.filter.set(value);
    }
  }

  /** right button action handler */
  public async onAction() {
    if (this.isCreationMode()) {
      await this.createHive();
    } else {
      this.state.setMode(HypercombMode.HiveCreation);
      this.filter.clear();
    }
  }

  private async createHive() {
    const name = this.filter.value().trim();
    if (!name) return;

    this.debug.log("create-hive", name);

    await this.router.navigateByUrl('/' + name);

    this.state.removeMode(HypercombMode.HiveCreation);
    this.filter.clear();
  }

  public focused(_: FocusEvent) { this.state.ignoreShortcuts = true; }
  public unfocused(_: FocusEvent) { this.state.ignoreShortcuts = false; }
}
