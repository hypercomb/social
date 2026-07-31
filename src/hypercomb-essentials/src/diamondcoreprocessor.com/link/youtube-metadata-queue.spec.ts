import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('YouTubeMetadataQueue', () => {
  beforeEach(() => {
    localStorage.clear()
    const services = new Map<string, unknown>()
    ;(window as any).ioc = {
      get: (key: string) => services.get(key),
      register: (key: string, value: unknown) => services.set(key, value),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      title: 'Queue Test Video',
      author_name: 'Queue Artist',
      author_url: 'https://www.youtube.com/@queue',
      thumbnail_url: 'https://img.youtube.com/test.jpg',
    }), { status: 200 })))
  })

  it('moves an enqueued tile from pending to a durable ready review', async () => {
    const { YouTubeMetadataQueue } = await import('./youtube-metadata-queue.js')
    const queue = new YouTubeMetadataQueue()
    queue.enqueue({
      segments: ['music'],
      cell: 'queue-test',
      url: 'https://youtu.be/dQw4w9WgXcQ',
    })

    await vi.waitFor(() => {
      expect(queue.readyForTile(
        ['music'],
        'queue-test',
        'https://youtu.be/dQw4w9WgXcQ',
      )?.candidates.length).toBeGreaterThan(0)
    })

    expect(localStorage.getItem('hc:youtube-metadata-queue:v1')).toContain('"status":"ready"')
  })
})
