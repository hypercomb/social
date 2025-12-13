import { Component, inject } from '@angular/core';
import { CellOptions, HypercombMode } from 'src/app/core/models/enumerations';
import { Router } from '@angular/router';
import { SearchFilter } from '../search-filter';
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base';

@Component({
  selector: 'app-search-box',
  standalone: true,
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss'
})
export class SearchBoxComponent extends Hypercomb {

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

  public branch = async (event: MouseEvent): Promise<void> => {
    const cell = this.stack.cell()!
    cell.options.update(o => o | CellOptions.Branch)
    throw new Error('Method not implemented.')
  }


  public focused(_: FocusEvent) { this.state.ignoreShortcuts = true; }
  public unfocused(_: FocusEvent) { this.state.ignoreShortcuts = false; }
}
