// quickmenu/quick-menu.guide.ts
//
// The guide: a strip that stays up for as long as the flower does, so the
// participant always knows what the menu is about, where in it they are, and
// what the next move does.
//
//   hide › Edit › remove 3 tiles            the breadcrumb: the tile, the rings
//   Release Alt to run it · Right-click…    walked, then the option under the pointer
//
// The tile leads, because every verb here is about it; the rest of the
// crumbs are the rings taken to get here. Once an option is under the pointer
// the strip says what it will do to WHICH tiles, and how to confirm it.

import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { QuickMenuSlot } from './quick-menu.types.js'

/** What the flower is doing, as far as the guide is concerned. */
export type GuideInput = {
  /** The tile the flower was raised over. */
  readonly subject: string | null
  /** The tiles a tile verb will reach (quick-menu.operands.ts). */
  readonly operands: readonly string[]
  /** Titles of the rings walked into, past the first. */
  readonly path: readonly string[]
  /** The option under the pointer, already worded. */
  readonly lit: { readonly label: string; readonly slot: QuickMenuSlot | undefined } | null
  /** After a right-click back: the options sleep until the pointer is in the middle. */
  readonly asleep: boolean
}

export type Guide = {
  readonly crumbs: readonly string[]
  /** The last crumb is the option under the pointer. */
  readonly litLast: boolean
  readonly instruction: string
}

const get = <T,>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

/** The catalog's wording, falling back to the English given. */
function say(key: string, fallback: string): string {
  const translated = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
  return translated && translated !== key ? translated : fallback
}

/** Whom a tile verb will reach, said short: the tile, or how many. */
export function reach(subject: string | null, operands: readonly string[]): string {
  if (operands.length > 1) return `${operands.length} ${say('quickmenu.guide.tiles', 'tiles')}`
  return operands[0] ?? subject ?? ''
}

/** How the option under the pointer is confirmed. */
function confirm(slot: QuickMenuSlot | undefined): string {
  switch (slot?.activation) {
    case 'click': return say('quickmenu.guide.click', 'Click or press Enter to run it')
    case 'hold': return say('quickmenu.guide.hold', 'Rest here to run it')
    case 'arrive': return say('quickmenu.guide.arrive', 'Runs as you arrive')
    default: return say('quickmenu.guide.release', 'Release Alt, click or press Enter to run it')
  }
}

/** The breadcrumb and the instruction for one moment of the flower. Pure. */
export function guideFor(input: GuideInput): Guide {
  const lead = input.subject
    ? input.operands.length > 1 && input.operands.includes(input.subject)
      ? `${input.subject} +${input.operands.length - 1}`
      : input.subject
    : reach(null, input.operands)
  const crumbs = [lead, ...input.path].filter(Boolean)

  const back = say('quickmenu.guide.back', 'Right-click goes back')
  const leave = say('quickmenu.guide.leave', 'Release Alt to close')
  const walked = input.path.length > 0

  if (input.asleep) {
    return { crumbs, litLast: false, instruction: say('quickmenu.guide.wake', 'Move to the middle to wake the options') }
  }
  if (!input.lit) {
    return {
      crumbs,
      litLast: false,
      instruction: `${say('quickmenu.guide.aim', 'Aim at an option')} · ${walked ? back : leave}`,
    }
  }
  const { label, slot } = input.lit
  // Say what it does to whom, only for a verb that is about tiles.
  const named = slot?.onTile ? `${label} ${reach(input.subject, input.operands)}`.trim() : label
  return {
    crumbs: [...crumbs, named],
    litLast: true,
    instruction: `${confirm(slot)} · ${walked ? back : leave}`,
  }
}

// ── the strip ─────────────────────────────────────────────────────────

const TEXT_ON = '#d8e6ee'
const TEXT_OFF = '#8aa0ac'
const ACCENT = '#d9a441'
const SEPARATOR = ' › '

/** Fixed to the top of the screen, above the flower and under the faux pointer.
 *  It takes no input. */
export class QuickMenuGuide {
  #root: HTMLElement | null = null
  #crumbs: HTMLElement | null = null
  #instruction: HTMLElement | null = null

  show(guide: Guide, area: { left: number; top: number; right: number }): void {
    const root = this.#ensure()
    const crumbs = this.#crumbs!
    crumbs.replaceChildren()
    guide.crumbs.forEach((crumb, at) => {
      if (at > 0) crumbs.appendChild(this.#span(SEPARATOR, TEXT_OFF))
      const last = at === guide.crumbs.length - 1
      crumbs.appendChild(this.#span(crumb, last && guide.litLast ? ACCENT : TEXT_ON))
    })
    this.#instruction!.textContent = guide.instruction
    root.style.left = `${(area.left + area.right) / 2}px`
    root.style.top = `${area.top + 12}px`
    root.style.display = 'flex'
  }

  hide(): void {
    this.#root?.remove()
  }

  #span(text: string, colour: string): HTMLElement {
    const span = document.createElement('span')
    span.textContent = text
    span.style.color = colour
    return span
  }

  #ensure(): HTMLElement {
    if (!this.#root) {
      const root = document.createElement('div')
      root.setAttribute('aria-live', 'polite')
      root.style.cssText = [
        'position:fixed', 'transform:translateX(-50%)', 'max-width:min(92vw,40rem)',
        'flex-direction:column', 'align-items:center', 'gap:.25rem', 'padding:.5rem .9rem',
        'background:rgba(11,15,20,.88)', 'border:1px solid rgba(126,182,214,.4)',
        'font:600 .95rem/1.2 var(--hc-font, system-ui, sans-serif)', 'text-align:center',
        'pointer-events:none', 'z-index:2147482999',
      ].join(';')
      const crumbs = document.createElement('div')
      const instruction = document.createElement('div')
      instruction.style.cssText = `font-weight:500;font-size:.8rem;color:${TEXT_OFF}`
      root.append(crumbs, instruction)
      this.#root = root
      this.#crumbs = crumbs
      this.#instruction = instruction
    }
    if (!this.#root.isConnected) document.body.appendChild(this.#root)
    return this.#root
  }
}
