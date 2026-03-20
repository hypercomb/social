// command-palette.component.ts — Angular shell for the command palette
//
// Subscribes to CommandPaletteDrone state and renders the palette UI.
// Forwards input changes and keyboard navigation back to the drone
// via EffectBus effects. No business logic lives here.

import {
  Component,
  computed,
  ElementRef,
  ViewChild,
  type AfterViewChecked,
  type OnInit,
  type OnDestroy,
} from '@angular/core'
import { EffectBus, type KeyBinding, type KeyChord } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'

import type { CommandPaletteState, PaletteItem } from
  '@hypercomb/essentials/diamondcoreprocessor.com/ui/command-palette.drone'

@Component({
  selector: 'hc-command-palette',
  standalone: true,
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
})
export class CommandPaletteComponent implements OnInit, AfterViewChecked, OnDestroy {

  @ViewChild('paletteInput') paletteInput!: ElementRef<HTMLInputElement>

  #drone: any
  #unsub: (() => void) | null = null
  #isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)
  #needsFocus = false

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/CommandPaletteDrone') as EventTarget,
    () => (this.#drone?.state ?? { open: false, query: '', activeIndex: 0, groups: [], totalCount: 0 }) as CommandPaletteState,
  )

  readonly open = computed(() => this.state$().open)
  readonly groups = computed(() => this.state$().groups)
  readonly activeIndex = computed(() => this.state$().activeIndex)
  readonly totalCount = computed(() => this.state$().totalCount)

  readonly close = (): void => {
    EffectBus.emit('command-palette:close', undefined)
  }

  readonly onInput = (event: Event): void => {
    const value = (event.target as HTMLInputElement).value
    EffectBus.emit('command-palette:input', { query: value })
  }

  readonly onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        EffectBus.emit('command-palette:nav', { direction: 'down' })
        break
      case 'ArrowUp':
        event.preventDefault()
        EffectBus.emit('command-palette:nav', { direction: 'up' })
        break
      case 'Enter':
        event.preventDefault()
        EffectBus.emit('command-palette:execute', undefined)
        break
      case 'Escape':
        event.preventDefault()
        this.close()
        break
    }
  }

  readonly executeAt = (index: number, event: MouseEvent): void => {
    event.preventDefault()
    EffectBus.emit('command-palette:execute-at', { index })
  }

  readonly setActive = (index: number): void => {
    // update active via nav to keep drone in sync
    // direct set via effect
    EffectBus.emit('command-palette:nav', { direction: 'set', index })
  }

  readonly formatShortcut = (binding: KeyBinding | null): string[][] => {
    if (!binding?.sequence?.length) return []
    return binding.sequence.map(chord => this.#formatChord(chord))
  }

  readonly highlightLabel = (item: PaletteItem): { text: string; highlighted: boolean }[] => {
    if (!item.matchIndices.length) return [{ text: item.label, highlighted: false }]

    const indices = new Set(item.matchIndices)
    const parts: { text: string; highlighted: boolean }[] = []
    let current = ''
    let currentHighlighted = false

    for (let i = 0; i < item.label.length; i++) {
      const isHighlighted = indices.has(i)
      if (i === 0) {
        currentHighlighted = isHighlighted
        current = item.label[i]
      } else if (isHighlighted === currentHighlighted) {
        current += item.label[i]
      } else {
        parts.push({ text: current, highlighted: currentHighlighted })
        current = item.label[i]
        currentHighlighted = isHighlighted
      }
    }
    if (current) parts.push({ text: current, highlighted: currentHighlighted })
    return parts
  }

  #formatChord(chord: KeyChord[]): string[] {
    const parts: string[] = []
    for (const k of chord) {
      if (k.primary) parts.push(this.#isMac ? '\u2318' : 'Ctrl')
      if (k.ctrl) parts.push('Ctrl')
      if (k.alt) parts.push(this.#isMac ? '\u2325' : 'Alt')
      if (k.shift) parts.push(this.#isMac ? '\u21E7' : 'Shift')

      const key = k.key ?? k.code ?? ''
      parts.push(this.#formatKey(key))
    }
    return parts
  }

  #formatKey(key: string): string {
    const map: Record<string, string> = {
      escape: 'Esc', arrowup: '\u2191', arrowdown: '\u2193',
      arrowleft: '\u2190', arrowright: '\u2192', delete: 'Del',
      enter: '\u21B5', space: 'Space', tab: 'Tab',
      backspace: '\u232B',
    }
    return map[key] ?? key.toUpperCase()
  }

  ngOnInit(): void {
    this.#drone = get('@diamondcoreprocessor.com/CommandPaletteDrone')

    // watch for open state to focus input
    this.#unsub = EffectBus.on('command-palette:state', () => {
      if (this.open()) this.#needsFocus = true
    })
  }

  ngAfterViewChecked(): void {
    if (this.#needsFocus && this.paletteInput?.nativeElement) {
      this.paletteInput.nativeElement.focus()
      this.#needsFocus = false
    }
  }

  ngOnDestroy(): void {
    this.#drone = undefined
    this.#unsub?.()
  }
}
