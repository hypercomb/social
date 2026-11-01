// comfy-desk/negative/negative.ts
//
// WHAT IT SHOULD NOT BE. Its own seam, so its own card: a workflow with one
// encoder in both slots offers none, and this row is then never drawn.

import { make, setField, wordField, type CardHandle, type CardPart } from '../parts.js'

export const negativePart: CardPart = {
  value: state => state.form.values.negative.trim().replace(/\s+/g, ' '),
  create(context): CardHandle {
    const el = make('div', 'te-dg-fld')
    const field = wordField(context.say('comfy.negative', 'and not…'), 3, context)
    field.addEventListener('input', () => { context.form.set({ negative: field.value }); context.changed() })
    el.append(field)
    return {
      el,
      focus: () => field.focus(),
      paint: state => setField(field, state.form.values.negative),
    }
  },
}
