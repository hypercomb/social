// hypercomb-shim/src/bootstrap/turn-off-link.ts
//
// THE OWNER'S OFF SWITCH, HANDED TO THEIR OWN HIVE (jwize 2026-10-24: "if it
// is my domain I should be able to unpublish directly from hypercomb.com
// because I have the ownership key").
//
// A front door holds no key and never will: the secret lives in the
// participant's hive. So an Off button here only builds a link to that hive
// carrying the row's PUBLIC coordinates — which publish, whose key, which
// domain, here or everywhere, the head it showed, and the way back — in the
// fragment, which no server sees. The hive checks it holds the key, asks,
// signs and comes back.
//
// MIRRORED: hypercomb-essentials/src/sharing/publish-turn-off.ts decodes this
// request (TURN_OFF_PREFIX, the JSON shape); the shim spec holds them together.

export const TURN_OFF_PREFIX = '#turn-off='

/** Where a hive of your own starts when the page was not opened from one. */
export const DEFAULT_HOME = 'https://hypercomb.io/'

export type TurnOffLink = {
  readonly title: string
  readonly lineage: string
  readonly publisher: string
  readonly zone: string
  readonly scope: 'here' | 'everywhere'
  readonly head: string
  /** The front door to come back to. */
  readonly back: string
}

const LOOPBACK = /^(?:[a-z0-9-]+\.)*localhost(?::\d{1,5})?$|^127(?:\.\d+){3}(?::\d{1,5})?$/

/** A hive's address the participant typed or the page was handed: its origin,
 *  https — or http on this machine's loopback. Null for anything else. */
export const homeOrigin = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url: URL
  try { url = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`) } catch { return null }
  if (url.username || url.password) return null
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.test(url.host))) return `${url.origin}/`
  return null
}

const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The link that hands one row's turn-off to the hive at `home`, or null when
 *  `home` is not a hive's address. */
export const turnOffHref = (home: unknown, link: TurnOffLink): string | null => {
  const origin = homeOrigin(home)
  if (!origin) return null
  const request = { v: 1, title: link.title, lineage: link.lineage, publisher: link.publisher, zone: link.zone,
    scope: link.scope, head: link.head, back: link.back }
  return `${origin}${TURN_OFF_PREFIX}${toBase64Url(JSON.stringify(request))}`
}
