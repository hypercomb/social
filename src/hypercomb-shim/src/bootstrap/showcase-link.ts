// hypercomb-shim/src/bootstrap/showcase-link.ts
//
// PUTTING A TILE IN THE SHOWCASE FROM A DEVICE WITH NO HIVE BESIDE THE PAGE (jwize 2026-10-25: "on mobile I
// hold down to get the popup but there is no way to showcase").
//
// A front door holds no key. When no hive of yours answers on this page's own origin, the hold's popup offers
// the act as a LINK to the hive that has the key, carrying only public coordinates in the fragment — which
// zone's showcase, whose key and which lineage, on or off, and the way back. The hive asks once, signs, and
// returns. Same shape as the Off switch (turn-off-link.ts).
//
// MIRRORED: hypercomb-shared/core/invite-capture.ts (SHOWCASE_PREFIX, the boot stash) and
// hypercomb-essentials/src/sharing/showcase-bridge.ts (the request, and its check) read this.

import { homeOrigin } from './turn-off-link'

export const SHOWCASE_PREFIX = '#showcase='

export type ShowcaseLink = {
  readonly zone: string
  readonly pubkey: string
  readonly lineage: string
  readonly on: boolean
  readonly title: string
  /** The front door to come back to. */
  readonly back: string
}

const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The link that hands one tile's switch to the hive at `home`, or null when `home` is not a hive's address. */
export const showcaseHref = (home: unknown, link: ShowcaseLink): string | null => {
  const origin = homeOrigin(home)
  if (!origin) return null
  const request = { v: 1, zone: link.zone, pubkey: link.pubkey, lineage: link.lineage, on: link.on, title: link.title, back: link.back }
  return `${origin}${SHOWCASE_PREFIX}${toBase64Url(JSON.stringify(request))}`
}
