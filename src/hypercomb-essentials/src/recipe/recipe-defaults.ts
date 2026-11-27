// recipe/recipe-defaults.ts
//
// THE THREE TEMPLATES EVERY HIVE STARTS WITH. Each is an ordinary template
// document: its bytes have a signature like any other, so a recipe written into
// one names it the way it would name a template from a host, and a participant
// who turns one on offers exactly these bytes (A6: the same template on five
// hundred hosts is one row).
//
// They share section keys on purpose (`story`, `facts`, `ingredients`, `steps`,
// `pictures`, `links`), so switching between them, or to a community template
// that uses the same words, carries what was written across. A key is a
// convention the same way a pool's meaning is: spell it the same and it is the
// same column (documentation/pools-as-relational-database.md).
//
// Pure data, and the words it is shown in. Nothing here is written anywhere
// until a recipe uses one.

import { recipeTemplateBytes, type RecipeTemplateDocument } from './recipe-template.js'

/** Story first: where a dish comes from, then how it is made, then how it is eaten. */
export const RECIPE_TEMPLATE_FAMILY: RecipeTemplateDocument = Object.freeze({
  name: 'Family recipe',
  description: 'A dish with a history: who made it first, how it is made, and how it is eaten.',
  sections: Object.freeze([
    { key: 'story', kind: 'text', label: 'The story', prompt: 'Who made this first, and when does it come to the table?' },
    { key: 'pictures', kind: 'pictures', label: 'Pictures', prompt: 'Paste or drop pictures: the dish, the kitchen, the card it was written on.' },
    { key: 'facts', kind: 'facts', label: 'At a glance', fields: ['Serves', 'Time', 'From'] },
    { key: 'ingredients', kind: 'ingredients', label: 'What you need' },
    { key: 'steps', kind: 'steps', label: 'How it is made', prompt: 'One thing at a time, the way you would say it standing at the stove.' },
    { key: 'experience', kind: 'text', label: 'At the table', prompt: 'How is it served, and what does it go with?' },
    { key: 'links', kind: 'links', label: 'Watch and read', prompt: 'A video of the technique, or where the recipe came from.' },
  ] as const),
})

/** The short one: what you need and what you do, nothing else in the way. */
export const RECIPE_TEMPLATE_WEEKNIGHT: RecipeTemplateDocument = Object.freeze({
  name: 'Weeknight',
  description: 'The short one: what you need, what you do, and what you can swap.',
  sections: Object.freeze([
    { key: 'facts', kind: 'facts', label: 'At a glance', fields: ['Serves', 'Time', 'Effort'] },
    { key: 'ingredients', kind: 'ingredients', label: 'Ingredients' },
    { key: 'steps', kind: 'steps', label: 'Method' },
    { key: 'swaps', kind: 'text', label: 'Swaps and shortcuts', prompt: 'What can be left out, replaced or made ahead?' },
    { key: 'pictures', kind: 'pictures', label: 'Pictures' },
  ] as const),
})

/** The experience leads: the scene, the pictures, then the making as part of the evening. */
export const RECIPE_TEMPLATE_TASTING: RecipeTemplateDocument = Object.freeze({
  name: 'Tasting journey',
  description: 'A dish to read along with: set the scene, cook it together, and say what to notice.',
  sections: Object.freeze([
    { key: 'experience', kind: 'text', label: 'Set the scene', prompt: 'Where are we, who is here, and what should it feel like?' },
    { key: 'pictures', kind: 'pictures', label: 'Pictures' },
    { key: 'story', kind: 'text', label: 'Where it comes from' },
    { key: 'facts', kind: 'facts', label: 'At a glance', fields: ['Serves', 'Time', 'Season'] },
    { key: 'ingredients', kind: 'ingredients', label: 'On the counter' },
    { key: 'steps', kind: 'steps', label: 'Cook along', prompt: 'One step a page. Say what to look, smell and listen for.' },
    { key: 'pairing', kind: 'text', label: 'Pair it with', prompt: 'A drink, a side, a record to put on.' },
    { key: 'links', kind: 'links', label: 'Watch and read' },
  ] as const),
})

/** The three, in the order the picker offers them. The first is what a new recipe is written into. */
export const DEFAULT_RECIPE_TEMPLATES: readonly RecipeTemplateDocument[] = Object.freeze([
  RECIPE_TEMPLATE_FAMILY,
  RECIPE_TEMPLATE_WEEKNIGHT,
  RECIPE_TEMPLATE_TASTING,
])

// ── said in the participant's language ──────────────────────────────────────
//
// The built-in bytes never change: a recipe names them by signature, and a
// participant who turns one on offers exactly these bytes. Their words are put
// into the reader's language where they are SHOWN, and only for a template whose
// bytes are a built-in's (the same bytes are the same signature, I1): the key is
// `recipe.default.<template>.<section>.label|prompt`, its fact fields under
// `.fields.<field>`, the template's own under `recipe.default.<template>.name|description`.

/** The name each built-in's words are kept under. */
const DEFAULT_IDS: ReadonlyMap<RecipeTemplateDocument, string> = new Map([
  [RECIPE_TEMPLATE_FAMILY, 'family'],
  [RECIPE_TEMPLATE_WEEKNIGHT, 'weeknight'],
  [RECIPE_TEMPLATE_TASTING, 'tasting'],
])

const bytesText = (template: RecipeTemplateDocument): string => {
  try { return new TextDecoder().decode(recipeTemplateBytes(template)) } catch { return '' }
}

let builtInBytes: ReadonlyMap<string, string> | null = null

/** Which built-in a template is, by its bytes; '' for any other. */
export function recipeDefaultTemplateId(template: RecipeTemplateDocument): string {
  const known = DEFAULT_IDS.get(template)
  if (known) return known
  builtInBytes ??= new Map([...DEFAULT_IDS].map(([doc, id]) => [bytesText(doc), id]))
  return builtInBytes.get(bytesText(template)) ?? ''
}

/** How a caller says a key: the fallback, its {holes} filled, when it knows no better. */
export type RecipeDefaultSay = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** A key's words, or the English when the catalogue echoes the key back, says nothing, or throws. */
const wordsOf = (say: RecipeDefaultSay, key: string, english: string): string => {
  let said = ''
  try { said = say(key, english) } catch { said = '' }
  return said && said !== key && said.trim() ? said : english
}

/** A fact field as the last part of its key: "Serves" is `serves`. */
const fieldKey = (field: string): string => field.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The template as it is SHOWN: a built-in in the reader's language, any other
 * template exactly as its author wrote it (the same object). Never written
 * anywhere: the bytes a recipe names are the built-in's own.
 */
export function recipeDefaultTemplateShown(template: RecipeTemplateDocument, say: RecipeDefaultSay): RecipeTemplateDocument {
  const id = recipeDefaultTemplateId(template)
  if (!id) return template
  const base = `recipe.default.${id}`
  return {
    name: wordsOf(say, `${base}.name`, template.name),
    ...(template.description !== undefined ? { description: wordsOf(say, `${base}.description`, template.description) } : {}),
    sections: template.sections.map(section => ({
      key: section.key,
      kind: section.kind,
      label: wordsOf(say, `${base}.${section.key}.label`, section.label),
      ...(section.prompt !== undefined ? { prompt: wordsOf(say, `${base}.${section.key}.prompt`, section.prompt) } : {}),
      ...(section.fields !== undefined ? { fields: section.fields.map(field => wordsOf(say, `${base}.${section.key}.fields.${fieldKey(field)}`, field)) } : {}),
    })),
  }
}
