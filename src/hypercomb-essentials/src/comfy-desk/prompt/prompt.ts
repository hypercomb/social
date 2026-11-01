// comfy-desk/prompt/prompt.ts
//
// THE WORDS. What the picture should be, a new roll of them, and whether the
// selected tiles help write them.

import { make, setField, wordField, type CardHandle, type CardPart, type DeskState } from '../parts.js'

const word = (label: string, act: () => void): HTMLButtonElement => {
  const button = make('button', 'te-dg-word', label)
  button.type = 'button'
  button.addEventListener('click', act)
  return button
}

export const promptPart: CardPart = {
  value: state => state.form.values.positive.trim().replace(/\s+/g, ' '),
  create(context): CardHandle {
    const { say, intent, form } = context
    const el = make('div', 'te-dg-fld')
    const field = wordField(say('comfy.prompt', 'What should the picture be?'), 6, context)
    field.addEventListener('input', () => { form.set({ positive: field.value }); context.changed() })

    const rolls = make('div', 'te-dg-rowf')
    rolls.append(
      word(say('comfy.suggest', 'Suggest'), () => context.suggest()),
      word(say('comfy.roll-words', 'Common words'), () => intent('comfy:roll', { kind: 'words' })),
      word(say('comfy.roll-tile', 'New from tile'), () => intent('comfy:roll', { kind: 'tile' })),
    )

    const check = make('input')
    check.type = 'checkbox'
    check.addEventListener('change', () => { form.set({ fromTile: check.checked }); context.changed() })
    const helpWord = make('label', 'cd-check')
    helpWord.append(check, make('span', '', say('comfy.from-tile', 'From the tile')))

    const reviewers = make('input', 'te-dg-input cd-short')
    reviewers.type = 'number'
    reviewers.min = '1'
    reviewers.max = '8'
    reviewers.setAttribute('aria-label', say('comfy.reviewers', 'reviewers'))
    reviewers.addEventListener('change', () => {
      const n = Math.round(Number(reviewers.value))
      const clamped = Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 3
      reviewers.value = String(clamped)
      form.set({ reviewers: clamped })
    })
    const reviewersRow = make('label', 'cd-check')
    reviewersRow.append(make('span', '', say('comfy.reviewers', 'reviewers')), reviewers)

    const help = make('div', 'te-dg-rowf te-dg-between')
    help.append(helpWord, reviewersRow)
    const note = make('p', 'te-dg-sub cd-note', say('comfy.from-tile-note', 'Selected tiles lend their picture and their properties. Reviewers offer prompts. Jev picks one. Your words stay in it.'))

    el.append(field, rolls, help, note)
    return {
      el,
      focus: () => field.focus(),
      paint(state: DeskState): void {
        const held = state.form.values
        setField(field, held.positive)
        check.checked = held.fromTile
        setField(reviewers, String(held.reviewers))
        note.hidden = !held.fromTile
      },
    }
  },
}
