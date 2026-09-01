import { describe, expect, it, vi } from 'vitest'
import { discoverYouTubeMetadata, fetchYouTubeOpenGraph, parseYouTubeVideoId } from './youtube.js'

describe('YouTube open-graph card', () => {
  it('reads the title that names the tile and the image that pictures it', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      title: 'Miles Davis — So What',
      thumbnail_url: 'https://img.youtube.com/custom.jpg',
    }), { status: 200 })) as typeof fetch

    expect(await fetchYouTubeOpenGraph('https://youtu.be/dQw4w9WgXcQ', fetcher)).toEqual({
      title: 'Miles Davis — So What',
      thumbnailUrl: 'https://img.youtube.com/custom.jpg',
    })
  })

  it('still offers the deterministic poster frame when the card cannot be read', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch

    expect(await fetchYouTubeOpenGraph('https://youtu.be/dQw4w9WgXcQ', fetcher)).toEqual({
      title: null,
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    })
  })

  it('reports no card at all for a link that is not a video', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch

    expect(await fetchYouTubeOpenGraph('https://example.com', fetcher)).toEqual({
      title: null,
      thumbnailUrl: null,
    })
  })
})

describe('YouTube metadata discovery', () => {
  it('builds individually adoptable title, keyword, artist and image candidates', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      title: 'Miles Davis — So What (Official Video)',
      author_name: 'Miles Davis',
      author_url: 'https://www.youtube.com/@milesdavis',
      thumbnail_url: 'https://img.youtube.com/custom.jpg',
    }), { status: 200 })) as typeof fetch

    const result = await discoverYouTubeMetadata(
      'https://youtu.be/dQw4w9WgXcQ',
      fetcher,
    )

    expect(result.title).toBe('Miles Davis — So What (Official Video)')
    expect(result.candidates).toContainEqual({
      id: 'title',
      kind: 'title',
      label: 'Video title',
      value: 'Miles Davis — So What (Official Video)',
    })
    expect(result.candidates.some(candidate =>
      candidate.kind === 'keyword' && candidate.value === 'Miles Davis')).toBe(true)
    expect(result.candidates.filter(candidate => candidate.kind === 'image').length).toBe(3)
  })

  it('rejects non-video URLs before requesting metadata', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    await expect(discoverYouTubeMetadata('https://example.com', fetcher)).rejects.toThrow(
      'Not a recognised YouTube video URL',
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps the existing common YouTube URL shapes recognisable', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })
})
