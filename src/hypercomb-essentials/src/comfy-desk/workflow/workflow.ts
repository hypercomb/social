// comfy-desk/workflow/workflow.ts
//
// WHICH RECIPE, and the models and LoRAs the recipes load. A workflow is content:
// paste what ComfyUI's Save (API Format) wrote and its seams are inferred.

import { make, type CardHandle, type CardPart, type DeskState, type Say } from '../parts.js'

type Weight = DeskState['payload']['weights'][number]

const kindWord = (kind: string, say: Say): string => {
  switch (kind) {
    case 'text': return say('comfy.weight-text', 'text')
    case 'vae': return say('comfy.weight-vae', 'vae')
    case 'lora': return say('comfy.weight-lora', 'lora')
    default: return say('comfy.weight-model', 'model')
  }
}

const seconds = (row: Weight): string => {
  const ms = row.loading ? Math.max(0, Date.now() - (row.since ?? Date.now())) : (row.ms ?? 0)
  const value = ms / 1000
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`
}

const timeWord = (row: Weight, say: Say): string => {
  if (row.loading) return `${say('comfy.weight-loading', 'loading')} ${seconds(row)}`
  if (row.cached) return say('comfy.weight-cached', 'cached')
  if (row.ms != null) return seconds(row)
  return row.active ? say('comfy.weight-next', 'next picture') : ''
}

export const workflowPart: CardPart = {
  value: state => state.payload.activeLabel ?? '',
  create(context): CardHandle {
    const { say, intent } = context
    const el = make('div', 'te-dg-fld')

    const pick = make('select', 'te-dg-input')
    pick.setAttribute('aria-label', say('comfy.workflow', 'Workflow'))
    pick.addEventListener('change', () => intent('comfy:set-workflow', { id: pick.value }))
    const add = make('button', 'te-dg-word', say('comfy.add', 'add'))
    add.type = 'button'
    add.title = say('comfy.add-title', "Paste a workflow saved in ComfyUI's API format")
    const row = make('div', 'te-dg-rowf')
    row.append(pick, add)

    const paste = make('textarea', 'cd-words')
    paste.rows = 5
    paste.spellcheck = false
    paste.placeholder = say('comfy.paste-placeholder', 'Paste the JSON from ComfyUI → Save (API Format)')
    const adopt = make('button', 'te-dg-word', say('comfy.paste-add', 'Add workflow'))
    adopt.type = 'button'
    adopt.addEventListener('click', () => {
      const json = paste.value.trim()
      if (json) intent('comfy:import-workflow', { json })
    })
    const refused = make('p', 'te-dg-status')
    refused.dataset['tone'] = 'alert'
    const fold = make('div', 'te-dg-fld')
    fold.hidden = true
    fold.append(paste, adopt, refused)
    add.addEventListener('click', () => { fold.hidden = !fold.hidden; context.changed() })

    const models = make('div', 'te-dg-sub')
    const weights = make('ul', 'cd-weights')
    el.append(row, fold, models, weights)

    let shown = ''
    return {
      el,
      paint(state: DeskState): void {
        const { workflows, active, weights: rows, importError } = state.payload
        const key = workflows.map(one => `${one.id}\n${one.label}`).join('\n')
        if (key !== shown) {
          shown = key
          pick.replaceChildren(...workflows.map(one => {
            const option = make('option', '', one.label)
            option.value = one.id
            return option
          }))
        }
        pick.value = active
        refused.textContent = importError
        refused.hidden = !importError
        if (importError) fold.hidden = false
        else if (paste.value && !fold.hidden && workflows.some(one => one.id === active && one.label === 'pasted workflow')) {
          paste.value = ''
          fold.hidden = true
        }
        models.textContent = rows.length ? say('comfy.models', 'Models') : ''
        weights.replaceChildren(...rows.map(item => {
          const line = make('li', 'cd-weight')
          if (item.active) line.dataset['on'] = ''
          if (item.loading) line.dataset['loading'] = ''
          line.append(
            make('span', 'cd-weight-name', item.label),
            make('span', 'cd-weight-kind', kindWord(item.kind, say)),
            make('span', 'cd-weight-time', timeWord(item, say)),
          )
          return line
        }))
      },
    }
  },
}
