import { describe, expect, it } from 'vitest'

import { imageChoiceWriteTargets } from './image-choice-targets.js'

describe('Image Hive write targets', () => {
  it('writes only the clicked /somewhere/people reference override', () => {
    expect(imageChoiceWriteTargets(['somewhere'], 'people', null)).toEqual([
      { parentSegments: ['somewhere'], cell: 'people', role: 'appearance' },
    ])
  })

  it('does not mint a second write for the root appearance', () => {
    expect(imageChoiceWriteTargets([], 'people', null)).toEqual([
      { parentSegments: [], cell: 'people', role: 'root-default' },
    ])
  })

  it('writes the TARGET for a Portal default-authoring row — where it lives, never a root copy', () => {
    expect(imageChoiceWriteTargets(['sets'], 'people', ['nest', 'people'])).toEqual([
      { parentSegments: ['nest'], cell: 'people', role: 'root-default' },
    ])
  })

  it('an empty legacy route falls back to the appearance instead of the hive root', () => {
    expect(imageChoiceWriteTargets(['sets'], 'people', [])).toEqual([
      { parentSegments: ['sets'], cell: 'people', role: 'appearance' },
    ])
  })
})
