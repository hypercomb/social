// hypercomb-shared/ui/hint-bar/hint-bar.component.ts
//
// Reusable intellisense breadcrumb bar — shows all available options as
// small crumbs, left-aligned at the bottom of the viewport.  As the user
// types, items that no longer match fade out while matches remain bright.
// Clicking a crumb emits `pick` so any parent can accept it.

import { Component, computed, input, output } from '@angular/core'

@Component({
  selector: 'hc-hint-bar',
  standalone: true,
  templateUrl: './hint-bar.component.html',
  styleUrls: ['./hint-bar.component.scss'],
})
export class HintBarComponent {

  /** Full universe of options to display. */
  readonly items = input<readonly string[]>([])

  /** Current typed fragment — items starting with this stay bright. */
  readonly filter = input('')

  /** Items already chosen (shown as active). */
  readonly chosen = input<ReadonlySet<string>>(new Set())

  /** Optional color swatches keyed by item name (CSS color string). */
  readonly colorMap = input<ReadonlyMap<string, string>>(new Map())

  /** Emitted when the user clicks a crumb. */
  readonly pick = output<string>()

  readonly visible = computed(() => this.items().length > 0)

  /** Items that match the current filter. */
  readonly matched = computed<ReadonlySet<string>>(() => {
    const f = this.filter().toLowerCase()
    if (!f) return new Set(this.items())
    return new Set(this.items().filter(item => item.toLowerCase().startsWith(f)))
  })

  isMatched = (item: string): boolean => this.matched().has(item)
  isChosen = (item: string): boolean => this.chosen().has(item)
  colorFor = (item: string): string => this.colorMap().get(item) ?? ''

  onPick(item: string, event: MouseEvent): void {
    event.preventDefault()
    this.pick.emit(item)
  }
}
