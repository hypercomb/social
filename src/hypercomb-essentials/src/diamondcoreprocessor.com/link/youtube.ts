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

export type YouTubeMetadataCandidate =
  | { id: string; kind: 'title'; label: string; value: string }
  | { id: string; kind: 'keyword'; label: string; value: string }
  | { id: string; kind: 'image'; label: string; value: string; previewUrl: string }

export type YouTubeMetadataDiscovery = {
  title: string
  author: string
  authorUrl: string
  candidates: YouTubeMetadataCandidate[]
}

type YouTubeOEmbed = {
  title?: unknown
  author_name?: unknown
  author_url?: unknown
  thumbnail_url?: unknown
}

const META_STOP_WORDS = new Set([
  'and', 'are', 'but', 'for', 'from', 'into', 'official', 'the', 'this',
  'video', 'with', 'you', 'your',
])

const metadataKeywords = (title: string, author: string): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string): void => {
    const clean = value.replace(/\s+/g, ' ').trim()
    const key = clean.toLowerCase()
    if (!clean || clean.length < 3 || seen.has(key)) return
    seen.add(key)
    out.push(clean)
  }
  add(author)
  for (const phrase of title.split(/[|:–—•]+/)) {
    const clean = phrase.replace(/\([^)]*(official|video|audio)[^)]*\)/gi, '').trim()
    if (clean.split(/\s+/).length > 1 && clean.length <= 48) add(clean)
  }
  for (const word of title.match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []) {
    if (!META_STOP_WORDS.has(word.toLowerCase())) add(word)
  }
  return out.slice(0, 8)
}

/** Public, keyless discovery. It queues remote references; bytes are stored only on adoption. */
export async function discoverYouTubeMetadata(
  link: string,
  fetcher: typeof fetch = fetch,
): Promise<YouTubeMetadataDiscovery> {
  const videoId = parseYouTubeVideoId(link)
  if (!videoId) throw new Error('Not a recognised YouTube video URL')

  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(link)}&format=json`
  const response = await fetcher(endpoint)
  if (!response.ok) throw new Error(`YouTube metadata request failed (${response.status})`)
  const raw = await response.json() as YouTubeOEmbed
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const author = typeof raw.author_name === 'string' ? raw.author_name.trim() : ''
  const authorUrl = typeof raw.author_url === 'string' ? raw.author_url.trim() : ''
  const thumbnail = typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url.trim() : ''

  const candidates: YouTubeMetadataCandidate[] = []
  if (title) candidates.push({ id: 'title', kind: 'title', label: 'Video title', value: title })
  for (const keyword of metadataKeywords(title, author)) {
    candidates.push({
      id: `keyword:${keyword.toLowerCase()}`,
      kind: 'keyword',
      label: keyword === author ? 'Artist / channel' : 'Keyword',
      value: keyword,
    })
  }

  const imageUrls = [
    thumbnail,
    youTubeThumbnailUrl(videoId, 'hqdefault'),
    youTubeThumbnailUrl(videoId, 'maxresdefault'),
  ].filter(Boolean)
  const seenImages = new Set<string>()
  for (const [index, imageUrl] of imageUrls.entries()) {
    if (seenImages.has(imageUrl)) continue
    seenImages.add(imageUrl)
    candidates.push({
      id: `image:${index}`,
      kind: 'image',
      label: index === 0 ? 'YouTube thumbnail' : index === 1 ? 'High quality thumbnail' : 'Maximum resolution thumbnail',
      value: imageUrl,
      previewUrl: imageUrl,
    })
  }

  return { title, author, authorUrl, candidates }
}
