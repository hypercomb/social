// comfy-desk/recipe/recipe.ts
//
// WHICH PARTS OF THE DRAWING STAND. The tile editor labels a tile's parts; this
// labels a picture's making. Each row names where its leader lands on the
// picture and what lights there. A row is a seam of the workflow or a door of
// the desk, and a workflow that offers no negative prompt shows no such row.

import type { Asset, RecipePart, RecipeRow } from '../parts.js'

const PROMPT: RecipeRow = {
  id: 'prompt', labelKey: 'comfy.prompt-tab', label: 'prompt', side: 'left',
  anchor: { x: 0.2, y: 0.3 }, region: { x: 0.08, y: 0.08, w: 0.84, h: 0.5 },
}
const NEGATIVE: RecipeRow = {
  id: 'negative', labelKey: 'comfy.negative-tab', label: 'and not', side: 'left',
  anchor: { x: 0.2, y: 0.74 }, region: { x: 0.08, y: 0.62, w: 0.84, h: 0.3 },
}
const WORKFLOW: RecipeRow = {
  id: 'workflow', labelKey: 'comfy.workflow-tab', label: 'workflow', side: 'right',
  anchor: { x: 1, y: 0.12 },
}
const KNOBS: RecipeRow = {
  id: 'knobs', labelKey: 'comfy.knobs-tab', label: 'size and steps', side: 'right',
  anchor: { x: 1, y: 0.5 }, edge: true,
}
const PLACE: RecipeRow = {
  id: 'place', labelKey: 'comfy.place-tab', label: 'put on a tile', side: 'right',
  anchor: { x: 1, y: 0.88 },
}
const LIBRARY: RecipeRow = { id: 'library', labelKey: 'comfy.library', label: 'Library', side: 'left' }
const MACHINE: RecipeRow = { id: 'machine', labelKey: 'comfy.machine-tab', label: 'machine', side: 'right' }

const KNOB_SEAMS = ['width', 'height', 'steps', 'cfg', 'batch', 'seed']

export const recipeRows = (knobs: readonly string[], asset: Asset | null): readonly RecipeRow[] => [
  ...(knobs.includes('positive') ? [PROMPT] : []),
  ...(knobs.includes('negative') ? [NEGATIVE] : []),
  LIBRARY,
  WORKFLOW,
  ...(knobs.some(knob => KNOB_SEAMS.includes(knob)) ? [KNOBS] : []),
  ...(asset ? [PLACE] : []),
  MACHINE,
]

export const recipePart: RecipePart = { rows: recipeRows }
