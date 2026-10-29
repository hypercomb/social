// Replacing a selection is ONE announcement. A listener that reacts to a
// selection (the tile editor opens a group on it) must not be walked through
// every half-built set a clear-then-add loop passes through.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { SelectionService } from './selection.service.js'

describe('SelectionService.replace', () => {
  let selection: SelectionService
  let heard: Array<{ selected: string[]; active: string | null }>
  let off: (() => void) | undefined

  afterEach(() => { off?.() })

  beforeEach(() => {
    ;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined }
    selection = new SelectionService()
    heard = []
    off = EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', payload => {
      if (payload) heard.push(payload)
    })
  })

  it('makes the labels the whole selection and announces once', () => {
    selection.add('old')
    heard.length = 0

    selection.replace(['a', 'b', 'c'])

    expect([...selection.selected]).toEqual(['a', 'b', 'c'])
    expect(selection.active).toBe('a')
    expect(heard).toHaveLength(1)
    expect(heard[0].selected).toEqual(['a', 'b', 'c'])
  })

  it('keeps the active label when it is in the set, else falls back to the first', () => {
    selection.replace(['a', 'b', 'c'], 'b')
    expect(selection.active).toBe('b')
    selection.replace(['a', 'c'], 'zzz')
    expect(selection.active).toBe('a')
  })

  it('says nothing when the selection is already exactly this', () => {
    selection.replace(['a', 'b'], 'a')
    heard.length = 0
    selection.replace(['b', 'a'], 'a')
    expect(heard).toHaveLength(0)
  })

  it('an empty list empties the selection', () => {
    selection.replace(['a'])
    heard.length = 0
    selection.replace([])
    expect(selection.count).toBe(0)
    expect(selection.active).toBeNull()
    expect(heard).toHaveLength(1)
  })
})
