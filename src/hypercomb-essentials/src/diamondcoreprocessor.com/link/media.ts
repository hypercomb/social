// diamondcoreprocessor.com/link/media.ts
// Pure PLAYABLE-media classification — no class, no IoC. Mirrors photo.ts /
// youtube.ts: small helpers that answer "HOW should this be presented?" once
// photo.ts has ruled out a still image. Consumed by the slides player so one
// view can show a diagram, play a video, play a track, or embed a provider.

import { parseYouTubeVideoId } from './youtube.js'

/** Timed media a native element can source directly. */
export type MediaKind = 'video' | 'audio'

/** What a slide ultimately renders as. `embed` is a provider page in an
 *  iframe (it plays itself); the rest are painted/played locally. */
export type PlayableKind = 'image' | MediaKind | 'embed'

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'm4v', 'mov'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'])

/** Lowercase extension of a URL's pathname, ignoring query + fragment.
 *  Null when the URL is unparseable or the last segment has no dot. */
function extensionOf(link: string): string | null {
  let url: URL
  try { url = new URL(link) } catch { return null }
  const last = url.pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot < 0) return null
  return last.slice(dot + 1).toLowerCase()
}

/**
 * Timed media a native `<video>`/`<audio>` can play, decided by file
 * extension. Null for images, provider pages, and everything else — the
 * caller falls through to its next classifier.
 */
export function mediaKindForUrl(link: string): MediaKind | null {
  const ext = extensionOf(link)
  if (!ext) return null
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  return null
}

/**
 * The EMBED url for a recognised provider link — a page that plays itself in
 * an iframe rather than something a media element can source.
 *
 * YouTube today, via the **nocookie** host: showing a slide should not hand
 * the viewer's session to the tracking domain. Extend by adding providers
 * here; the player needs no change (it just frames whatever url comes back).
 *
 * Null when the link is not a recognised embeddable provider.
 */
export function embedUrlFor(link: string): string | null {
  const youTubeId = parseYouTubeVideoId(link)
  if (youTubeId) return `https://www.youtube-nocookie.com/embed/${youTubeId}`
  return null
}

/**
 * Kind for content-addressed bytes (a resource signature). A signature carries
 * no extension and the host serves it as octet-stream, so the BLOB'S OWN MIME
 * is the only reliable signal — which is exactly what `Store.getResource`
 * hands back. Falls back to `image`: the historical slide kind and the safest
 * render (a background image that isn't one simply fails to paint, rather than
 * mounting a broken player).
 */
export function kindForMime(mime: string): 'image' | MediaKind {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'image'
}
