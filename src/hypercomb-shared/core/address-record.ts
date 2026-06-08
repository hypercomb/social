// hypercomb-shared/core/address-record.ts
//
// The four-field participant address: { alias, host, location, secret }.
// Encodes and parses share-link URLs so a participant can hand someone
// else a single string that contains everything needed to land on the
// same mesh channel.
//
// Two invariants this module enforces:
//
//   1. The subscription sig derivation is UNCHANGED. The existing
//      content-broker contract (sha256(path + room + secret)) computes
//      identity. Host and alias are NEVER inputs to that hash — they
//      are pure routing/presentation. So two participants sharing the
//      same (location, secret) end up on the same channel regardless
//      of which host they entered through or which alias they wear.
//
//   2. Address records never override what's already in stable storage
//      without explicit user action. Parsing a share-link returns a
//      record; the caller decides whether to apply it (replace current
//      mesh state, navigate, etc.). No silent side-effects.
//
// Wire shape: `https://<host>/<location>#alias=<a>&secret=<s>`
//
// Why a verbose URL with hash fragment instead of a compact base64
// code or a custom hc:// protocol:
//
//   - Hash fragments are NEVER sent to the server. Path + host go in
//     the URL bar; the secret stays client-side. Server logs don't
//     leak it.
//   - Standard https URLs work in mail / chat / SMS / QR / clipboard
//     without protocol registration or special handlers.
//   - Path is human-readable ("cigars/brands"), so the recipient sees
//     where they're going. Alias is purely display so it goes in the
//     hash too — no presence pollution if shared on a public page.

export interface AddressRecord {
  /** Optional participant display name. Never enters the subscription sig. */
  alias?: string
  /** Host the recipient should fetch through. Bare host (`jwize.com`),
   *  no scheme, no trailing slash. NEVER enters the subscription sig. */
  host: string
  /** Lineage location path (e.g. "cigars/brands"). Folds into the sig. */
  location?: string
  /** Privacy/access secret. Folds into the sig. */
  secret?: string
}

const HOSTNAME_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/i

/** Normalize a host string the same way the rest of the codebase does:
 *  strip protocol prefix, trailing slashes, lowercase. */
export function normalizeHost(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Strip leading/trailing slashes from a location path. */
function normalizeLocation(raw: string): string {
  return String(raw ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Encode an address record as a share-link URL.
 *
 * Returns an https URL with:
 *   - host in the URL host
 *   - location in the URL path (slash-joined segments)
 *   - alias + secret in the hash fragment as form-encoded params
 *
 * Empty optional fields are omitted from the output. Throws if host
 * is empty — every address must reach a host. */
export function encodeAddress(record: AddressRecord): string {
  const host = normalizeHost(record.host)
  if (!host) throw new Error('address: host is required')
  const location = normalizeLocation(record.location ?? '')

  // Loopback hosts use http; real domains use https. Matches the
  // broker's URL-building convention.
  const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
  const pathSegment = location ? '/' + encodeURI(location) : '/'
  let url = `${scheme}://${host}${pathSegment}`

  const hashParams: string[] = []
  const alias = String(record.alias ?? '').trim()
  if (alias) hashParams.push('alias=' + encodeURIComponent(alias))
  const secret = String(record.secret ?? '').trim()
  if (secret) hashParams.push('secret=' + encodeURIComponent(secret))
  if (hashParams.length) url += '#' + hashParams.join('&')

  return url
}

/** Parse a share-link URL into an address record. Returns null on any
 *  malformed input — never throws. Tolerates inputs without a scheme
 *  (treats them as https) and without a path (location becomes "").
 *
 *  The recipient calls this, inspects the record, then explicitly
 *  applies it (e.g. via mesh-modal). Parsing has no side effects. */
export function parseAddress(input: string): AddressRecord | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    // Accept URLs without a scheme (paste-friendly) by prepending https.
    if (/^[a-z]+:\/\//i.test(raw)) url = new URL(raw)
    else url = new URL('https://' + raw)
  } catch { return null }

  const host = normalizeHost(url.host)
  if (!host || !HOSTNAME_RE.test(host)) return null

  const location = normalizeLocation(url.pathname).split('/').map(s => {
    try { return decodeURIComponent(s) } catch { return s }
  }).filter(Boolean).join('/')

  // Hash params: alias, secret. URL hash starts with '#' which we strip.
  const hash = url.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash)
  const alias = (params.get('alias') ?? '').trim() || undefined
  const secret = (params.get('secret') ?? '').trim() || undefined

  const record: AddressRecord = { host }
  if (alias) record.alias = alias
  if (location) record.location = location
  if (secret) record.secret = secret
  return record
}

/** True iff `input` looks parseable as a hypercomb share-link.
 *  Useful for paste handlers that want to detect addresses without
 *  always converting. */
export function isAddressLink(input: string): boolean {
  return parseAddress(input) !== null
}
