// link/media.ts
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
 *  Null when the URL is unparseable or the last segment has no dot — which
 *  is what makes an EXTENSIONLESS link (a CDN image, `picsum.photos/200/300`)
 *  recognisable as something only a probe can classify. */
export function linkExtension(link: string): string | null {
  let url: URL
  try { url = new URL(link) } catch { return null }
  const last = url.pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot < 0) return null
  return last.slice(dot + 1).toLowerCase()
}

const extensionOf = linkExtension

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
 * A Vimeo video reference: the numeric id, plus the unlisted-video hash when
 * the link carries one (`vimeo.com/<id>/<hash>` — without `h=` the player
 * refuses an unlisted video). Accepts the page (`vimeo.com/<id>`, with or
 * without a channel/group/showcase prefix) and the player
 * (`player.vimeo.com/video/<id>`) forms. Null for anything else.
 */
export function parseVimeoVideoId(link: string): { id: string; hash: string | null } | null {
  let url: URL
  try { url = new URL(link) } catch { return null }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const at = parts.findIndex(p => /^\d{5,}$/.test(p))
  if (at < 0) return null
  const id = parts[at]
  // The page form puts the unlisted hash as the segment AFTER the id; the
  // player form carries it as `?h=`.
  const after = parts[at + 1] ?? ''
  const hash = url.searchParams.get('h') ?? (/^[0-9a-f]{6,}$/i.test(after) ? after : null)
  return { id, hash }
}

/**
 * The EMBED url for a recognised provider link — a page that plays itself in
 * an iframe rather than something a media element can source.
 *
 * YouTube via the **nocookie** host, Vimeo with **dnt** (do not track): showing
 * a slide should not hand the viewer's session to a tracking domain. Extend
 * by adding providers here; the player needs no change (it just frames
 * whatever url comes back).
 *
 * Null when the link is not a recognised embeddable provider.
 */
export function embedUrlFor(link: string): string | null {
  const youTubeId = parseYouTubeVideoId(link)
  // `origin` is required for the player to configure itself; without it the
  // embed can answer "error 153 — video player configuration error" instead of
  // a video. Same term, same reason as youtube-viewer.component.ts.
  if (youTubeId) {
    // Guarded: this module is pure and gets imported outside a document too,
    // where there is no location to name as the embedding origin.
    const origin = globalThis.location?.origin
    const base = `https://www.youtube-nocookie.com/embed/${youTubeId}`
    return origin ? `${base}?origin=${encodeURIComponent(origin)}` : base
  }
  const vimeo = parseVimeoVideoId(link)
  if (vimeo) {
    const params = new URLSearchParams({ dnt: '1' })
    if (vimeo.hash) params.set('h', vimeo.hash)
    return `https://player.vimeo.com/video/${vimeo.id}?${params.toString()}`
  }
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
