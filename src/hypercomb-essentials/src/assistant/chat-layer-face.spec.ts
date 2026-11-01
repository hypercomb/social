import { describe, expect, it } from 'vitest'
import { faceOf } from './chat-layer-face.js'

describe('layer face', () => {
  it('names the views it was given and the behaviors that cover this layer', () => {
    const face = faceOf(
      ['website', 'website', 'journal'],
      {
        postit: [{ path: '/revolucion/meetup' }],
        gallery: [{ path: '/revolucion' }],
        elsewhere: [{ path: '/other' }],
      },
      ['revolucion', 'meetup'],
    )
    expect(face.views).toEqual(['journal', 'website'])
    expect(face.behaviors).toEqual(['gallery', 'postit'])
  })

  it('leaves a layer with nothing bound unnamed', () => {
    expect(faceOf([], { postit: [{ path: '/revolucion' }] }, ['notes'])).toEqual({ views: [], behaviors: [] })
  })
})
