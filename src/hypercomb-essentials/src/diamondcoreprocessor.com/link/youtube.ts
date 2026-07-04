// diamondcoreprocessor.com/link/youtube.ts
// Pure YouTube URL parsing utilities — no class, no IoC.

/**
 * Extract a YouTube video ID from common URL formats.
 * Handles: youtu.be/{id}, youtube.com/watch?v={id}, /embed/{id}, /shorts/{id}
 * Returns null if the URL is not a recognised YouTube link or the ID is invalid.
 */
export function parseYouTubeVideoId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  let videoId: string | null = null

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null
  }

  if (!videoId && host.includes('youtube.com')) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v')
    } else if (url.pathname.startsWith('/embed/')) {
      videoId = url.pathname.split('/')[2] || null
    } else if (url.pathname.startsWith('/shorts/')) {
      videoId = url.pathname.split('/')[2] || null
    }
  }

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null
  }

  return videoId
}

/**
 * Fetch a YouTube video's title via the public oEmbed endpoint (CORS-enabled),
 * so a dropped link can pre-fill a default tile name the user can override.
 * Returns null on any failure — the caller falls back to manual naming.
 */
export async function fetchYouTubeTitle(link: string): Promise<string | null> {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`
    const resp = await fetch(endpoint)
    if (!resp.ok) return null
    const data = await resp.json() as { title?: unknown }
    return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null
  } catch {
    return null
  }
}

/**
 * Build a YouTube thumbnail URL for a given video ID.
 */
export function youTubeThumbnailUrl(
  videoId: string,
  quality: 'default' | 'hqdefault' | 'maxresdefault' = 'hqdefault',
): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`
}
