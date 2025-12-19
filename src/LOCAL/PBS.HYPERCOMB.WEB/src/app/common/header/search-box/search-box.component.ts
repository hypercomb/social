// src/app/common/header/search-box/search-box.component.ts
import { Component, inject } from '@angular/core'
import { Router } from '@angular/router'
import { SearchFilter } from '../search-filter'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { TextIntentSource } from 'src/app/core/intent/text-intent.source'
import { HypercombMode } from 'src/app/core/models/enumerations'

@Component({
  selector: 'app-search-box',
  standalone: true,
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss'
})
export class SearchBoxComponent extends Hypercomb {

  private readonly router = inject(Router)
  private readonly textIntent = inject(TextIntentSource)
  public readonly filter = inject(SearchFilter)

  public isCreationMode(): boolean {
    return this.state.hasMode(HypercombMode.HiveCreation)
  }

  public onInput(ev: Event): void {
    const target = ev.target as HTMLInputElement
    const value = target.value.trim()

    // stage text only; commit happens on action
    if (!this.isCreationMode()) {
      this.filter.set(value)
    }
  }

  public onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      this.onAction()
    }
  }

  /** right button / enter commits intention */
  public async onAction(): Promise<void> {
    const value = this.filter.value().trim()
    if (!value) return

    // commit text as intention (no execution)
    await this.textIntent.ingest(
      this.state.lineage(), // current lineage
      value
    )

    // // legacy behavior preserved
    // if (this.isCreationMode()) {
    //   await this.createHive()
    // } else {
    //   this.state.setMode(HypercombMode.HiveCreation)
    //   this.filter.clear()
    // }
  }

  // private async createHive(): Promise<void> {
  //   const name = this.filter.value().trim()
  //   if (!name) return

  //   this.debug.log('create-hive', name)
  //   await this.router.navigateByUrl('/' + name)

  //   this.state.removeMode(HypercombMode.HiveCreation)
  //   this.filter.clear()
  // }

  public branch = async (_: MouseEvent): Promise<void> => {
    const cell = this.stack.seed()!
    // cell.options.update(o => o | CellOptions.Branch)
  }

  public focused(_: FocusEvent): void {
    this.state.ignoreShortcuts = true
  }

  public unfocused(_: FocusEvent): void {
    this.state.ignoreShortcuts = false
  }
}
