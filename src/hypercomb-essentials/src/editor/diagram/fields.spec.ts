import { describe, expect, it } from 'vitest'
import { FIELDS, activationOf, groupParts, kindOfPart } from './fields.js'
import type { FieldKey, ModelPart } from '../models/tile-model.js'

const part = (id: string, fields: FieldKey[]): ModelPart => ({
  id, labelKey: `k.${id}`, label: id, fields, side: 'left', z: 1,
  anchor: () => ({ x: 0, y: 0 }), hit: () => false, lit: () => [],
})

describe('FIELDS', () => {
  it('has exactly four group fields', () => {
    const group = (Object.keys(FIELDS) as FieldKey[]).filter(k => FIELDS[k].group).sort()
    expect(group).toEqual(['background.color', 'border.color', 'hideText', 'link'])
  })

  it('maps every key to a kind', () => {
    expect(FIELDS['border.color'].kind).toBe('colour')
    expect(FIELDS['background.color'].kind).toBe('colour')
    expect(FIELDS.hideText.kind).toBe('toggle')
    expect(FIELDS.title.kind).toBe('text')
    expect(FIELDS.link.kind).toBe('link')
    expect(FIELDS.picture.kind).toBe('image')
    expect(FIELDS.orientation.kind).toBe('variant')
  })

  it('the border names its fallback and clear word; the fill names its dormant note', () => {
    expect(FIELDS['border.color'].fallback).toBe('#c8975a')
    expect(FIELDS['border.color'].clearKey).toBe('editor.default')
    expect(FIELDS['background.color'].clearKey).toBe('editor.none')
    expect(FIELDS['background.color'].dormantKey).toBe('editor.fill-dormant')
  })
})

describe('kind -> activation', () => {
  it('derives every click from the kind of the primary field', () => {
    expect(activationOf('colour')).toBe('open-colour')
    expect(activationOf('text')).toBe('focus-text')
    expect(activationOf('image')).toBe('pin-stage')
    expect(activationOf('variant')).toBe('cycle-variant')
    expect(activationOf('link')).toBe('open-card')
    expect(activationOf('toggle')).toBe('open-card')
  })

  it('kindOfPart reads the FIRST field only', () => {
    expect(kindOfPart(part('a', ['title', 'hideText']))).toBe('text')
    expect(kindOfPart(part('b', ['hideText', 'title']))).toBe('toggle')
    expect(() => kindOfPart(part('c', []))).toThrow()
  })
})

describe('groupParts', () => {
  it('keeps parts with a group field, reduced to those fields', () => {
    const parts = [
      part('a', ['title', 'hideText']),
      part('b', ['border.color']),
      part('c', ['picture']),
      part('d', ['orientation']),
      part('e', ['link']),
    ]
    const g = groupParts(parts)
    expect(g.map(p => p.id)).toEqual(['a', 'b', 'e'])
    expect(g[0].fields).toEqual(['hideText'])
    // the model's own descriptor is untouched
    expect(parts[0].fields).toEqual(['title', 'hideText'])
  })

  it('a model cannot widen group mode: only the table decides', () => {
    const wide = [part('x', ['title', 'picture', 'orientation'])]
    expect(groupParts(wide)).toEqual([])
    const mixed = groupParts([part('y', ['picture', 'link', 'orientation', 'background.color'])])
    expect(mixed[0].fields).toEqual(['link', 'background.color'])
  })
})
