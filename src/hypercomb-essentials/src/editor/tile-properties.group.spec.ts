// A group of tiles edited together: the editor shows no name and no picture,
// and a save writes to every tile only the fields given a value. A field left
// empty leaves each tile exactly as it was.

import { describe, expect, it } from 'vitest'
import { groupFormFrom, groupWritesFor } from './tile-properties.js'

describe('groupWritesFor — what a group save writes to one tile', () => {
  it('writes nothing from an empty form', () => {
    expect(groupWritesFor({}, { border: { color: '#112233' }, hideText: true, link: 'https://a.example' })).toEqual({})
  })

  it('writes only the fields given a value', () => {
    const updates = groupWritesFor({ border: { color: '#ff0000' } }, { background: { color: '#000000' }, link: 'https://a.example' })
    expect(updates).toEqual({ border: { color: '#ff0000' } })
  })

  it('keeps the rest of the tile\'s own border record', () => {
    expect(groupWritesFor({ border: { color: '#ff0000' } }, { border: { color: '#00ff00', width: 3 } }))
      .toEqual({ border: { color: '#ff0000', width: 3 } })
  })

  it('skips a tile that already has the value', () => {
    expect(groupWritesFor({ border: { color: '#ff0000' }, link: 'https://a.example' }, { border: { color: '#ff0000' }, link: 'https://a.example' }))
      .toEqual({})
  })

  it('hides the name, and shows it by clearing the flag', () => {
    expect(groupWritesFor({ hideText: true }, {})).toEqual({ hideText: true })
    const shown = groupWritesFor({ hideText: false }, { hideText: true })
    expect(Object.keys(shown)).toEqual(['hideText'])
    expect(shown['hideText']).toBeUndefined()
    expect(groupWritesFor({ hideText: false }, {})).toEqual({})
  })

  it('never clears a link from an empty field', () => {
    expect(groupWritesFor({ link: '' }, { link: 'https://a.example' })).toEqual({})
  })
})

describe('groupFormFrom — what a single draft carries into a group', () => {
  it('carries only what had changed', () => {
    const baseline = { border: { color: '#111111' }, background: { color: '#222222' }, link: 'https://a.example' }
    const form = { border: { color: '#ff0000' }, background: { color: '#222222' }, link: 'https://a.example', large: { image: 'x' } }
    expect(groupFormFrom(form, baseline)).toEqual({ border: { color: '#ff0000' } })
  })

  it('carries showing or hiding the name, but never a cleared value', () => {
    expect(groupFormFrom({}, { hideText: true })).toEqual({ hideText: false })
    expect(groupFormFrom({ hideText: true }, {})).toEqual({ hideText: true })
    expect(groupFormFrom({ border: undefined, link: undefined }, { border: { color: '#111111' }, link: 'https://a.example' })).toEqual({})
  })
})
