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
 * Build a YouTube thumbnail URL for a given video ID.
 */
export function youTubeThumbnailUrl(
  videoId: string,
  quality: 'default' | 'hqdefault' | 'maxresdefault' = 'hqdefault',
): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`
}
