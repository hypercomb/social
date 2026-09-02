// presentation/tiles/scroller-sections.ts
//
// WHAT A CHILD BECOMES IN A FEED — pure, no DOM, no IoC.
//
// The scroller gives EVERY child of a branch one section, so the counter never
// lies: a link a media element can play plays, a provider page embeds, a
// picture paints, and everything else is a CARD (the child's name, its tile
// picture, an `open` button). The one classification that cannot be decided
// from the link alone — an EXTENSIONLESS address that may still be an image
// (`picsum.photos/200/300`, a CDN redirect) — is marked `probe` and left to the
// section's own lazy resolve, where `fetchImageBlob` (link/photo.ts) asks the
// server. Nothing is fetched here.
//
// Split out of slides-view.drone.ts so the classification can be pinned by a
// spec without a browser: the drone reads the link (tile properties, layers),
// this decides what it is.

import { RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { isImageUrl } from '../../link/photo.js'
import { embedUrlFor, linkExtension, mediaKindForUrl, type PlayableKind } from '../../link/media.js'

const SIG = /^[0-9a-f]{64}$/

/** The 64-hex content sig a link value points at, when it is a resource link:
 *  a bare sig, or a `/@resource/<sig>` URL in ANY form — RELATIVE
 *  (`/@resource/<sig>`) or ABSOLUTE (`http://host/@resource/<sig>[/name.ext]`).
 *  Matches link/photo.ts's includes-based resolver; a startsWith check missed
 *  absolute links a tile can legitimately store. Null for non-resource links. */
export function resourceSigOf(link: string): string | null {
  if (!link) return null
  if (SIG.test(link)) return link
  const at = link.indexOf(RESOURCE_URL_PREFIX)
  if (at >= 0) {
    const tail = link.slice(at + RESOURCE_URL_PREFIX.length).split(/[/?#]/)[0] ?? ''
    return SIG.test(tail) ? tail : null
  }
  return null
}

/** How a link renders. `auto` is content-addressed bytes whose real kind is
 *  read from the blob's MIME at paint time (a signature carries no extension);
 *  a `card` is the feed's catch-all, `probe` saying whether an image probe is
 *  still worth a try before the card is shown. */
export type LinkClass =
  | { readonly kind: 'auto' | PlayableKind; readonly src: string }
  | { readonly kind: 'card'; readonly src: string; readonly probe: boolean }

/** Is this an address only a server can classify — http(s), and the last path
 *  segment has no extension at all? A `.html` page is not worth a probe; a
 *  bare `/200/300` might be a picture. */
export function needsImageProbe(link: string): boolean {
  if (!/^https?:\/\//i.test(link)) return false
  return linkExtension(link) === null
}

/**
 * Classify a link — the universal player's decision, in order: a
 * content-addressed resource wins (its kind comes from the blob's MIME, so an
 * attached mp4 plays and an svg paints); then a provider EMBED (YouTube /
 * Vimeo); then a direct image; then a direct media file. Everything else is a
 * CARD — for the paged surfaces that is "contributes nothing", for the feed it
 * is a section with the child's name and a way in.
 */
export function classifyLink(link: string): LinkClass {
  const trimmed = (link ?? '').trim()
  if (!trimmed) return { kind: 'card', src: '', probe: false }
  const sig = resourceSigOf(trimmed)
  if (sig) return { kind: 'auto', src: sig }
  const embed = embedUrlFor(trimmed)
  if (embed) return { kind: 'embed', src: embed }
  if (isImageUrl(trimmed)) return { kind: 'image', src: trimmed }
  const media = mediaKindForUrl(trimmed)
  if (media) return { kind: media, src: trimmed }
  return { kind: 'card', src: trimmed, probe: needsImageProbe(trimmed) }
}
