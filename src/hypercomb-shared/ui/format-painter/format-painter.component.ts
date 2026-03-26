// format-painter.component.ts — Angular shell for the /format painter sidebar
//
// Subscribes to FormatPainterDrone state and renders a right-side panel
// with property entries (color swatches + checkboxes) and an Apply button.

import { ChangeDetectorRef, Component, computed, inject, signal, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

import type { FormatPainterState } from
  '@hypercomb/essentials/diamondcoreprocessor.com/format/format-painter.drone'

const EMPTY: FormatPainterState = { open: false, sourceSeed: null, entries: [] }

@Component({
  selector: 'hc-format-painter',
  standalone: true,
  templateUrl: './format-painter.component.html',
  styleUrls: ['./format-painter.component.scss'],
})
export class FormatPainterComponent implements OnInit, OnDestroy {

  #cdr = inject(ChangeDetectorRef)
  #unsubs: (() => void)[] = []

  private readonly state$ = signal<FormatPainterState>(EMPTY)

  readonly open = computed(() => this.state$().open)
  readonly sourceSeed = computed(() => this.state$().sourceSeed)
  readonly entries = computed(() => this.state$().entries)
  readonly hasEntries = computed(() => this.state$().entries.length > 0)
  readonly enabledCount = computed(() => this.state$().entries.filter(e => e.enabled).length)

  readonly close = (): void => {
    EffectBus.emit('format:close', {})
  }

  readonly toggleEntry = (key: string): void => {
    EffectBus.emit('format:toggle-entry', { key })
  }

  readonly apply = (): void => {
    EffectBus.emit('format:apply', {})
  }

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<FormatPainterState>('format:state', (state) => {
        this.state$.set(state)
        this.#cdr.detectChanges()
      }),
      EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
        if (payload?.cmd === 'global.escape' && this.open()) this.close()
      }),
    )
  }

  ngOnDestroy(): void {
    for (const unsub of this.#unsubs) unsub()
  }
}
