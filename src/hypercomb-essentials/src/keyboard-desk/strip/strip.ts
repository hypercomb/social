// keyboard-desk/strip/strip.ts
//
// TRAIT `strip` — the lineup in hand, drawn left to right in the order it runs.
// Each step can move or come out, and the box at the end takes a typed step or a
// whole pasted script.

import type { Say, StripHandle, StripPart } from '../parts.js'

export const stripPart: StripPart = {
  create(events, say: Say): StripHandle {
    const el = document.createElement('section')
    el.className = 'kb-strip'
    el.setAttribute('data-consumes-wheel', '')
    const head = document.createElement('div')
    head.className = 'kb-strip-head'
    const steps = document.createElement('ol')
    steps.className = 'kb-steps'
    const script = document.createElement('input')
    script.className = 'kb-script'
    script.type = 'text'
    script.placeholder = say('keyboard.script', 'say a step, or paste a script')
    script.setAttribute('aria-label', script.placeholder)
    el.append(head, steps, script)

    const take = (text: string): void => {
      if (text.trim()) events.onScript(text)
      script.value = ''
    }
    script.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      take(script.value)
    })
    // A field drops line breaks, and a script is its line breaks.
    script.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text') ?? ''
      if (!/\r?\n/.test(text.trim())) return
      event.preventDefault()
      take(text)
    })

    const control = (glyph: string, label: string, act: () => void): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'kb-step-move'
      btn.textContent = glyph
      btn.title = label
      btn.setAttribute('aria-label', label)
      btn.addEventListener('click', act)
      return btn
    }

    const step = (label: string, index: number, last: number): HTMLElement => {
      const item = document.createElement('li')
      item.className = 'kb-step'
      const at = document.createElement('span')
      at.className = 'kb-step-at'
      at.textContent = String(index + 1)
      const text = document.createElement('span')
      text.className = 'kb-step-text'
      text.textContent = label
      text.title = label
      const earlier = control('‹', say('keyboard.step-left', 'move earlier'), () => events.onMove(index, -1))
      earlier.disabled = index === 0
      const later = control('›', say('keyboard.step-right', 'move later'), () => events.onMove(index, 1))
      later.disabled = index === last
      item.append(at, text, earlier, later, control('×', say('keyboard.step-remove', 'take out of the lineup'), () => events.onRemove(index)))
      return item
    }

    return {
      el,
      show(labels, chord): void {
        const about = document.createElement('i')
        about.textContent = chord
          ? say('keyboard.lineup-for', 'runs on {chord}', { chord })
          : labels.length ? say('keyboard.lineup-draft', 'press a key to bind it')
            : say('keyboard.lineup-empty', 'nothing yet: choose from the list')
        head.replaceChildren(say('keyboard.lineup', 'lineup'), about)
        steps.replaceChildren(...labels.map((label, index) => step(label, index, labels.length - 1)))
      },
    }
  },
}
