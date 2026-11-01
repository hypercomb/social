// comfy-desk/knobs/knobs.ts
//
// ONE CONTROL PER SEAM. The card is what this workflow offers, never a fixed
// list, so a knob that would turn nothing is never drawn.

import { make, NUMBER_KNOBS, setField, type CardHandle, type CardPart, type DeskState, type NumberKnob } from '../parts.js'

/** Whole catalog keys, so no key is built out of two halves at runtime. */
const LABELS: Record<NumberKnob, readonly [string, string]> = {
  width: ['comfy.width', 'width'],
  height: ['comfy.height', 'height'],
  steps: ['comfy.steps', 'steps'],
  cfg: ['comfy.cfg', 'cfg'],
  batch: ['comfy.batch', 'how many'],
}

export const knobsPart: CardPart = {
  /** Short enough to sit on a tab: `512×768 · 20 · #42`. */
  value(state): string {
    const { numbers, seed } = state.form.values
    const size = numbers['width'] && numbers['height'] ? `${numbers['width']}×${numbers['height']}` : ''
    return [size, numbers['steps'] ?? '', seed.trim() ? `#${seed.trim()}` : ''].filter(Boolean).join(' · ')
  },
  create(context): CardHandle {
    const { say, form } = context
    const el = make('div', 'te-dg-fld')
    const grid = make('div', 'cd-grid')
    const fields = new Map<NumberKnob, { row: HTMLElement; input: HTMLInputElement }>()
    for (const knob of NUMBER_KNOBS) {
      const row = make('label', 'cd-number')
      const [key, fallback] = LABELS[knob]
      const input = make('input', 'te-dg-input')
      input.type = 'number'
      input.addEventListener('input', () => { form.setNumber(knob, input.value); context.changed() })
      row.append(make('span', 'te-dg-sub', say(key, fallback)), input)
      grid.append(row)
      fields.set(knob, { row, input })
    }
    const seed = make('input', 'te-dg-input')
    seed.type = 'text'
    seed.placeholder = say('comfy.seed-hint', 'seed — blank for a new one each time')
    seed.setAttribute('aria-label', say('comfy.seed', 'seed'))
    seed.addEventListener('input', () => { form.set({ seed: seed.value }); context.changed() })
    el.append(grid, seed)
    return {
      el,
      paint(state: DeskState): void {
        const { numbers, seed: held } = state.form.values
        for (const [knob, field] of fields) {
          field.row.hidden = !state.form.offers(knob)
          setField(field.input, numbers[knob] ?? '')
        }
        seed.hidden = !state.form.offers('seed')
        setField(seed, held)
      },
    }
  },
}
