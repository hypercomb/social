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
// Pure data. Nothing here is written anywhere until a recipe uses one.

import type { RecipeTemplateDocument } from './recipe-template.js'

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
