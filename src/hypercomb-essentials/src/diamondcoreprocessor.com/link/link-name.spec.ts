import { describe, expect, it } from 'vitest'
import { defaultNameForLink } from './link-name.js'

describe('defaultNameForLink', () => {
  it('names a video by where it lives and which one it is', () => {
    expect(defaultNameForLink('https://www.youtube.com/watch?v=aircAruvnKk'))
      .toBe('youtube aircAruvnKk')
    // A share host has no second label to name it by; the id still lands.
    expect(defaultNameForLink('https://youtu.be/aircAruvnKk')).toBe('youtu aircAruvnKk')
    expect(defaultNameForLink('https://music.youtube.com/watch?v=aircAruvnKk'))
      .toBe('youtube aircAruvnKk')
  })

  it('prefers the publisher\'s own slug when the URL carries one', () => {
    expect(defaultNameForLink('https://example.com/blog/making-of-the-hive'))
      .toBe('making of the hive')
    expect(defaultNameForLink('https://example.com/posts/a_second_look.html'))
      .toBe('a second look')
  })

  it('never returns a route as the name', () => {
    expect(defaultNameForLink('https://x.com/someone/status/1889')).toBe('x 1889')
    expect(defaultNameForLink('https://vimeo.com/watch')).toBe('vimeo')
  })

  it('falls back to the destination when the path says nothing', () => {
    expect(defaultNameForLink('https://openai.com/')).toBe('openai')
    expect(defaultNameForLink('https://sora.com')).toBe('sora')
  })

  it('reports nothing for input that is not a URL', () => {
    expect(defaultNameForLink('not a url')).toBe('')
  })
})
