import { describe, expect, it } from 'vitest'
import { embedUrlFor, linkExtension, mediaKindForUrl, parseVimeoVideoId } from './media.js'

describe('embedUrlFor — provider pages that play themselves', () => {
  it('frames a YouTube link through the nocookie host', () => {
    expect(embedUrlFor('https://youtu.be/dQw4w9WgXcQ')).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ(\?origin=.+)?$/,
    )
  })

  it('frames a Vimeo page link through the player, do-not-track', () => {
    expect(embedUrlFor('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871?dnt=1')
    expect(embedUrlFor('https://www.vimeo.com/76979871?autoplay=1')).toBe('https://player.vimeo.com/video/76979871?dnt=1')
  })

  it('walks past a channel, group or showcase prefix to the id', () => {
    expect(embedUrlFor('https://vimeo.com/channels/staffpicks/76979871')).toBe('https://player.vimeo.com/video/76979871?dnt=1')
    expect(embedUrlFor('https://vimeo.com/groups/motion/videos/76979871')).toBe('https://player.vimeo.com/video/76979871?dnt=1')
  })

  it('keeps the unlisted hash — the player refuses an unlisted video without it', () => {
    expect(embedUrlFor('https://vimeo.com/76979871/abc123def4')).toBe('https://player.vimeo.com/video/76979871?dnt=1&h=abc123def4')
    expect(embedUrlFor('https://player.vimeo.com/video/76979871?h=abc123def4')).toBe('https://player.vimeo.com/video/76979871?dnt=1&h=abc123def4')
  })

  it('is not fooled by a vimeo-looking host, a page with no id, or a bare id elsewhere', () => {
    expect(embedUrlFor('https://vimeo.com/about')).toBeNull()
    expect(embedUrlFor('https://notvimeo.com/76979871')).toBeNull()
    expect(embedUrlFor('https://example.com/watch?v=76979871')).toBeNull()
    expect(embedUrlFor('not a url')).toBeNull()
  })
})

describe('parseVimeoVideoId', () => {
  it('reads the id and the optional hash', () => {
    expect(parseVimeoVideoId('https://vimeo.com/76979871')).toEqual({ id: '76979871', hash: null })
    expect(parseVimeoVideoId('https://vimeo.com/76979871/abc123def4')).toEqual({ id: '76979871', hash: 'abc123def4' })
  })
})

describe('linkExtension — what an extensionless address looks like', () => {
  it('reads the extension off the path, never the query', () => {
    expect(linkExtension('https://picsum.photos/id/1015/600/400.jpg?x=1#y')).toBe('jpg')
    expect(linkExtension('https://cdn.example.com/clip.MP4')).toBe('mp4')
  })

  it('is null for an address with no dot in its last segment', () => {
    expect(linkExtension('https://picsum.photos/200/300')).toBeNull()
    expect(linkExtension('https://example.com/')).toBeNull()
    expect(linkExtension('nope')).toBeNull()
  })

  it('agrees with the media classifier', () => {
    expect(mediaKindForUrl('https://cdn.example.com/clip.MP4')).toBe('video')
    expect(mediaKindForUrl('https://picsum.photos/200/300')).toBeNull()
  })
})
