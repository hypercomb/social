// build-asks.js
//
// THE ASKS A HOST HOLDS FOR ITS BUILDERS — one answer for every host that
// keeps grants (the blossom worker today; any host that leases its surface,
// documentation/deployment-stages.md R12).
//
// An ASK is a participant's signed request that a builder build a draft of
// the minimal build (essentials sharing/version-drafts.ts askBuild): a nostr
// event, kind 30568, content `hc:ask:v1\n<draft sig>`, tags `d` (the draft),
// `h` (the host it was sent to). Its author uploads the draft and then the
// ask, like any bytes, under their own grant. The host RECOGNISES the ask
// there — no one declares it — and notes it in the pool `host:asks`, one
// member per ask, when all of this holds:
//
//   - it is an ask for one draft, and its signature verifies;
//   - the key that signed it is the key that uploaded it, and those bytes and
//     the draft it names are held as that key's own uploads (stored under its
//     grant first, whoever else re-uploads them since), the draft a draft —
//     so nobody can queue someone else's ask, and every ask costs its author
//     a real draft of their own;
//   - its `h` names this host, and a zone this host has an operator for;
//   - it is recent (ASK_TTL_DAYS), the same window a builder builds in
//     (hypercomb-shim host/builder.mjs ASK_TTL_DAYS).
//
// The pool is PRIVATE to builders: listing it publishes drafts (anyone holding
// an ask can fetch its draft's files by signature). Each ask belongs to the
// most specific zone its host falls in, and is listed only to a signed request
// (NIP-98) from that zone's operator, or a key the operator's signed index
// names under `builders` — a key named so builds for every zone that operator
// runs on the host. Everyone else is answered exactly as for a pool the host
// does not hold.
//
// History falls off, zone by zone: each zone keeps at most ASKS_PER_AUTHOR
// open asks per author and ASKS_MAX in all, the newest the host RECEIVED
// first (an author's own clock earns no place), none older than
// ASK_TTL_DAYS. The ask's bytes stay at /<sig> (they are the author's, under
// their grant); only the listing forgets.

export const ASK_KIND = 30568
export const ASKS_MEANING = 'host:asks'
export const ASK_TTL_DAYS = 7
export const ASKS_PER_AUTHOR = 4
export const ASKS_MAX = 128
/** An ask is a small event; anything larger is not one, and is not parsed. */
export const MAX_ASK_BYTES = 4096
/** A draft record is small (essentials version-drafts.ts stageDraft): the
 *  base, the files layer, a label and a time. */
export const MAX_DRAFT_BYTES = 16_384
/** A curated few, like MAX_LISTED: past this the rest are ignored. */
export const MAX_BUILDERS = 16

const SIG_RE = /^[0-9a-f]{64}$/
const DAY = 86_400
/** A clock a little ahead of ours is allowed; an ask from further ahead is not
 *  (the builder allows the same: builder.mjs takeAsk, 600 000 ms). */
export const AHEAD_SECS = 600

export const askPreimage = (draft) => `hc:ask:v1\n${draft}`

const tag = (evt, name) => (Array.isArray(evt?.tags) ? evt.tags : []).find((t) => Array.isArray(t) && t[0] === name)?.[1]

/** The origin a host string names, normalized (lowercase, no default port,
 *  no path): https unless it is loopback. The builder compares the same way
 *  (hypercomb-shim host/builder.mjs originOf). */
export function originOf(host) {
  const text = String(host ?? '').trim()
  if (!text) return ''
  const loopback = /^(localhost|127\.|\[::1\])/i.test(text) || /^[^/:]+\.localhost(?::\d+)?(?:\/|$)/i.test(text)
  const withScheme = /^https?:\/\//i.test(text) ? text : `${loopback ? 'http' : 'https'}://${text}`
  try { return new URL(withScheme).origin } catch { return '' }
}

/** The most specific of `zones` a hostname falls in, or null. Nested zones
 *  are allowed (signed site bindings): the deepest one governs. */
export function zoneOf(hostname, zones) {
  const host = String(hostname ?? '').toLowerCase()
  return [...zones].sort((a, b) => b.length - a.length).find((zone) => host === zone || host.endsWith('.' + zone)) ?? null
}

/**
 * The ask these bytes are, if they are one SHAPED as one — kind, content, a
 * draft named by its signature, a pubkey — or null. The signature itself is
 * the caller's to verify (each host has its own verifier); `noteable` below
 * puts the whole rule together.
 */
export function askShape(bytes) {
  if (!bytes || bytes.byteLength > MAX_ASK_BYTES) return null
  let evt
  try { evt = JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
  if (!evt || typeof evt !== 'object' || Number(evt.kind) !== ASK_KIND) return null
  const draft = String(tag(evt, 'd') ?? '').toLowerCase()
  if (!SIG_RE.test(draft) || evt.content !== askPreimage(draft)) return null
  const author = String(evt.pubkey ?? '').toLowerCase()
  if (!SIG_RE.test(author)) return null
  return { evt, draft, author, host: String(tag(evt, 'h') ?? ''), at: Number(evt.created_at) || 0 }
}

/**
 * Is this upload an ask a host should note? Returns `{ ok, record }` —
 * `{ author, draft, at, origin }` — or the reason it is not. `uploader` is the
 * key the upload was authorized by; `origin` is the origin the upload
 * reached. Whether the bytes and the draft are held as the uploader's own is
 * the host's to check (it knows its store); so is the zone.
 */
export async function noteable(bytes, { uploader, origin, now = Math.floor(Date.now() / 1000), verify }) {
  const ask = askShape(bytes)
  if (!ask) return { ok: false, reason: 'not an ask' }
  if (ask.author !== String(uploader ?? '').toLowerCase()) return { ok: false, reason: 'an ask is uploaded by its own author' }
  const here = originOf(origin)
  if (!here || originOf(ask.host) !== here) return { ok: false, reason: 'the ask names another host' }
  if (!(ask.at > now - ASK_TTL_DAYS * DAY) || ask.at > now + AHEAD_SECS) return { ok: false, reason: 'the ask is not recent' }
  if (!(await verify(ask.evt))) return { ok: false, reason: 'the ask does not verify' }
  return { ok: true, record: { author: ask.author, draft: ask.draft, at: ask.at, origin: here } }
}

/** Are these bytes a draft record (essentials version-drafts.ts stageDraft):
 *  `{ name: 'draft', base, files }`, both named by their signatures? */
export function isDraft(bytes) {
  if (!bytes || bytes.byteLength > MAX_DRAFT_BYTES) return false
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes))
    return record?.name === 'draft' && SIG_RE.test(String(record.base ?? '')) && SIG_RE.test(String(record.files ?? ''))
  } catch { return false }
}

/** The builder keys one signed index names, leniently: a malformed entry is
 *  dropped, never the whole index (the index also opens doors). */
export function buildersOf(content) {
  const raw = content && typeof content === 'object' ? content.builders : undefined
  if (!Array.isArray(raw)) return []
  const out = []
  for (const value of raw) {
    const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!SIG_RE.test(key) || out.includes(key)) continue
    out.push(key)
    if (out.length >= MAX_BUILDERS) break
  }
  return out
}

/**
 * HISTORY FALLS OFF, ZONE BY ZONE. Given the pool's members
 * `{ name, author, at, noted, zone }` (`at` the ask's own time, `noted` when
 * the host received it), the names to forget: every ask older than
 * ASK_TTL_DAYS, and within each zone every author's beyond their newest
 * ASKS_PER_AUTHOR and everything beyond the newest ASKS_MAX — newest by
 * receipt. A member whose record is unreadable (no author, zone or receipt)
 * is forgotten.
 */
export function sweep(members, now = Math.floor(Date.now() / 1000)) {
  const drop = new Set()
  const zones = new Map()
  for (const member of members) {
    if (!member.author || !member.zone || !(member.noted > 0) || !(member.at > now - ASK_TTL_DAYS * DAY)) { drop.add(member.name); continue }
    if (!zones.has(member.zone)) zones.set(member.zone, [])
    zones.get(member.zone).push(member)
  }
  for (const inZone of zones.values()) {
    inZone.sort((a, b) => (b.noted - a.noted) || (a.name < b.name ? -1 : 1))
    const perAuthor = new Map()
    let kept = 0
    for (const member of inZone) {
      const seen = perAuthor.get(member.author) ?? 0
      if (seen >= ASKS_PER_AUTHOR || kept >= ASKS_MAX) { drop.add(member.name); continue }
      perAuthor.set(member.author, seen + 1)
      kept++
    }
  }
  return [...drop]
}
