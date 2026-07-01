// hypercomb-shared/core/icon-edit.service.ts
//
// IconEditMode — the global "reskin" mode for the universal icon protocol.
// Long-pressing any participating icon enters it; every opted-in icon then
// floats/wiggles (iOS-style) and a tap routes to the icon-hive picker instead
// of the icon's normal action. Escape exits.
//
// State is broadcast on EffectBus (`icon:edit-mode { on }`) so DOM (Angular)
// and Pixi surfaces react uniformly; `icon:pick-request { id }` asks the picker
// to open for a specific element. Registered at `@hypercomb.social/IconEditMode`.

import { EffectBus } from '@hypercomb/core'

const LONG_PRESS_MS = 500

export class IconEditMode extends EventTarget {
  #on = false
  #escapeWired = false

  get on(): boolean { return this.#on }

  enter(): void {
    if (this.#on) return
    this.#on = true
    this.#wireEscape()
    this.#broadcast()
  }

  exit(): void {
    if (!this.#on) return
    this.#on = false
    this.#broadcast()
  }

  toggle(): void { this.#on ? this.exit() : this.enter() }

  /** A participating icon was tapped while in edit mode — open the picker for it. */
  requestPick(id: string): void {
    if (!id) return
    EffectBus.emit('icon:pick-request', { id })
  }

  #broadcast(): void {
    EffectBus.emit('icon:edit-mode', { on: this.#on })
    this.dispatchEvent(new CustomEvent('change', { detail: { on: this.#on } }))
  }

  #wireEscape(): void {
    if (this.#escapeWired) return
    this.#escapeWired = true
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#on) this.exit()
    })
  }
}

export const iconEditMode = new IconEditMode()
register('@hypercomb.social/IconEditMode', iconEditMode)

/**
 * Wire long-press → enter edit mode on a DOM element. Returns a disposer.
 * Pointer up/leave/move before the threshold cancels. Safe on touch + mouse.
 */
export function attachIconLongPress(el: HTMLElement, onFire: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null } }
  const down = (): void => { clear(); timer = setTimeout(() => { timer = null; onFire() }, LONG_PRESS_MS) }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointerup', clear)
  el.addEventListener('pointerleave', clear)
  el.addEventListener('pointermove', clear)
  return () => {
    clear()
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointerup', clear)
    el.removeEventListener('pointerleave', clear)
    el.removeEventListener('pointermove', clear)
  }
}
