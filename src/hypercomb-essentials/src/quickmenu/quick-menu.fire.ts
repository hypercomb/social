// quickmenu/quick-menu.fire.ts
//
// Run one quick-menu slot. Shared by the cursor ring and the tile layer so
// a verb does the same thing whichever surface drew it.

import { EffectBus } from '@hypercomb/core'
import type { QuickMenuSlot } from './quick-menu.types.js'

type SlashLike = { execute(name: string, args: string): unknown }

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** A pathway (`menu`) is not a verb — the caller changes rings instead.
 *  Everything else runs here. */
export function fireQuickMenuSlot(slot: QuickMenuSlot): void {
  const action = slot.action
  if (action.kind === 'menu') return
  if (action.kind === 'command') {
    const slash = get<SlashLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')
    try {
      void Promise.resolve(slash?.execute(action.command, action.args ?? '')).catch(err =>
        console.warn('[quick-menu] behaviour failed', action.command, err),
      )
    } catch (err) {
      console.warn('[quick-menu] behaviour threw', action.command, err)
    }
    return
  }
  if (action.kind === 'effect') {
    EffectBus.emit(action.effect, action.payload ?? {})
    return
  }
  if (action.kind === 'key') {
    for (const type of ['keydown', 'keyup'] as const) {
      window.dispatchEvent(new KeyboardEvent(type, { key: action.key, bubbles: true, cancelable: true }))
    }
  }
}
