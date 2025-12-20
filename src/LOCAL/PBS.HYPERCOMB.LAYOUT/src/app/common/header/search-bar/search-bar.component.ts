// src/app/common/header/search-bar/search-bar.component.ts

import { Component, inject, signal } from '@angular/core'
import { HypercombState } from '../../../core/hypercomb-state'
import { IntentWriter } from '../../../core/intent/intent.writer'


@Component({
  selector: 'hc-search-bar',
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent {
  protected readonly state = inject(HypercombState)
  private readonly intent = inject(IntentWriter)

  protected readonly text = signal('')

  protected onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    this.text.set(value)
  }

  protected onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') this.commit()
  }

  protected commit = (): void => {
    const value = this.text().trim()
    if (!value) return

    const lineage = this.state.lineage()
    const selection = this.state.selection() ?? undefined

    void this.intent.process(lineage, value, {
      lineage,
      capabilities: [],
      selection
    })

    this.text.set('')
  }


}
