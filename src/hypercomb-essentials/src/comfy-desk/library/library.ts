// comfy-desk/library/library.ts
//
// THE KEPT PROMPTS. Keep writes the words and the knobs into `comfy:prompts`,
// one state per member, named by its own bytes. A row opens the rest; Use puts
// that state back into the form. Generate stays the participant's own press.

import { make, type CardHandle, type CardPart, type DeskState, type Say } from '../parts.js'

type Row = DeskState['payload']['prompts'][number]

const detailOf = (row: Row, say: Say): readonly string[] => [
  row.label || row.workflow || '',
  row.model ?? '',
  row.width != null || row.height != null ? `${row.width ?? ''} × ${row.height ?? ''}` : '',
  row.steps != null ? `${say('comfy.steps', 'steps')} ${row.steps}` : '',
  row.cfg != null ? `${say('comfy.cfg', 'cfg')} ${row.cfg}` : '',
  row.batch != null ? `${say('comfy.batch', 'how many')} ${row.batch}` : '',
  row.seed != null ? `${say('comfy.seed', 'seed')} ${row.seed}` : '',
  row.negative ?? '',
  row.fromTile ? say('comfy.from-tile', 'From the tile') : '',
].filter(Boolean)

export const libraryPart: CardPart = {
  value: state => state.payload.prompts.length ? String(state.payload.prompts.length) : '',
  create(context): CardHandle {
    const { say, intent, form } = context
    const el = make('div', 'te-dg-fld')
    let chosen = ''
    let last: DeskState | null = null

    const keep = make('button', 'te-dg-word', say('comfy.keep-prompt', 'Keep'))
    keep.type = 'button'
    const need = make('p', 'te-dg-sub cd-note', say('comfy.keep-need', 'Write the prompt first.'))
    need.hidden = true
    keep.addEventListener('click', () => {
      const lacking = !form.offers('positive') || !form.values.positive.trim()
      need.hidden = !lacking
      if (!lacking) intent('comfy:save-prompt', form.params())
      context.changed()
    })

    const list = make('ul', 'cd-prompts')
    const empty = make('p', 'te-dg-sub cd-note', say('comfy.library-empty', 'Nothing kept yet.'))
    const detail = make('div', 'cd-prompt-detail')

    const paint = (state: DeskState): void => {
      last = state
      const rows = state.payload.prompts
      if (!rows.some(row => row.sig === chosen)) chosen = ''
      empty.hidden = rows.length > 0
      list.replaceChildren(...rows.map(row => {
        const item = make('li')
        const button = make('button', 'cd-prompt-row', row.text)
        button.type = 'button'
        if (row.sig === chosen) button.dataset['on'] = ''
        button.addEventListener('click', () => {
          chosen = row.sig
          if (last) paint(last)
          context.changed()
        })
        item.append(button)
        return item
      }))
      const row = rows.find(one => one.sig === chosen)
      detail.replaceChildren()
      if (!row) return
      for (const line of detailOf(row, say)) detail.append(make('p', '', line))
      const use = make('button', 'te-dg-word', say('comfy.use-prompt', 'Use'))
      use.type = 'button'
      use.addEventListener('click', () => intent('comfy:use-prompt', { sig: row.sig }))
      detail.append(use)
    }

    el.append(keep, need, empty, list, detail)
    return { el, paint }
  },
}
