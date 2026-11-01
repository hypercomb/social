// comfy-desk/place/place.ts
//
// PUT IT ON THE SCREEN, LATER. A picture on the shelf is an asset until it is
// asked for. This card is where it is asked for: on the tiles selected in the
// hive, on a tile chosen from the list, or as a new tile under a typed name.
// Every door names the picture by its signature. `Use` is the other way round:
// the recipe that made it goes back into the form.

import { make, type CardHandle, type CardPart, type DeskState } from '../parts.js'

export const placePart: CardPart = {
  value: state => state.asset?.record.name ?? '',
  create(context): CardHandle {
    const { say, intent } = context
    const el = make('div', 'te-dg-fld')
    let sig = ''
    let targets: readonly string[] = []

    const onSelected = make('button', 'te-dg-word')
    onSelected.type = 'button'
    onSelected.addEventListener('click', () => {
      for (const cell of targets) intent('comfy:place-asset', { sig, cell })
    })

    const choose = make('button', 'te-dg-word', say('comfy.place-choose', 'choose a tile'))
    choose.type = 'button'
    choose.addEventListener('click', () => {
      const held = sig
      context.chooseTile(tile => intent('comfy:place-asset', { sig: held, cell: tile.name, segments: [...tile.parent] }))
    })

    const name = make('input', 'te-dg-input')
    name.type = 'text'
    name.placeholder = say('comfy.name-hint', 'tile name')
    name.setAttribute('aria-label', say('comfy.name-picture', 'Name'))
    const named = make('form', 'te-dg-rowf')
    const go = make('button', 'te-dg-word', say('comfy.name-picture', 'Name'))
    go.type = 'submit'
    named.append(name, go)
    named.addEventListener('submit', event => {
      event.preventDefault()
      const value = name.value.trim()
      if (!value) return
      intent('comfy:place-asset', { sig, name: value })
      name.value = ''
    })

    const use = make('button', 'te-dg-word', say('comfy.use-recipe', 'use this recipe'))
    use.type = 'button'
    use.title = say('comfy.use-recipe-hint', 'Put what made this picture back into the form')
    let restore: DeskState['asset'] = null
    use.addEventListener('click', () => {
      const record = restore?.record
      if (!record) return
      intent('comfy:restore-generation', {
        positive: record.positive, negative: record.negative, seed: record.seed,
        steps: record.steps, cfg: record.cfg, width: record.width, height: record.height,
        workflow: record.workflow, label: record.label, model: record.model,
      })
    })

    const row = make('div', 'te-dg-rowf')
    row.append(onSelected, choose)
    el.append(row, named, use)
    return {
      el,
      focus: () => name.focus(),
      paint(state: DeskState): void {
        sig = state.asset?.sig ?? ''
        restore = state.asset
        targets = state.payload.targets
        onSelected.hidden = !targets.length
        onSelected.textContent = say('comfy.place-selected', 'on {tiles}', { tiles: targets.join(', ') })
      },
    }
  },
}
