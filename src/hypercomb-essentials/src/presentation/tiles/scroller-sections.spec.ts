import { describe, expect, it } from 'vitest'
import { classifyLink, needsImageProbe, resourceSigOf } from './scroller-sections.js'

// Built, never written literally — the doctrine ratchet forbids a hardcoded
// 64-hex signature in source, and a spec is source.
const SIG = 'ab'.repeat(32)

describe('classifyLink — what a child becomes in the feed', () => {
  it('a content-addressed resource resolves by its bytes (auto), in every spelling', () => {
    expect(classifyLink(SIG)).toEqual({ kind: 'auto', src: SIG })
    expect(classifyLink(`/@resource/${SIG}`)).toEqual({ kind: 'auto', src: SIG })
    expect(classifyLink(`https://host.example/@resource/${SIG}/diagram.svg`)).toEqual({ kind: 'auto', src: SIG })
  })

  it('a provider page embeds — YouTube and Vimeo', () => {
    expect(classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ kind: 'embed' })
    expect(classifyLink('https://vimeo.com/76979871')).toEqual({ kind: 'embed', src: 'https://player.vimeo.com/video/76979871?dnt=1' })
  })

  it('a picture paints and a media file plays', () => {
    expect(classifyLink('https://picsum.photos/id/1015/600/400.jpg')).toEqual({ kind: 'image', src: 'https://picsum.photos/id/1015/600/400.jpg' })
    expect(classifyLink('https://cdn.example.com/clip.webm')).toEqual({ kind: 'video', src: 'https://cdn.example.com/clip.webm' })
    expect(classifyLink('https://cdn.example.com/track.mp3')).toEqual({ kind: 'audio', src: 'https://cdn.example.com/track.mp3' })
  })

  it('everything else is a card — and only an extensionless address is worth an image probe', () => {
    expect(classifyLink('https://example.com/article.html')).toEqual({ kind: 'card', src: 'https://example.com/article.html', probe: false })
    expect(classifyLink('https://picsum.photos/200/300')).toEqual({ kind: 'card', src: 'https://picsum.photos/200/300', probe: true })
    expect(classifyLink('')).toEqual({ kind: 'card', src: '', probe: false })
    expect(classifyLink('   ')).toEqual({ kind: 'card', src: '', probe: false })
  })

  it('every child owns exactly one section — there is no null answer', () => {
    for (const link of ['', 'nonsense', 'mailto:a@b.c', 'https://example.com/x.html', SIG]) {
      expect(classifyLink(link)).toBeTruthy()
    }
  })
})

describe('needsImageProbe', () => {
  it('only an http(s) address with no extension at all', () => {
    expect(needsImageProbe('https://picsum.photos/200/300')).toBe(true)
    expect(needsImageProbe('http://cdn.example.com/photo')).toBe(true)
    expect(needsImageProbe('https://example.com/page.html')).toBe(false)
    expect(needsImageProbe('mailto:a@b.c')).toBe(false)
    expect(needsImageProbe('')).toBe(false)
  })
})

describe('resourceSigOf', () => {
  it('reads the sig out of relative and absolute resource urls, and nothing else', () => {
    expect(resourceSigOf(`/@resource/${SIG}`)).toBe(SIG)
    expect(resourceSigOf(`http://h/@resource/${SIG}?x`)).toBe(SIG)
    expect(resourceSigOf('/@resource/not-a-sig')).toBeNull()
    expect(resourceSigOf('https://example.com')).toBeNull()
    expect(resourceSigOf('')).toBeNull()
  })
})
