import { describe, expect, it } from 'vitest'

import { imageChoiceWriteTargets } from './image-choice-targets.js'

describe('Image Hive write targets', () => {
  it('writes only the clicked /somewhere/people reference override', () => {
    expect(imageChoiceWriteTargets(['somewhere'], 'people', false)).toEqual([
      { parentSegments: ['somewhere'], cell: 'people', role: 'appearance' },
    ])
  })

  it('does not mint a second write for the root appearance', () => {
    expect(imageChoiceWriteTargets([], 'people', false)).toEqual([
      { parentSegments: [], cell: 'people', role: 'root-default' },
    ])
  })

  it('writes only the root for a Portal default-authoring row', () => {
    expect(imageChoiceWriteTargets(['sets'], 'people', true)).toEqual([
      { parentSegments: [], cell: 'people', role: 'root-default' },
    ])
  })
})
