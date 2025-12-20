// src/app/common/header/search-bar/search-bar.component.ts

import { Component, inject, signal } from '@angular/core'
import { HypercombState } from '../../../core/hypercomb-state'
import { IntentWriter } from '../../../core/intent/intent.writer'
import { SignatureRegistry } from '../../../core/intent/signature.registry'

@Component({
  selector: 'hc-search-bar',
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent {

  protected readonly state = inject(HypercombState)
  private readonly intent = inject(IntentWriter)
  private readonly signatures = inject(SignatureRegistry)

  protected readonly text = signal('')
  protected readonly completion = signal<string | null>(null)
  protected readonly preview = signal<any | null>(null)

  protected onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    this.text.set(value)

    this.updateCompletion(value)

    const lineage = this.state.lineage()
    const scan = this.intent.scan(value, {
      lineage,
      capabilities: [],
      selection: this.state.selection() ?? undefined
    })

    this.preview.set(scan)
  }

  protected onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab' && this.completion()) {
      event.preventDefault()
      this.applyCompletion()
      return
    }

    if (event.key === 'Enter') {
      this.commit()
    }
  }

  protected commit = (): void => {
    const value = this.text().trim()
    if (!value) return

    const lineage = this.state.lineage()

    void this.intent.process(lineage, value, {
      lineage,
      capabilities: [],
      selection: this.state.selection() ?? undefined
    })

    this.text.set('')
    this.completion.set(null)
    this.preview.set(null)
  }

  // ─────────────────────────────────────────────
  // completion logic
  // ─────────────────────────────────────────────

  private updateCompletion = (value: string): void => {
    const parts = value.split(/\s+/)
    const current = parts.at(-1)

    const match = this.signatures.match(current)
    if (!match || match.exact) {
      this.completion.set(null)
      return
    }

    this.completion.set(match.kind)
  }

  private applyCompletion = (): void => {
    const value = this.text()
    const parts = value.split(/\s+/)

    parts[parts.length - 1] = this.completion()!
    this.text.set(parts.join(' ') + ' ')
    this.completion.set(null)
  }
}
