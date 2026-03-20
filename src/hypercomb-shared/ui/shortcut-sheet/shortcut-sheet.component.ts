// shortcut-sheet.component.ts — Angular shell for keyboard shortcut overlay
//
// Subscribes to ShortcutSheetDrone state and renders grouped shortcuts
// in a glassmorphic modal. No business logic — just rendering.

import { Component, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus, type KeyBinding, type KeyChord } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'

import type { ShortcutSheetState, ShortcutGroup } from
  '@hypercomb/essentials/diamondcoreprocessor.com/ui/shortcut-sheet.drone'

@Component({
  selector: 'hc-shortcut-sheet',
  standalone: true,
  templateUrl: './shortcut-sheet.component.html',
  styleUrls: ['./shortcut-sheet.component.scss'],
})
export class ShortcutSheetComponent implements OnInit, OnDestroy {

  #drone: any
  #isMac = /Mac|iMac|Macintosh/.test(navigator.userAgent)
  #unsub: (() => void) | null = null

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/ShortcutSheetDrone') as EventTarget,
    () => (this.#drone?.state ?? { open: false, groups: [] }) as ShortcutSheetState,
  )

  readonly open = computed(() => this.state$().open)
  readonly groups = computed(() => this.state$().groups)

  readonly close = (): void => {
    EffectBus.emit('shortcut-sheet:close', undefined)
  }

  readonly formatSequence = (binding: KeyBinding): string[][] => {
    return binding.sequence.map(chord => this.#formatChord(chord))
  }

  #formatChord(chord: KeyChord[]): string[] {
    const parts: string[] = []
    for (const k of chord) {
      if (k.primary) parts.push(this.#isMac ? '\u2318' : 'Ctrl')
      if (k.ctrl) parts.push('Ctrl')
      if (k.alt) parts.push(this.#isMac ? '\u2325' : 'Alt')
      if (k.shift) parts.push(this.#isMac ? '\u21E7' : 'Shift')
      if (k.meta) parts.push(this.#isMac ? '\u2318' : 'Win')

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
      backspace: '\u232B', '/': '?',
    }
    return map[key] ?? key.toUpperCase()
  }

  ngOnInit(): void {
    this.#drone = get('@diamondcoreprocessor.com/ShortcutSheetDrone')

    // listen for Escape while sheet is open (pierce binding handles this)
    this.#unsub = EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
      if (payload?.cmd === 'global.escape' && this.open()) this.close()
    })
  }

  ngOnDestroy(): void {
    this.#drone = undefined
    this.#unsub?.()
  }
}
