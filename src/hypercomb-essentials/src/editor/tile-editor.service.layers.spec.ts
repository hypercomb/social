// tile-editor.service.layers.spec.ts — a layer choice PREVIEWS its result in
// the form, and taking it back restores exactly what was there
// (documentation/alias-properties.md, step 4).

import { describe, expect, it } from 'vitest'
import { TileEditorService } from './tile-editor.service.js'

const opened = (): TileEditorService => {
  const service = new TileEditorService()
  service.open('zed', { border: { color: '#aa0000' }, link: 'https://mine.example' }, null, ['crew', 'zed'])
  service.setLayers(
    { picture: 'inherited', border: 'here', text: 'inherited', fill: 'inherited', link: 'here' },
    { border: { color: '#112233' }, link: 'https://repo.example' },
  )
  return service
}

describe('layer choices preview in the form', () => {
  it('shows the repo value for inherit again, and nothing for hide here', () => {
    const service = opened()
    service.choose('border', 'inherit')
    expect(service.borderColor).toBe('#112233')
    service.choose('link', 'hide')
    expect(service.link).toBe('')
  })

  it('restores the participant value when the choice is taken back', () => {
    const service = opened()
    service.choose('border', 'inherit')
    service.choose('border', null)
    expect(service.borderColor).toBe('#aa0000')
  })

  it('never stacks previews when one choice replaces another', () => {
    const service = opened()
    service.choose('link', 'hide')
    service.choose('link', 'inherit')
    expect(service.link).toBe('https://repo.example')
    service.choose('link', null)
    expect(service.link).toBe('https://mine.example')
  })

  it('makes a pending choice count as a change to save', () => {
    const service = opened()
    expect(service.dirty).toBe(false)
    service.choose('link', 'here')
    expect(service.dirty).toBe(true)
  })
})
