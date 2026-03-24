// shortcut-sheet.component.ts — Angular shell for keyboard shortcut overlay
//
// Subscribes to ShortcutSheetDrone state and renders grouped shortcuts
// in a glassmorphic modal. No business logic — just rendering.

import { Component, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus, formatChord, type KeyBinding } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'

import type { ShortcutSheetState } from
  '@hypercomb/essentials/diamondcoreprocessor.com/commands/shortcut-sheet.drone'

@Component({
  selector: 'hc-shortcut-sheet',
  standalone: true,
  templateUrl: './shortcut-sheet.component.html',
  styleUrls: ['./shortcut-sheet.component.scss'],
})
export class ShortcutSheetComponent implements OnInit, OnDestroy {

  #drone: any
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
    return binding.sequence.map(chord => formatChord(chord))
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
