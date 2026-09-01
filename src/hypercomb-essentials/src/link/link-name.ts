// link/link-name.ts
// A name for a dropped link, derived from the URL alone — no network.

/**
 * Path segments that name a ROUTE rather than a thing. A tile called "watch"
 * or "status" says nothing about what was dropped.
 */
const ROUTER_SEGMENTS = new Set([
  'watch', 'embed', 'shorts', 'live', 'video', 'videos', 'v', 'e',
  'status', 'post', 'posts', 'p', 'playlist', 'index', 'home', 'view',
])

/** Query parameters that carry the identity of the thing being linked. */
const ID_PARAMS = ['v', 'id', 'video_id', 'videoId']

/** `www.youtube.com` → `youtube`, `x.com` → `x`, `localhost` → `localhost`. */
const hostLabel = (hostname: string): string => {
  const labels = hostname.replace(/^www\./i, '').split('.')
  if (labels.length <= 1) return labels[0] ?? ''
  // Second-to-last label, so `music.youtube.com` and `youtube.com` agree.
  return labels[labels.length - 2] ?? ''
}

/** `my-great-post.html` → `my great post`. */
const deslug = (segment: string): string => {
  let text = segment
  try { text = decodeURIComponent(segment) } catch { /* keep it raw */ }
  return text
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Does this read as a word rather than an opaque identifier? */
const isWordy = (text: string): boolean =>
  /[a-z]/i.test(text) && text.includes(' ')

/**
 * A default tile name for a dropped link, from the URL and nothing else.
 *
 * The open-graph card is the name a link WANTS — but it takes a network read
 * that can be slow, blocked by tracking protection, or simply absent for a
 * platform that publishes no card. Leaving the line empty in those cases left
 * the participant with an armed chevron, no text, and an Enter that did
 * nothing: the drop had happened and there was no way to complete it. So the
 * URL always yields something nameable, and the card upgrades it when it
 * arrives.
 *
 * Returns '' only for input that is not a URL at all.
 */
export function defaultNameForLink(link: string): string {
  let url: URL
  try { url = new URL(link) } catch { return '' }

  const host = hostLabel(url.hostname)
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1] ?? ''

  // A wordy slug is the best name a URL can offer — it is what the publisher
  // called the thing: `/blog/making-of-the-hive` → "making of the hive".
  if (last && !ROUTER_SEGMENTS.has(last.toLowerCase())) {
    const name = deslug(last)
    if (isWordy(name)) return name
    // An opaque id still identifies it, but only alongside where it lives.
    if (name) return host ? `${host} ${name}` : name
  }

  for (const param of ID_PARAMS) {
    const id = url.searchParams.get(param)?.trim()
    if (id) return host ? `${host} ${id}` : id
  }

  // Nothing but a destination — better than an empty line.
  const wordySegment = segments.map(deslug).reverse().find(isWordy)
  return wordySegment ? wordySegment : host
}
