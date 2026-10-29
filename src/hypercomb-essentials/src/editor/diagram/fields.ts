// editor/diagram/fields.ts
//
// THE SHELL'S TABLE OF FIELDS. A model says which fields a part edits; this
// table — not the model — says what KIND each field is, whether a group may
// edit it, and what an unset value means. Everything the diagram does on a
// click comes from the kind of a part's primary field, so no part id is ever
// compared and a model cannot widen group mode by declaring a field of its own.

import type { EditorField } from '../tile-properties.js'
import type { FieldKey, FieldKind, ModelPart } from '../models/tile-model.js'

export interface FieldSpec {
  readonly kind: FieldKind
  readonly labelKey: string
  /** True for exactly: border.color, background.color, hideText, link. */
  readonly group: boolean
  /** The layer chip this field answers to (the existing five). */
  readonly layer?: EditorField
  /** The word for "go back to unset" ('editor.default' | 'editor.none'). */
  readonly clearKey?: string
  /** What an unset colour MEANS; shown, never written. */
  readonly fallback?: string
  /** The note shown while the field has no visible effect. */
  readonly dormantKey?: string
}

export const FIELDS: Readonly<Record<FieldKey, FieldSpec>> = {
  'border.color': { kind: 'colour', labelKey: 'editor.border', group: true, layer: 'border', clearKey: 'editor.default', fallback: '#c8975a' },
  'background.color': { kind: 'colour', labelKey: 'editor.fill-behind', group: true, layer: 'fill', clearKey: 'editor.none', dormantKey: 'editor.fill-dormant' },
  hideText: { kind: 'toggle', labelKey: 'editor.name', group: true, layer: 'text' },
  // The name is a decoration written at commit by its own chain; a group has
  // no single name to write, so it is never a group field.
  title: { kind: 'text', labelKey: 'editor.name', group: false },
  link: { kind: 'link', labelKey: 'editor.link', group: true, layer: 'link' },
  picture: { kind: 'image', labelKey: 'editor.picture', group: false, layer: 'picture' },
  orientation: { kind: 'variant', labelKey: 'editor.shape', group: false },
}

/** The kind of a part's PRIMARY field: it decides what a click on the drawn part does. */
export const kindOfPart = (p: ModelPart): FieldKind => {
  const first = p.fields[0]
  if (first === undefined) throw new Error(`part ${p.id} edits no field`)
  return FIELDS[first].kind
}

export const isGroupField = (key: FieldKey): boolean => FIELDS[key].group

/**
 * Group mode keeps the parts that own at least one group field, each reduced to
 * those fields. The table above decides, so a model cannot widen the set.
 * The reduced part is a copy; the model's own descriptor is never touched.
 */
export const groupParts = (parts: readonly ModelPart[]): ModelPart[] => {
  const out: ModelPart[] = []
  for (const p of parts) {
    const kept = p.fields.filter(isGroupField)
    if (kept.length) out.push({ ...p, fields: kept })
  }
  return out
}

export type Activation = 'open-colour' | 'focus-text' | 'pin-stage' | 'cycle-variant' | 'open-card'

const ACTIVATION: Readonly<Record<FieldKind, Activation>> = {
  colour: 'open-colour',
  text: 'focus-text',
  image: 'pin-stage',
  variant: 'cycle-variant',
  // a link opens its card and focuses the url; a toggle is only ever a
  // secondary field, but if a model leads with one the card is the safe act
  link: 'open-card',
  toggle: 'open-card',
}

/** What a click (or second touch tap) on the drawn part does, by kind. */
export const activationOf = (kind: FieldKind): Activation => ACTIVATION[kind]
